import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  type AgentToolResult,
  type ExtensionAPI,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import {
  captureWorkspaceSnapshot,
  decodeJsonValue,
  type InPlaceReceipt,
  jsonEquals,
  readSubagentState,
  type RunRecord,
  type StructuredOutput,
  type TerminalValidationInput,
  type TerminalValidationResult,
  toolInputUnion,
  type WorkspaceSnapshot,
} from '@nothingrotf/subagent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import {
  deliveryJournalEntryType,
  makeDeliveryJournalEvent,
  readDeliveryJournal,
} from './delivery-journal.ts'
import { type DeliveryNextStep, nextDeliveryStep } from './delivery-next.ts'
import { isDeliveryRole, isImplementationRole } from './delivery-roles.ts'
import {
  DeliveryReadSchema,
  DeliveryToolOutputSchema,
  deliveryView,
  submissionDigestLocator,
} from './delivery-views.ts'
import {
  type DeliveryWorkspace,
  deliveryWorkspaceEntryType,
  isWithin,
  prepareIssueWorkspace,
  readDeliveryWorkspaces,
  workspaceBrief,
  workspaceIsLive,
} from './delivery-workspace.ts'
import {
  DELIVERY_REASON_LIMIT,
  DeliveryArtifactSchema,
  DeliveryIssueSchema,
  DeliveryOutputSchema,
  DeliveryReportSchema,
  DeliveryRejected,
  type DeliveryArtifact,
  type DeliveryEvidence,
  type DeliveryIssue,
  type DeliveryReport,
  type DeliveryReportDraft,
  type DeliveryResult,
  type DeliverySubmission,
  type DeliverySummary,
  currentDeliveryReport,
  deliveryRepairIdentity,
  deliveryReportDiagnostics,
  deliveryReportDraft,
  normalizeDeliveryReportProse,
  pruneFailedPassEvidence,
  parseDeliveryIssue,
  recordDelivery,
  refreshDeliveryIntegration,
  repairDeliveryReport,
  sameDeliveryArtifact,
  sameDeliveryTechnicalVerdict,
  summarizeDelivery,
} from './delivery.ts'

type JsonValue = Exclude<AgentToolResult['structuredContent'], undefined>

const entryType = '@nothingrotf/pstack/delivery-v1'
const deliveryPacketPrefix = 'PSTACK_DELIVERY_PACKET:'
const maxCommandReceipts = 256
const id = Type.String({ minLength: 1, maxLength: 256 })
const bindingEntryType = '@nothingrotf/pstack/delivery-binding-v1'
const BindingSchema = Type.Object(
  { agentId: id, issue: id, ownerSessionId: id, toolCallId: id },
  { additionalProperties: false },
)
const TaskResultSchema = Type.Object(
  { agentId: id, attemptStarted: Type.Optional(Type.Boolean()) },
  { additionalProperties: true },
)
const CompletedTaskResultSchema = Type.Object(
  { agentId: id, status: Type.Optional(Type.Literal('completed')) },
  { additionalProperties: true },
)
const releaseScript = fileURLToPath(
  new URL('../skills/poteto-mode/scripts/release-worktree.sh', import.meta.url),
)

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function publicationReleaseNotice(issue: string, destination: string): string {
  return [
    `Release the local footprint of ${issue} now. Its remote branch holds the published state.`,
    `1. Run \`bash ${shellQuote(releaseScript)} ${shellQuote(destination)}\`. It removes the destination worktree and its local branch only when the worktree is clean and the remote branch contains HEAD.`,
    `2. Remove containers, volumes, scratch worktrees, and temporary directories that ${issue} owns.`,
    '3. Record each release or held reason in the checkpoint. A later correction recreates the worktree from the remote branch.',
  ].join('\n')
}
const BatchResultSchema = Type.Object(
  {
    items: Type.Array(
      Type.Object(
        {
          agentId: Type.Optional(id),
          attemptStarted: Type.Optional(Type.Boolean()),
          taskId: id,
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)
const IsolationViewSchema = Type.Object(
  {
    integration: Type.Optional(Type.String()),
    mode: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)
const TaskDeliverySchema = Type.Union([
  Type.Object({ issue: id, kind: Type.Literal('managed') }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('independent') }, { additionalProperties: false }),
])
const TaskViewSchema = Type.Object(
  {
    cwd: Type.Optional(Type.String()),
    delivery: Type.Optional(TaskDeliverySchema),
    id: Type.Optional(id),
    isolation: Type.Optional(IsolationViewSchema),
    outputSchema: Type.Optional(Type.Unknown()),
    prompt: Type.String(),
    readonly: Type.Optional(Type.Boolean()),
    resume: Type.Optional(Type.String()),
    role: Type.Optional(Type.String()),
    run_in_background: Type.Optional(Type.Boolean()),
    schemaMode: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)
const DeliveryEntryOwnerSchema = Type.Object({ ownerSessionId: id }, { additionalProperties: true })
const BatchViewSchema = Type.Object(
  { tasks: Type.Array(TaskViewSchema) },
  { additionalProperties: true },
)

const DeliveryToolSchema = toolInputUnion([
  Type.Object(
    {
      action: Type.Literal('open'),
      issue: id,
      criteria: DeliveryIssueSchema.properties.criteria,
      runtimeRequired: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('record'), issue: id, agentId: id },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('refresh'), issue: id, agentId: id },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('workspace'),
      issue: id,
      base: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('repair'),
      issue: id,
      agentId: id,
      artifactSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      attempt: Type.Integer({ minimum: 1 }),
      evidenceSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      report: DeliveryReportSchema,
      reportSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      revision: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  ...DeliveryReadSchema.anyOf,
])

function loadJournal(ctx: Pick<ExtensionContext, 'sessionManager'>) {
  const journal = readDeliveryJournal(
    ctx.sessionManager.getBranch(),
    ctx.sessionManager.getSessionId(),
  )
  if (!journal.ok) throw journal.error
  return journal.value
}

function loadWorkspaces(
  ctx: Pick<ExtensionContext, 'sessionManager'>,
): Map<string, DeliveryWorkspace> {
  return readDeliveryWorkspaces(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId())
}

async function physicalPath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}

async function applyIssueWorkspace(
  task: Static<typeof TaskViewSchema>,
  role: string | undefined,
  readonly: boolean | undefined,
  workspace: DeliveryWorkspace,
  ctx: ExtensionContext,
): Promise<void> {
  if (task.resume !== undefined) return
  if (!(await workspaceIsLive(workspace))) {
    throw new DeliveryRejected(
      `The workspace for issue ${workspace.issue} at ${workspace.worktree} is gone. Call pstack_delivery workspace to recreate it, then dispatch.`,
    )
  }
  if (task.cwd === undefined) task.cwd = workspace.worktree
  else if (!isWithin(workspace.worktree, await physicalPath(resolve(ctx.cwd, task.cwd)))) {
    throw new DeliveryRejected(
      `Issue ${workspace.issue} runs in its workspace ${workspace.worktree}. Omit cwd or pass a path inside it.`,
    )
  }
  const writer =
    readonly !== true &&
    (role === 'runtime verification' || role === 'publication' || isImplementationRole(role))
  if (writer && task.isolation === undefined) task.isolation = { mode: 'in-place' }
  task.prompt = `${task.prompt}\n\n${workspaceBrief(workspace)}`
}

function loadIssues(ctx: Pick<ExtensionContext, 'sessionManager'>): Map<string, DeliveryIssue> {
  return loadJournal(ctx).issues
}

function loadBindings(ctx: Pick<ExtensionContext, 'sessionManager'>): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== 'custom' || entry.customType !== bindingEntryType) continue
    if (
      Value.Check(DeliveryEntryOwnerSchema, entry.data) &&
      entry.data.ownerSessionId !== ctx.sessionManager.getSessionId()
    )
      continue
    if (!Value.Check(BindingSchema, entry.data))
      throw new DeliveryRejected('Invalid delivery dispatch binding.')
    const previous = bindings.get(entry.data.agentId)
    if (previous !== undefined && previous !== entry.data.issue)
      throw new DeliveryRejected('Conflicting delivery dispatch bindings.')
    bindings.set(entry.data.agentId, entry.data.issue)
  }
  return bindings
}

async function verifyReference(uri: string, expected: string): Promise<void> {
  const contents = await readFile(fileURLToPath(uri))
  if (createHash('sha256').update(contents).digest('hex') !== expected) {
    throw new DeliveryRejected(`Evidence digest mismatch: ${uri}`)
  }
}

function inPlaceArtifact(receipt: InPlaceReceipt): DeliveryArtifact {
  if (receipt.status !== 'captured' || receipt.repositories.length === 0) {
    throw new DeliveryRejected(
      `The in-place result was not captured: ${receipt.error ?? 'no repository receipt'}.`,
    )
  }
  return {
    repositories: receipt.repositories.map((repository) => ({
      root: repository.root,
      relativePath: repository.relativePath,
      base: repository.baseTree,
      tree: repository.resultTree,
      patch: repository.patch.sha256,
    })),
  }
}

function implementationArtifact(
  isolation: TerminalValidationInput['isolation'],
  workspaceIdentity: TerminalValidationInput['workspaceIdentity'],
  inPlace?: InPlaceReceipt,
): DeliveryArtifact {
  if (inPlace !== undefined) return inPlaceArtifact(inPlace)
  if (isolation === undefined || isolation.repositories.length === 0) {
    throw new DeliveryRejected('An implementation requires a captured isolation receipt.')
  }
  const snapshot = workspaceIdentity?.snapshot
  return {
    repositories: isolation.repositories.map((repository) => {
      const source = snapshot?.repositories.find(
        (entry) => entry.relativePath === repository.relativePath,
      )
      if (source === undefined || source.tree !== repository.baselineTree) {
        throw new DeliveryRejected(
          'The captured patch does not match its recorded product baseline.',
        )
      }
      const base = source.base.length > 0 ? source.base : workspaceIdentity?.baselineTree
      if (base === undefined || base.length === 0) {
        throw new DeliveryRejected('The captured artifact has no resolved product base.')
      }
      return {
        root: source.root,
        relativePath: repository.relativePath,
        base,
        tree: repository.resultTree,
        patch: repository.patch.sha256,
      }
    }),
  }
}

function artifactFromRun(record: RunRecord): DeliveryArtifact {
  const workspaceIdentity =
    record.execution?.version === 4 || record.execution?.version === 5
      ? record.execution.workspaceIdentity
      : undefined
  return implementationArtifact(record.isolation, workspaceIdentity, record.inPlace)
}

function hasCapturedArtifact(record: RunRecord): boolean {
  return record.inPlace !== undefined || (record.isolation?.repositories.length ?? 0) > 0
}

function artifactMismatch(
  candidate: DeliveryArtifact,
  snapshot: WorkspaceSnapshot | undefined,
): string {
  if (snapshot === undefined) return 'The cwd is not inside a Git repository.'
  const differences = candidate.repositories.flatMap((expected) => {
    const actual = snapshot.repositories.find(
      (entry) => entry.root === expected.root && entry.relativePath === expected.relativePath,
    )
    if (actual === undefined) return [`${expected.relativePath || '.'}: repository missing`]
    if (actual.tree !== expected.tree) {
      return [
        `${expected.relativePath || '.'}: expected tree ${expected.tree.slice(0, 12)}, found ${actual.tree.slice(0, 12)}`,
      ]
    }
    return []
  })
  const extra = snapshot.repositories.length - candidate.repositories.length
  if (extra > 0) differences.push(`${extra} unexpected repositories`)
  return `Differences: ${differences.join('; ') || 'none'}. Check out the accepted candidate tree or point cwd at the workspace that holds it.`
}

function stateHint(summary: DeliverySummary, issueId: string): string {
  const parts = [`Issue ${issueId} is ${summary.state}`]
  if (summary.integration !== undefined) parts.push(`integration ${summary.integration}`)
  if (summary.unresolvedCriteria.length > 0)
    parts.push(`unresolved criteria ${summary.unresolvedCriteria.join(', ')}`)
  if (summary.unresolvedFindings.length > 0)
    parts.push(`open blocking findings ${summary.unresolvedFindings.join(', ')}`)
  return `${parts.join(', ')}.`
}

function matchesCandidateSnapshot(
  candidate: DeliveryArtifact,
  snapshot: WorkspaceSnapshot | undefined,
): boolean {
  return (
    snapshot !== undefined &&
    snapshot.repositories.length === candidate.repositories.length &&
    candidate.repositories.every((expected) =>
      snapshot.repositories.some(
        (actual) =>
          actual.root === expected.root &&
          actual.relativePath === expected.relativePath &&
          actual.tree === expected.tree,
      ),
    )
  )
}

function reviewerArtifact(
  role: string | undefined,
  readonly: boolean,
  isolation: TerminalValidationInput['isolation'],
  workspaceIdentity: TerminalValidationInput['workspaceIdentity'],
  candidate: DeliveryArtifact | undefined,
  inPlace?: InPlaceReceipt,
): DeliveryArtifact {
  if (candidate === undefined)
    throw new DeliveryRejected('No implementation artifact exists for this review.')
  const snapshot = workspaceIdentity?.snapshot
  if (role === 'runtime verification' && inPlace !== undefined) {
    if (readonly || !matchesCandidateSnapshot(candidate, snapshot)) {
      throw new DeliveryRejected('Runtime review must start from the candidate tree in place.')
    }
    const unchanged =
      inPlace.status === 'captured' &&
      inPlace.repositories.length === candidate.repositories.length &&
      candidate.repositories.every((expected) =>
        inPlace.repositories.some(
          (actual) =>
            actual.root === expected.root &&
            actual.relativePath === expected.relativePath &&
            actual.baseTree === expected.tree &&
            actual.resultTree === expected.tree,
        ),
      )
    if (!unchanged) {
      throw new DeliveryRejected(
        'Runtime verification changed the candidate tree in place. Keep scratch output outside the worktree or in ignored paths, and restore the tree before reporting.',
      )
    }
    return candidate
  }
  if (role === 'code review') {
    if (!readonly || !matchesCandidateSnapshot(candidate, snapshot)) {
      throw new DeliveryRejected('Static review evidence does not identify the candidate tree.')
    }
    return candidate
  }
  const verifiesCandidate =
    isolation !== undefined &&
    isolation.repositories.length === candidate.repositories.length &&
    candidate.repositories.every((expected) =>
      isolation.repositories.some(
        (actual) =>
          actual.relativePath === expected.relativePath &&
          actual.baselineTree === expected.tree &&
          actual.resultTree === expected.tree,
      ),
    )
  if (
    role !== 'runtime verification' ||
    readonly ||
    isolation?.integration !== 'manual' ||
    isolation.integrationStatus === 'integrated' ||
    isolation.status === 'integrated' ||
    !verifiesCandidate ||
    !matchesCandidateSnapshot(candidate, snapshot)
  ) {
    throw new DeliveryRejected('Runtime review must start from the candidate in manual isolation.')
  }
  return candidate
}

function reviewArtifact(record: RunRecord, issue: DeliveryIssue): DeliveryArtifact {
  const workspaceIdentity =
    record.execution?.version === 4 || record.execution?.version === 5
      ? record.execution.workspaceIdentity
      : undefined
  return reviewerArtifact(
    record.role,
    record.readonly,
    record.isolation,
    workspaceIdentity,
    summarizeDelivery(issue).artifact,
    record.inPlace,
  )
}

function includesReadReceipts(
  report: DeliveryReport | undefined,
  role: string | undefined,
  readonly: boolean,
): boolean {
  return (
    report?.kind === 'diagnosis' ||
    (report?.kind === 'technical-review' && role === 'code review' && readonly)
  )
}

function evidenceCommand(command: string | undefined): string | undefined {
  if (command === undefined || command.length <= 4096) return command
  const marker = ' [command truncated]'
  return `${command.slice(0, 4096 - marker.length).trimEnd()}${marker}`
}

async function evidenceFromRun(
  record: RunRecord,
  citedEvidence: readonly string[],
  includeReadReceipts: boolean,
): Promise<DeliveryEvidence[]> {
  const evidence: DeliveryEvidence[] = []
  const inPlaceRepositories =
    record.inPlace?.status === 'captured' ? record.inPlace.repositories : undefined
  for (const repository of inPlaceRepositories ?? []) {
    await verifyReference(repository.patch.uri, repository.patch.sha256)
    evidence.push({
      id: `patch:${repository.relativePath || '.'}`,
      kind: 'patch',
      passed: true,
      reference: repository.patch.uri,
      sha256: repository.patch.sha256,
    })
  }
  for (const repository of record.isolation?.repositories ?? []) {
    await verifyReference(repository.patch.uri, repository.patch.sha256)
    evidence.push({
      id: `patch:${repository.relativePath || '.'}`,
      kind: 'patch',
      passed: true,
      reference: repository.patch.uri,
      sha256: repository.patch.sha256,
    })
  }
  const execution = record.execution
  if (
    record.isolation === undefined &&
    inPlaceRepositories === undefined &&
    (execution?.version === 4 || execution?.version === 5)
  ) {
    for (const repository of execution.workspaceIdentity?.snapshot?.repositories ?? []) {
      await verifyReference(repository.patch.uri, repository.patch.sha256)
      evidence.push({
        id: `patch:${repository.relativePath || '.'}`,
        kind: 'patch',
        passed: true,
        reference: repository.patch.uri,
        sha256: repository.patch.sha256,
      })
    }
  }
  const commandReceipts = (record.toolExecutionReceipts ?? []).filter(
    (receipt) => receipt.tool === 'bash' || receipt.tool === 'powershell',
  )
  const retained = new Map<number, (typeof commandReceipts)[number]>()
  for (const [index, receipt] of commandReceipts.entries()) {
    if (
      index < maxCommandReceipts / 2 ||
      index >= commandReceipts.length - maxCommandReceipts / 2
    ) {
      retained.set(index, receipt)
    }
  }
  for (const cited of citedEvidence) {
    const match = /^command:(\d+)$/.exec(cited)
    if (match === null) continue
    const index = Number(match[1]) - 1
    const receipt = commandReceipts[index]
    if (receipt !== undefined) retained.set(index, receipt)
  }
  const retainedReceipts = [...retained.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, receipt]) => ({ index, receipt }))
  for (const { index, receipt } of retainedReceipts) {
    await verifyReference(receipt.output.uri, receipt.output.sha256)
    const passed = receipt.status === 'success' && !receipt.isError
    const entry: DeliveryEvidence = {
      id: `command:${index + 1}`,
      kind: passed ? 'command' : 'failure',
      passed,
      reference: receipt.output.uri,
      sha256: receipt.output.sha256,
      status: passed ? 'success' : 'error',
    }
    const command = evidenceCommand(receipt.command)
    if (command !== undefined) entry.command = command
    evidence.push(entry)
  }
  if (includeReadReceipts) {
    const readReceipts = (record.toolExecutionReceipts ?? []).filter(
      (receipt) => receipt.tool === 'read',
    )
    const retainedReads = new Map<number, (typeof readReceipts)[number]>()
    for (const [index, receipt] of readReceipts.entries()) {
      if (index < maxCommandReceipts / 2 || index >= readReceipts.length - maxCommandReceipts / 2) {
        retainedReads.set(index, receipt)
      }
    }
    for (const cited of citedEvidence) {
      const match = /^read:(\d+)$/.exec(cited)
      if (match === null) continue
      const index = Number(match[1]) - 1
      const receipt = readReceipts[index]
      if (receipt !== undefined) retainedReads.set(index, receipt)
    }
    for (const [index, receipt] of [...retainedReads.entries()].sort(
      ([left], [right]) => left - right,
    )) {
      await verifyReference(receipt.output.uri, receipt.output.sha256)
      const passed = receipt.status === 'success' && !receipt.isError
      const entry: DeliveryEvidence = {
        id: `read:${index + 1}`,
        kind: passed ? 'command' : 'failure',
        passed,
        reference: receipt.output.uri,
        sha256: receipt.output.sha256,
        status: passed ? 'success' : 'error',
      }
      const command = evidenceCommand(receipt.command)
      if (command !== undefined) entry.command = command
      evidence.push(entry)
    }
  }
  return evidence
}

function structuredDeliveryReport(record: RunRecord): DeliveryReport | undefined {
  const output = record.structuredOutput
  return output?.status === 'valid' && Value.Check(DeliveryReportSchema, output.data)
    ? output.data
    : undefined
}

function fallbackReport(record: RunRecord, issue: DeliveryIssue): DeliveryReport {
  let kind: DeliveryReport['kind'] = isImplementationRole(record.role)
    ? 'implementation'
    : 'comments'
  if (record.role === 'code review') kind = 'technical-review'
  if (record.role === 'runtime verification') kind = 'runtime-verification'
  const failure = record.error?.trim()
  return {
    criteria: [],
    failureClass: 'execution-contract',
    findings: [],
    issue: issue.issue,
    kind,
    reason:
      failure === undefined || failure.length === 0
        ? 'The execution ended without a valid delivery report. Complete its remaining obligations.'
        : failure.slice(0, 4096),
    state: 'wip',
  }
}

function deliveryIntegration(record: RunRecord): DeliverySubmission['integration'] {
  if (record.inPlace?.status === 'captured') return 'integrated'
  const status = record.isolation?.integrationStatus ?? record.isolation?.status
  if (status === 'integrated') return 'integrated'
  if (status === 'conflict' || status === 'blocked' || status === 'partial') return 'conflict'
  if (status === 'staged') return 'pending'
  return 'captured'
}

async function submissionFromRun(
  record: RunRecord,
  issue: DeliveryIssue,
): Promise<DeliverySubmission> {
  if (record.status === 'running') throw new DeliveryRejected('The execution is still running.')
  const report = structuredDeliveryReport(record) ?? fallbackReport(record, issue)
  if (report.kind === 'implementation' && !isImplementationRole(record.role)) {
    throw new DeliveryRejected('The reporting role cannot own implementation work.')
  }
  if (record.artifact !== undefined)
    await verifyReference(record.artifact.uri, record.artifact.sha256)
  if (report.state === 'candidate' || report.state === 'accepted') {
    if (record.artifact === undefined || record.gateResults?.some((gate) => !gate.passed)) {
      throw new DeliveryRejected('Readiness requires an immutable report and all execution gates.')
    }
  }
  let artifact: DeliveryArtifact | undefined
  if (report.kind === 'implementation') {
    if (hasCapturedArtifact(record)) artifact = artifactFromRun(record)
  } else if (report.kind !== 'diagnosis') {
    try {
      artifact = reviewArtifact(record, issue)
    } catch (error) {
      if (
        !(error instanceof DeliveryRejected) ||
        report.state === 'candidate' ||
        report.state === 'accepted'
      )
        throw error
    }
  }
  const submission: DeliverySubmission = {
    agentId: record.agentId,
    attempt: record.runGeneration ?? 1,
    evidence: await evidenceFromRun(
      record,
      [
        ...report.criteria.flatMap((criterion) => criterion.evidence),
        ...report.findings.flatMap((finding) => finding.evidence),
      ],
      includesReadReceipts(report, record.role, record.readonly),
    ),
    execution: record.status,
    integration: deliveryIntegration(record),
    recordedAt: Date.now(),
    report,
    role: record.role ?? 'unassigned',
  }
  if (record.terminalFailureKind === 'report-contract') {
    submission.failureKind = 'report-contract'
  }
  if (artifact !== undefined) submission.artifact = artifact
  return submission
}

async function unprovenSubmission(
  record: RunRecord,
  issue: DeliveryIssue,
  reason: string,
): Promise<DeliverySubmission> {
  if (record.status === 'running') throw new DeliveryRejected('The execution is still running.')
  const structured = structuredDeliveryReport(record)
  const report = fallbackReport(record, issue)
  if (
    structured !== undefined &&
    structured.issue === issue.issue &&
    structured.kind !== 'diagnosis'
  ) {
    const criteria = new Map<string, DeliveryReport['criteria'][number]>()
    for (const criterion of structured.criteria) {
      if (issue.criteria.some((entry) => entry.id === criterion.id) && !criteria.has(criterion.id))
        criteria.set(criterion.id, criterion)
    }
    const findings = new Map<string, DeliveryReport['findings'][number]>()
    for (const finding of structured.findings) {
      if (finding.id.trim().length === 0) continue
      const prior = findings.get(finding.id)
      findings.set(
        finding.id,
        prior === undefined
          ? finding
          : {
              ...finding,
              blocking: prior.blocking || finding.blocking,
              disposition: 'open',
            },
      )
    }
    report.criteria = [...criteria.values()]
    report.findings = [...findings.values()]
  }
  report.reason = `Retained evidence cannot establish readiness: ${reason}`.slice(0, 4096)
  const cited =
    structured === undefined
      ? []
      : [
          ...structured.criteria.flatMap((criterion) => criterion.evidence),
          ...structured.findings.flatMap((finding) => finding.evidence),
        ]
  let evidence: DeliveryEvidence[] = []
  try {
    evidence = await evidenceFromRun(
      record,
      cited,
      includesReadReceipts(structured, record.role, record.readonly),
    )
  } catch {}
  const submission: DeliverySubmission = {
    agentId: record.agentId,
    attempt: record.runGeneration ?? 1,
    evidence,
    execution: record.status,
    integration: deliveryIntegration(record),
    recordedAt: Date.now(),
    report,
    role: record.role ?? 'unassigned',
  }
  if (record.terminalFailureKind === 'report-contract') {
    submission.failureKind = 'report-contract'
  }
  if (structured !== undefined) submission.intendedReport = structured
  if (structured?.kind === 'implementation' && hasCapturedArtifact(record)) {
    try {
      submission.artifact = artifactFromRun(record)
    } catch {}
  } else if (structured !== undefined && structured.kind !== 'diagnosis') {
    try {
      submission.artifact = reviewArtifact(record, issue)
    } catch {}
  }
  return submission
}

async function collectSubmission(
  record: RunRecord,
  issue: DeliveryIssue,
): Promise<DeliverySubmission> {
  try {
    return await submissionFromRun(record, issue)
  } catch (error) {
    return await unprovenSubmission(
      record,
      issue,
      error instanceof Error ? error.message : String(error),
    )
  }
}

function issueFromRecord(
  record: RunRecord,
  bindings: ReadonlyMap<string, string>,
): string | undefined {
  const delivery = record.execution?.version === 5 ? record.execution.delivery : undefined
  if (delivery?.kind === 'managed') return delivery.issue
  return bindings.get(record.agentId)
}

function deliveryNext(
  issue: DeliveryIssue,
  ctx: ExtensionContext,
  workspace = loadWorkspaces(ctx).has(issue.issue),
): DeliveryNextStep {
  const bindings = loadBindings(ctx)
  const records = (
    readSubagentState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId())?.records ??
    []
  ).filter((record) => issueFromRecord(record, bindings) === issue.issue)
  return nextDeliveryStep(issue, {
    running: records
      .filter((record) => record.status === 'running')
      .map((record) => record.agentId),
    unrecorded: records
      .filter(
        (record) =>
          record.status !== 'running' &&
          !issue.submissions.some(
            (submission) =>
              submission.agentId === record.agentId &&
              submission.attempt === (record.runGeneration ?? 1),
          ),
      )
      .map((record) => record.agentId),
    workspace,
  })
}

function isDeliveryOutputSchema<Input>(input: Input): boolean {
  if (input === undefined) return false
  try {
    return jsonEquals(decodeJsonValue(input), DeliveryOutputSchema)
  } catch {
    return false
  }
}

function persistedExecution(record: RunRecord | undefined) {
  const execution = record?.execution
  return execution?.version === 3 || execution?.version === 4 || execution?.version === 5
    ? execution
    : undefined
}

function effectiveTaskCwd(
  task: Static<typeof TaskViewSchema>,
  resumed: RunRecord | undefined,
  ctx: ExtensionContext,
): string {
  const execution = persistedExecution(resumed)
  if (execution === undefined) return resolve(ctx.cwd, task.cwd ?? '.')
  const retained = resolve(ctx.cwd, execution.logicalCwd)
  if (task.cwd !== undefined && resolve(ctx.cwd, task.cwd) !== retained)
    throw new DeliveryRejected('Managed resume cannot change its retained cwd.')
  if (task.cwd === undefined) task.cwd = execution.logicalCwd
  return retained
}

function effectiveRuntimeIsolation(
  task: Static<typeof TaskViewSchema>,
  resumed: RunRecord | undefined,
): Static<typeof IsolationViewSchema> | undefined {
  const execution = persistedExecution(resumed)
  if (resumed === undefined) {
    if (task.isolation?.mode === 'in-place') {
      if (task.isolation.integration !== undefined)
        throw new DeliveryRejected('In-place runtime verification has no integration mode.')
      return task.isolation
    }
    if (task.isolation !== undefined && task.isolation.mode !== 'worktree')
      throw new DeliveryRejected('Runtime verification requires manual worktree isolation.')
    if (task.isolation?.integration !== undefined && task.isolation.integration !== 'manual')
      throw new DeliveryRejected('Runtime verification requires manual worktree isolation.')
    task.isolation = { integration: 'manual', mode: 'worktree' }
    return task.isolation
  }
  if (execution === undefined) return task.isolation
  const retained = execution.isolation
  if (task.isolation === undefined) {
    if (retained !== undefined) task.isolation = structuredClone(retained)
    return retained
  }
  if (retained === undefined)
    throw new DeliveryRejected('Managed resume cannot change its retained isolation policy.')
  const integration = task.isolation.integration ?? retained.integration
  if (task.isolation.mode !== retained.mode || integration !== retained.integration)
    throw new DeliveryRejected('Managed resume cannot change its retained isolation policy.')
  if (integration !== undefined) task.isolation = { ...task.isolation, integration }
  return task.isolation
}

function hasStoredDeliveryContract(record: RunRecord | undefined): boolean {
  const contract = record?.execution
  return (
    contract !== undefined &&
    contract.version !== 1 &&
    contract.outputSchema !== undefined &&
    jsonEquals(contract.outputSchema, DeliveryOutputSchema)
  )
}

function isTechnicalSubmission(submission: DeliverySubmission): boolean {
  const report = currentDeliveryReport(submission)
  return (
    (report.kind === 'technical-review' && submission.role === 'code review') ||
    (report.kind === 'runtime-verification' && submission.role === 'runtime verification')
  )
}

const TerminalDeliveryPacketSchema = Type.Object(
  {
    artifact: Type.Optional(DeliveryArtifactSchema),
    criteria: DeliveryIssueSchema.properties.criteria,
    issue: DeliveryIssueSchema.properties.issue,
    ownerSessionId: DeliveryIssueSchema.properties.ownerSessionId,
    runtimeRequired: DeliveryIssueSchema.properties.runtimeRequired,
  },
  { additionalProperties: false },
)

type TerminalDeliveryPacket = Static<typeof TerminalDeliveryPacketSchema>

function terminalDeliveryPacket(issue: DeliveryIssue): TerminalDeliveryPacket {
  const packet: TerminalDeliveryPacket = {
    criteria: issue.criteria,
    issue: issue.issue,
    ownerSessionId: issue.ownerSessionId,
    runtimeRequired: issue.runtimeRequired,
  }
  const artifact = summarizeDelivery(issue).artifact
  if (artifact !== undefined) packet.artifact = artifact
  return packet
}

export const MINIMUM_COMPLETION_WAIT_MS = 900_000

const CompletionWaitSchema = Type.Object(
  { action: Type.Literal('wait'), timeout_ms: Type.Optional(Type.Integer()) },
  { additionalProperties: true },
)

/**
 * A wait window shorter than a quarter hour settles on its own timeout rather than on the
 * child's completion. Each expiry costs a full coordinator turn and can miss the provider
 * prompt cache, so the managed preflight restores the completion-driven default.
 */
export function normalizeCompletionWait(input: Static<typeof CompletionWaitSchema>): boolean {
  if (input.timeout_ms === undefined || input.timeout_ms >= MINIMUM_COMPLETION_WAIT_MS) return false
  delete input.timeout_ms
  return true
}

const deliveryPacketLimitBytes = 32 * 1024
const historyPreviewCharacters = 512

function previewText(value: string): { text: string; truncated: boolean } {
  if (value.length <= historyPreviewCharacters) return { text: value, truncated: false }
  const last = value.charCodeAt(historyPreviewCharacters - 1)
  const end =
    last >= 0xd800 && last <= 0xdbff ? historyPreviewCharacters - 1 : historyPreviewCharacters
  return { text: value.slice(0, end), truncated: true }
}

function priorFindingRow(entry: DeliverySubmission, finding: DeliveryReport['findings'][number]) {
  return {
    agentId: entry.agentId,
    attempt: entry.attempt,
    id: finding.id,
    severity: finding.blocking ? 'blocking' : 'non-blocking',
    disposition: finding.disposition,
    evidence: finding.evidence,
  }
}

interface ReceiptRow {
  agentId: string
  attempt: number
  id: string
  kind: DeliveryEvidence['kind']
  status: 'success' | 'error'
  sha256: string
  reference: string
  referenceCharacters?: number
  referenceTruncated?: true
}

function receiptRow(entry: DeliverySubmission, evidence: DeliveryEvidence): ReceiptRow {
  const reference = previewText(evidence.reference)
  const row: ReceiptRow = {
    agentId: entry.agentId,
    attempt: entry.attempt,
    id: evidence.id,
    kind: evidence.kind,
    status: evidence.status ?? (evidence.passed ? 'success' : 'error'),
    sha256: evidence.sha256,
    reference: reference.text,
  }
  if (reference.truncated) {
    row.referenceCharacters = evidence.reference.length
    row.referenceTruncated = true
  }
  return row
}

interface CommandRow {
  agentId: string
  attempt: number
  id: string
  command: string | null
  commandCharacters?: number
  commandTruncated?: true
  sha256: string
  log: string
  logCharacters?: number
  logTruncated?: true
}

function commandRow(entry: DeliverySubmission, evidence: DeliveryEvidence): CommandRow {
  const log = previewText(evidence.reference)
  const row: CommandRow = {
    agentId: entry.agentId,
    attempt: entry.attempt,
    id: evidence.id,
    command: null,
    sha256: evidence.sha256,
    log: log.text,
  }
  if (evidence.command !== undefined) {
    const command = previewText(evidence.command)
    row.command = command.text
    if (command.truncated) {
      row.commandCharacters = evidence.command.length
      row.commandTruncated = true
    }
  }
  if (log.truncated) {
    row.logCharacters = evidence.reference.length
    row.logTruncated = true
  }
  return row
}

function isCommandEvidence(evidence: DeliveryEvidence): boolean {
  return evidence.kind === 'command' || evidence.kind === 'failure'
}

interface PacketHistory {
  findings: ReturnType<typeof priorFindingRow>[]
  receipts: ReceiptRow[]
  commands: CommandRow[]
  boundary: number
}

function selectPacketHistory(issue: DeliveryIssue, budget: number): PacketHistory {
  const history: PacketHistory = { findings: [], receipts: [], commands: [], boundary: -1 }
  let used = 0
  const fits = (rows: readonly object[]) => {
    const bytes = rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify(row)) + 1, 0)
    if (used + bytes > budget) return false
    used += bytes
    return true
  }
  const finish = (boundary: number) => {
    history.boundary = boundary
    history.findings.reverse()
    history.receipts.reverse()
    history.commands.reverse()
    return history
  }
  for (let index = issue.submissions.length - 1; index >= 0; index -= 1) {
    const entry = issue.submissions[index]
    if (entry === undefined) continue
    const findings = currentDeliveryReport(entry).findings
    for (let row = findings.length - 1; row >= 0; row -= 1) {
      const finding = findings[row]
      if (finding === undefined) continue
      const priorFinding = priorFindingRow(entry, finding)
      if (!fits([priorFinding])) return finish(index)
      history.findings.push(priorFinding)
    }
    for (let row = entry.evidence.length - 1; row >= 0; row -= 1) {
      const evidence = entry.evidence[row]
      if (evidence === undefined) continue
      const receipt = receiptRow(entry, evidence)
      const command = isCommandEvidence(evidence) ? commandRow(entry, evidence) : undefined
      if (!fits(command === undefined ? [receipt] : [receipt, command])) return finish(index)
      history.receipts.push(receipt)
      if (command !== undefined) history.commands.push(command)
    }
  }
  return finish(-1)
}

function omittedHistory(issue: DeliveryIssue, history: PacketHistory) {
  const totals = issue.submissions.reduce(
    (sum, entry) => ({
      commands: sum.commands + entry.evidence.filter(isCommandEvidence).length,
      findings: sum.findings + currentDeliveryReport(entry).findings.length,
      receipts: sum.receipts + entry.evidence.length,
    }),
    { commands: 0, findings: 0, receipts: 0 },
  )
  const boundary = issue.submissions[history.boundary]
  return {
    limitBytes: deliveryPacketLimitBytes,
    previewCharacters: historyPreviewCharacters,
    submissions: issue.submissions.length,
    included: {
      commands: history.commands.length,
      findings: history.findings.length,
      receipts: history.receipts.length,
    },
    omitted: {
      commands: totals.commands - history.commands.length,
      findings: totals.findings - history.findings.length,
      receipts: totals.receipts - history.receipts.length,
    },
    earlierSubmissions: Math.max(0, history.boundary),
    reads: [
      ...(boundary === undefined ? [] : [submissionDigestLocator(issue.issue, boundary)]),
      ...(history.boundary > 0
        ? [{ action: 'read', issue: issue.issue, view: 'submissions', offset: 0, limit: 20 }]
        : []),
    ],
  }
}

export function deliveryReviewerPacket(issue: DeliveryIssue): string {
  const empty = selectPacketHistory(issue, -1)
  const required = Buffer.byteLength(packetText(issue, empty))
  if (required > deliveryPacketLimitBytes) {
    throw new DeliveryRejected(
      `The managed delivery contract needs ${required} UTF-8 bytes, above the ${deliveryPacketLimitBytes}-byte packet limit. Registered criteria, finding IDs, and the terminal packet are never truncated, so the dispatch is rejected before any Task starts.`,
    )
  }
  let budget = deliveryPacketLimitBytes - required
  for (;;) {
    const packet = packetText(issue, selectPacketHistory(issue, budget))
    const excess = Buffer.byteLength(packet) - deliveryPacketLimitBytes
    if (excess <= 0) return packet
    budget -= excess
  }
}

function packetText(issue: DeliveryIssue, history: PacketHistory): string {
  const summary = summarizeDelivery(issue)
  const latest = issue.submissions.at(-1)
  const owner = issue.submissions.findLast(
    (entry) =>
      currentDeliveryReport(entry).kind === 'implementation' && isImplementationRole(entry.role),
  )
  const findingIds = new Set(
    issue.submissions.flatMap((entry) =>
      currentDeliveryReport(entry).findings.map((finding) => finding.id),
    ),
  )
  return [
    `Managed issue: ${issue.issue}. Delivery: ${summary.state}.`,
    `Report limits: issue id 256 characters, reason ${DELIVERY_REASON_LIMIT}, 128 criteria, 256 findings, and 16 evidence references per criterion or finding. Oversized prose is truncated; oversized evidence arrays are rejected.`,
    `Registered criterion IDs: ${issue.criteria.map((criterion) => criterion.id).join(', ')}.`,
    'Report every registered criterion, including previously passing criteria. Do not rename criteria or add finding IDs as criteria.',
    `Open criteria: ${summary.unresolvedCriteria.join(', ') || 'none'}.`,
    ...issue.criteria.map((criterion) => `${criterion.id}: ${criterion.description}`),
    `Registered finding IDs: ${[...findingIds].join(', ') || 'none'}.`,
    `Prior findings with severity and disposition: ${JSON.stringify(history.findings)}`,
    'Reuse complete finding IDs. Do not abbreviate or renumber them. Put dispositions in findings and explanations in reason.',
    `Open blocking findings: ${summary.unresolvedFindings.join(', ') || 'none'}.`,
    `Implementation owner: ${owner?.agentId ?? 'none'}. Last reporter: ${latest?.agentId ?? 'none'}. Last reason: ${latest === undefined ? 'none' : currentDeliveryReport(latest).reason || 'none'}.`,
    `Exact candidate identity: ${JSON.stringify(summary.artifact ?? null)}`,
    `Digest-addressable retained receipt index: ${JSON.stringify(history.receipts)}`,
    `Prior harness and gate command/log locators: ${JSON.stringify(history.commands)}`,
    `Omitted retained history: ${JSON.stringify(omittedHistory(issue, history))}`,
    `History rows above are the most recent entries that fit the ${deliveryPacketLimitBytes}-byte packet. Long commands and references show a marked preview. Omitted history stays noncurrent. The listed reads, and view: submission with a row's agentId and attempt, are pstack_delivery inputs for the coordinator session that owns this issue ledger. They do not grant ledger access to this Task. Ask that coordinator for omitted or truncated detail you need.`,
    'Retained receipt entries are prior-attempt locators only. They are not current command:n or read:n aliases and do not establish proof reuse. Current-attempt aliases are created only by tools in this attempt.',
    'Preserve explicit reading requirements. Reuse accepted grounding and inspect only necessary changes when that policy permits.',
    'Return only the JSON report. Do not wrap it in Markdown or surrounding text.',
    'Evidence arrays contain recorded receipt IDs, not prose or file paths. Put explanations and file-line references in reason.',
    'Cite shell receipts as command:1, command:2, and later values in execution order. Read-only static reviews and diagnoses may cite read:1, read:2, and later values in read execution order. Cite patch:<repository relative path, or .> for captured patches. Never invent a receipt reference.',
    'Receipt numbering belongs to the current attempt. A resume transfers no previous alias, including command:n, read:n, and every other family.',
    'A resumed attempt starts an empty receipt index. Reopen in this attempt every file or command you cite, or cite patch:<path> for the captured artifact.',
    'An implementation candidate requires at least one successful command receipt from this attempt.',
    ...(issue.runtimeRequired
      ? [
          'This issue requires runtime verification, which proves the criteria that need execution. A read-only static review passes each criterion that reading proves, marks each criterion that needs execution as pending, and returns state candidate when it finds no blocking defect. It returns accepted only when reading proves every criterion.',
        ]
      : []),
    'A failed command receipt never proves a passing criterion. Re-run the command after the fix and cite the successful alias, or report the criterion as not passing.',
    'An incomplete report needs an explicit reason. An edit mismatch is recoverable and does not erase actionable obligations.',
    `${deliveryPacketPrefix}${JSON.stringify(terminalDeliveryPacket(issue))}`,
  ].join('\n')
}

function parseTerminalDeliveryPacket(prompt: string): TerminalDeliveryPacket | undefined {
  const line = prompt.split('\n').findLast((entry) => entry.startsWith(deliveryPacketPrefix))
  if (line === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(line.slice(deliveryPacketPrefix.length))
    return Value.Check(TerminalDeliveryPacketSchema, parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function terminalArtifact(
  input: TerminalValidationInput,
  packet: TerminalDeliveryPacket,
  report: DeliveryReport,
): DeliveryArtifact | undefined {
  if (report.kind === 'implementation') {
    return implementationArtifact(input.isolation, input.workspaceIdentity, input.inPlace)
  }
  if (report.kind === 'diagnosis') return undefined
  return reviewerArtifact(
    input.role,
    input.readonly,
    input.isolation,
    input.workspaceIdentity,
    packet.artifact,
    input.inPlace,
  )
}

function terminalEvidence(
  input: TerminalValidationInput,
  report: DeliveryReport | undefined,
): DeliveryEvidence[] {
  const evidence: DeliveryEvidence[] = []
  const inPlaceRepositories =
    input.inPlace?.status === 'captured' ? input.inPlace.repositories : undefined
  for (const repository of inPlaceRepositories ?? []) {
    evidence.push({
      id: `patch:${repository.relativePath || '.'}`,
      kind: 'patch',
      passed: true,
      reference: repository.patch.uri,
      sha256: repository.patch.sha256,
      status: 'success',
    })
  }
  for (const repository of input.isolation?.repositories ?? []) {
    evidence.push({
      id: `patch:${repository.relativePath || '.'}`,
      kind: 'patch',
      passed: true,
      reference: repository.patch.uri,
      sha256: repository.patch.sha256,
      status: 'success',
    })
  }
  if (input.isolation === undefined && inPlaceRepositories === undefined) {
    for (const repository of input.workspaceIdentity?.snapshot.repositories ?? []) {
      evidence.push({
        id: `patch:${repository.relativePath || '.'}`,
        kind: 'patch',
        passed: true,
        reference: repository.patch.uri,
        sha256: repository.patch.sha256,
        status: 'success',
      })
    }
  }
  const counters = new Map<string, number>()
  for (const receipt of input.toolExecutionReceipts) {
    if (!['bash', 'powershell', 'read'].includes(receipt.tool)) continue
    if (receipt.tool === 'read' && !includesReadReceipts(report, input.role, input.readonly)) {
      continue
    }
    const family = receipt.tool === 'read' ? 'read' : 'command'
    const index = (counters.get(family) ?? 0) + 1
    counters.set(family, index)
    const passed = receipt.status === 'success' && !receipt.isError
    const entry: DeliveryEvidence = {
      id: `${family}:${index}`,
      kind: passed ? 'command' : 'failure',
      passed,
      reference: receipt.output.uri,
      sha256: receipt.output.sha256,
      status: passed ? 'success' : 'error',
    }
    const command = evidenceCommand(receipt.command)
    if (command !== undefined) entry.command = command
    evidence.push(entry)
  }
  return evidence
}

function reportDraft(output: StructuredOutput | undefined): DeliveryReportDraft | undefined {
  if (output?.status !== 'valid') return undefined
  const draft = deliveryReportDraft(output.data)
  return draft === undefined
    ? undefined
    : { ...draft, report: normalizeDeliveryReportProse(draft.report) }
}

function semanticReport(input: TerminalValidationInput): DeliveryReportDraft | undefined {
  return reportDraft(
    input.previousOutputs.length === 0
      ? input.structuredOutput
      : input.previousOutputs[0]?.structuredOutput,
  )
}

export function validateDeliveryTerminal(input: TerminalValidationInput): TerminalValidationResult {
  const packet = parseTerminalDeliveryPacket(input.prompt)
  if (packet === undefined) return { status: 'accepted' }
  const diagnostics: string[] = []
  const structured = input.structuredOutput
  const draft = reportDraft(structured)
  const evidenceEntries = terminalEvidence(input, draft?.report)
  const report =
    draft === undefined ? undefined : pruneFailedPassEvidence(draft.report, evidenceEntries).report
  const normalized =
    report !== undefined && !jsonEquals(decodeJsonValue(report), structured?.data ?? null)
  const fullSchemaValid = report !== undefined && Value.Check(DeliveryReportSchema, report)
  if (!fullSchemaValid) {
    if (structured?.status !== 'valid') {
      diagnostics.push(structured?.error ?? 'The structured delivery report is unavailable.')
    } else {
      for (const error of Value.Errors(DeliveryReportSchema, report ?? structured.data)) {
        diagnostics.push(`${error.instancePath || '/'}: ${error.message}`)
      }
    }
  }
  let artifactFailure = false
  if (report !== undefined) {
    let artifact: DeliveryArtifact | undefined
    try {
      artifact = terminalArtifact(input, packet, report)
    } catch (error) {
      if (report.state === 'candidate' || report.state === 'accepted') {
        artifactFailure = true
        diagnostics.push(error instanceof DeliveryRejected ? error.reason : String(error))
      }
    }
    const submission: DeliverySubmission = {
      agentId: input.agentId,
      attempt: input.attempt,
      evidence: evidenceEntries,
      execution: 'completed',
      integration: 'captured',
      recordedAt: Date.now(),
      report,
      role: input.role ?? 'unassigned',
    }
    if (artifact !== undefined) submission.artifact = artifact
    const issue: DeliveryIssue = {
      version: 1,
      createdAt: 0,
      criteria: packet.criteria,
      issue: packet.issue,
      ownerSessionId: packet.ownerSessionId,
      runtimeRequired: packet.runtimeRequired,
      submissions: [],
    }
    diagnostics.push(...deliveryReportDiagnostics(issue, submission))
    if (fullSchemaValid && diagnostics.length === 0) {
      const result = recordDelivery(issue, submission)
      if (!result.ok) diagnostics.push(result.error.reason)
    }
    const original = semanticReport(input)
    if (input.previousOutputs.length > 0) {
      if (original === undefined && report.state !== 'wip') {
        diagnostics.push(
          'The original report semantics are unavailable, so correction must remain WIP.',
        )
      } else if (original !== undefined) {
        const basis = original.failureClassProvided
          ? original.report
          : { ...original.report, failureClass: report.failureClass }
        if (!sameDeliveryTechnicalVerdict(basis, report)) {
          diagnostics.push('Correction cannot change the original technical verdict.')
        }
      }
    }
  }
  const unique = [...new Set(diagnostics)]
  if (unique.length === 0) {
    return normalized && report !== undefined
      ? { normalizedOutput: JSON.stringify(report), status: 'accepted' }
      : { status: 'accepted' }
  }
  const failedAliases = evidenceEntries
    .filter((entry) => !entry.passed || entry.kind === 'failure')
    .map((entry) => entry.id)
  const evidence = evidenceEntries
    .map(
      (entry) =>
        `${entry.id} status=${entry.status ?? (entry.passed ? 'success' : 'error')} sha256=${entry.sha256} reference=${entry.reference}`,
    )
    .join('\n')
  const error = unique.join(' ')
  return {
    status: 'rejected',
    correctionAllowed: !artifactFailure,
    error,
    correctionPrompt: [
      'Your terminal delivery report was rejected. Return only a corrected JSON report.',
      'This is a report-only correction. No tools are available. Do not claim new work or invent proof.',
      `Diagnostics: ${error}`,
      `Return a shorter report. Keep /reason at or below ${DELIVERY_REASON_LIMIT} characters, preferably below 2048, while retaining concrete conclusions. Keep exact receipt IDs in evidence arrays.`,
      `Failed current-attempt receipts: ${failedAliases.join(', ') || 'none'}. Never cite them for a passing criterion.`,
      'Keep the technical verdict identical: the same state and the same result for every criterion. A changed verdict fails the correction outright.',
      'Replace a missing receipt reference with an alias from the index below, or with patch:<path>. Never invent one, and never drop the last evidence of a passing criterion.',
      `Immutable current-attempt receipt index:\n${evidence || 'none'}`,
      'Preserve the original kind and failure class. Never promote readiness or criterion outcomes, erase findings, weaken blocking severity, or close an open finding. When immutable proof is unavailable, conservatively return WIP with non-passing criteria or open blockers. Only serialization, prose, exact receipt references, and conservative downgrades may be repaired.',
    ].join('\n'),
  }
}

async function preflight(
  task: Static<typeof TaskViewSchema>,
  ctx: ExtensionContext,
): Promise<void> {
  const records =
    readSubagentState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId())?.records ??
    []
  const resumed =
    task.resume === undefined ? undefined : records.find((record) => record.agentId === task.resume)
  const role = resumed?.role ?? task.role
  const readonly = task.readonly ?? resumed?.readonly
  const bindings = loadBindings(ctx)
  const issues = loadIssues(ctx)
  const issueIds = [...task.prompt.matchAll(/^\s*issue\s*:\s*(\S+)\s*$/gim)].map(
    (match) => match[1],
  )
  const promptIssue = issueIds[0]
  const resumedIssue = resumed === undefined ? undefined : issueFromRecord(resumed, bindings)
  const retainedDelivery =
    resumed?.execution?.version === 5 ? resumed.execution.delivery : undefined
  const storedDeliveryContract = hasStoredDeliveryContract(resumed)
  const explicitDeliverySchema = isDeliveryOutputSchema(task.outputSchema)
  const deliveryTask = isDeliveryRole(role, readonly)
  if (issueIds.length > 1)
    throw new DeliveryRejected('A managed Task requires exactly one issue field.')
  if (
    task.delivery?.kind === 'managed' &&
    promptIssue !== undefined &&
    task.delivery.issue !== promptIssue
  ) {
    throw new DeliveryRejected(
      'The structured delivery issue conflicts with the legacy issue field.',
    )
  }
  if (retainedDelivery?.kind === 'independent') {
    if (task.delivery?.kind === 'managed') {
      throw new DeliveryRejected('Independent resume cannot change its retained delivery binding.')
    }
    task.delivery = { kind: 'independent' }
  }
  if (task.delivery?.kind === 'independent') {
    if (promptIssue !== undefined) {
      throw new DeliveryRejected(
        `An independent Task cannot include a managed issue field. Remove the issue: ${promptIssue} line from the prompt, or pass delivery: { kind: "managed", issue: "${promptIssue}" }.`,
      )
    }
    if (
      retainedDelivery?.kind === 'managed' ||
      (retainedDelivery === undefined && (resumedIssue !== undefined || storedDeliveryContract))
    ) {
      throw new DeliveryRejected('Managed resume cannot escape its retained issue binding.')
    }
    if (issues.size > 0 && role === 'publication') {
      throw new DeliveryRejected(
        `Managed publication cannot opt out of its accepted issue checkpoint. Pass delivery: { kind: "managed", issue: <id> } for one of: ${[...issues.keys()].join(', ')}.`,
      )
    }
    return
  }
  const issueId =
    task.delivery?.kind === 'managed'
      ? task.delivery.issue
      : retainedDelivery?.kind === 'managed'
        ? retainedDelivery.issue
        : (promptIssue ?? resumedIssue)
  if (issueId === undefined) {
    if (storedDeliveryContract)
      throw new DeliveryRejected('Managed resume requires the retained issue binding.')
    if (issues.size > 0 && (deliveryTask || explicitDeliverySchema)) {
      if (role === 'publication')
        throw new DeliveryRejected(
          'Managed publication requires an explicit issue binding and an accepted issue checkpoint.',
        )
      throw new DeliveryRejected(
        'Managed delivery requires an issue binding through delivery.kind managed or one legacy issue field.',
      )
    }
    return
  }
  if (resumedIssue !== undefined && resumedIssue !== issueId) {
    throw new DeliveryRejected('Managed resume cannot change its retained issue binding.')
  }
  task.delivery = { issue: issueId, kind: 'managed' }
  const issue = issues.get(issueId)
  if (issue === undefined)
    throw new DeliveryRejected(`Open the managed issue before dispatch: ${issueId}`)
  const unrecordedTerminalRuns = records.filter(
    (record) =>
      record.status !== 'running' &&
      issueFromRecord(record, bindings) === issueId &&
      !issue.submissions.some(
        (submission) =>
          submission.agentId === record.agentId &&
          submission.attempt === (record.runGeneration ?? 1),
      ),
  )
  if (isImplementationRole(role) && unrecordedTerminalRuns.length > 0) {
    const pending = unrecordedTerminalRuns
      .map((record) => `${record.agentId} attempt ${record.runGeneration ?? 1} (${record.status})`)
      .join('; ')
    throw new DeliveryRejected(
      `Record each terminal issue attempt before another implementation dispatch. Unrecorded: ${pending}. Call pstack_delivery record for each one first, then dispatch.`,
    )
  }
  if (task.resume !== undefined) {
    const contract = resumed?.execution
    if (
      resumed === undefined ||
      contract === undefined ||
      contract.version === 1 ||
      contract.outputSchema === undefined ||
      !jsonEquals(contract.outputSchema, DeliveryOutputSchema)
    ) {
      throw new DeliveryRejected(
        `Managed resume requires its stored delivery output contract. Agent ${task.resume} ${resumed === undefined ? 'is unknown to this session' : 'was not dispatched as a managed delivery Task'}. Dispatch a fresh managed Task for issue ${issueId} instead of resuming it.`,
      )
    }
    if (
      resumed.status !== 'running' &&
      !issue.submissions.some(
        (submission) =>
          submission.agentId === resumed.agentId &&
          submission.attempt === (resumed.runGeneration ?? 1),
      )
    ) {
      throw new DeliveryRejected(
        `Record the prior terminal attempt before managed resume. Call pstack_delivery record for agent ${resumed.agentId} attempt ${resumed.runGeneration ?? 1} (${resumed.status}), then resume.`,
      )
    }
  }
  const workspace = loadWorkspaces(ctx).get(issueId)
  if (workspace !== undefined) await applyIssueWorkspace(task, role, readonly, workspace, ctx)
  const summary = summarizeDelivery(issue)
  const currentArtifact = summary.artifact
  const currentArtifactReviews =
    currentArtifact === undefined
      ? []
      : issue.submissions.filter(
          (submission) =>
            isTechnicalSubmission(submission) &&
            submission.artifact !== undefined &&
            sameDeliveryArtifact(submission.artifact, currentArtifact),
        )
  const latestArtifactReview = currentArtifactReviews.findLast(
    (submission) =>
      currentDeliveryReport(submission).kind ===
      (role === 'code review' ? 'technical-review' : 'runtime-verification'),
  )
  const recoverable =
    latestArtifactReview?.failureKind === 'report-contract' &&
    (latestArtifactReview.reportCorrections?.length ?? 0) === 0
      ? latestArtifactReview
      : undefined
  if (
    recoverable !== undefined &&
    task.resume === undefined &&
    (role === 'code review' || role === 'runtime verification')
  ) {
    const identity = deliveryRepairIdentity(recoverable)
    throw new DeliveryRejected(
      `Repair the retained report before allocating a replacement review: ${JSON.stringify({
        action: 'read',
        agentId: recoverable.agentId,
        attempt: recoverable.attempt,
        issue: issue.issue,
        view: 'submission',
        repairIdentity: identity,
      })}`,
    )
  }
  if (role === 'publication') {
    if (task.run_in_background !== false)
      throw new DeliveryRejected(
        'Publication must remain explicitly foreground. Pass run_in_background: false.',
      )
    if (
      summary.state !== 'accepted' ||
      summary.integration !== 'integrated' ||
      summary.artifact === undefined
    ) {
      throw new DeliveryRejected(
        `Publication requires independent acceptance and integration of the current artifact. ${stateHint(summary, issueId)} ${summary.state !== 'accepted' ? 'Obtain accepted static and runtime verdicts on the current candidate first.' : 'Call pstack_delivery refresh after the owner integration settles.'}`,
      )
    }
    const current = await captureWorkspaceSnapshot(resolve(ctx.cwd, task.cwd ?? '.'))
    if (current === undefined || !matchesCandidateSnapshot(summary.artifact, current)) {
      throw new DeliveryRejected(
        `The destination artifact changed after acceptance. ${artifactMismatch(summary.artifact, current)}`,
      )
    }
    return
  }
  if (role === 'code review') {
    if (!readonly) {
      throw new DeliveryRejected(
        'Static review requires a read-only Task. Pass readonly: true, or use a read-only agent.',
      )
    }
    if (summary.state !== 'candidate' || summary.artifact === undefined) {
      throw new DeliveryRejected(
        `Static review requires the current candidate artifact. ${stateHint(summary, issueId)} ${summary.state === 'accepted' ? 'The candidate is already accepted; dispatch publication.' : 'Record an implementation candidate with a captured artifact first.'}`,
      )
    }
    const current = await captureWorkspaceSnapshot(effectiveTaskCwd(task, resumed, ctx))
    if (current === undefined || !matchesCandidateSnapshot(summary.artifact, current)) {
      throw new DeliveryRejected(
        `Static review must start from the current candidate artifact. ${artifactMismatch(summary.artifact, current)}`,
      )
    }
  }
  if (role === 'runtime verification') {
    if (readonly) {
      throw new DeliveryRejected(
        'Runtime verification requires a writable shell. Pass readonly: false and a shell-capable agent.',
      )
    }
    const isolation = effectiveRuntimeIsolation(task, resumed)
    const inPlace = isolation?.mode === 'in-place'
    if (inPlace && workspace === undefined) {
      throw new DeliveryRejected(
        `In-place runtime verification requires the issue workspace. Call pstack_delivery workspace for ${issueId} first, or pass isolation: { mode: "worktree", integration: "manual" }.`,
      )
    }
    if (!inPlace && (isolation?.mode !== 'worktree' || isolation.integration !== 'manual')) {
      throw new DeliveryRejected(
        'Runtime verification requires manual worktree isolation. Pass isolation: { mode: "worktree", integration: "manual" }.',
      )
    }
    if (
      summary.state !== 'candidate' ||
      summary.integration !== 'integrated' ||
      summary.artifact === undefined
    ) {
      throw new DeliveryRejected(
        `Runtime verification requires the integrated candidate artifact. ${stateHint(summary, issueId)} ${summary.state !== 'candidate' ? 'Record an implementation candidate first.' : 'Join the owner Task so its isolation integrates, then call pstack_delivery refresh.'}`,
      )
    }
    const current = await captureWorkspaceSnapshot(effectiveTaskCwd(task, resumed, ctx))
    if (current === undefined || !matchesCandidateSnapshot(summary.artifact, current)) {
      throw new DeliveryRejected(
        `Runtime verification must start from the current candidate artifact. ${artifactMismatch(summary.artifact, current)}`,
      )
    }
  }
  if (summary.diagnosisRequired && isImplementationRole(role)) {
    throw new DeliveryRejected(
      'Two incomplete returns without proven progress require a recorded diagnosis before equivalent redispatch.',
    )
  }
  if (task.outputSchema !== undefined && !isDeliveryOutputSchema(task.outputSchema)) {
    throw new DeliveryRejected(
      'Managed delivery uses its exact report schema. Do not replace an existing resume contract. Omit outputSchema and schemaMode; the managed preflight installs them.',
    )
  }
  const packet = deliveryReviewerPacket(issue)
  task.outputSchema = structuredClone(DeliveryOutputSchema)
  task.schemaMode = 'strict'
  task.prompt = `${promptIssue === undefined ? `issue: ${issueId}\n` : ''}${task.prompt}\n\n${packet}`
}

export function registerDeliveryProtocol(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_delivery',
    label: 'Delivery',
    executionMode: 'sequential',
    description:
      'Open criteria, prepare the issue workspace, read a compact checkpoint, or record a terminal Task report using trusted artifacts and receipts. Workspace: creates or returns one persistent Git worktree on branch pstack/<issue>, copies .worktreeinclude files, shares node_modules, and runs .pstack/worktree-setup.sh once. Managed Tasks for that issue then default to its cwd, and writers run in place. Every checkpoint names next: the deterministic next pipeline step. Read view: submissions or criteria pages retained data. Oversized submissions return a detail locator. View: submission with agentId and attempt returns exact JSON chunks using UTF-16 offset and limit. Concatenate content chunks before parsing. Output and details stay within 32 KiB. Execution completion never implies acceptance.',
    parameters: DeliveryToolSchema,
    outputSchema: DeliveryToolOutputSchema,
    async execute(_callId, input, _signal, _onUpdate, ctx) {
      const journal = loadJournal(ctx)
      let issue = journal.issues.get(input.issue)
      if (input.action === 'workspace') {
        if (issue === undefined) throw new DeliveryRejected('The managed issue does not exist.')
        let workspace = loadWorkspaces(ctx).get(issue.issue)
        const live = workspace !== undefined && (await workspaceIsLive(workspace))
        if (live && workspace !== undefined && input.base !== undefined) {
          throw new DeliveryRejected(
            `The workspace for issue ${issue.issue} already exists on base ${workspace.base}. Omit base.`,
          )
        }
        if (workspace === undefined || !live) {
          const request: Parameters<typeof prepareIssueWorkspace>[0] = {
            cwd: ctx.cwd,
            issue: issue.issue,
            ownerSessionId: ctx.sessionManager.getSessionId(),
          }
          if (input.base !== undefined) request.base = input.base
          workspace = await prepareIssueWorkspace(request)
          pi.appendEntry(deliveryWorkspaceEntryType, workspace)
        }
        const page = { ...workspace, next: deliveryNext(issue, ctx, true) }
        return {
          content: [{ type: 'text', text: JSON.stringify(page) }],
          details: { issue: issue.issue, truncated: false, workspace },
          structuredContent: { issue: issue.issue, page, truncated: false },
        }
      }
      if (input.action === 'open') {
        if (issue !== undefined)
          throw new DeliveryRejected(
            'Issue criteria are immutable after opening. Read the existing checkpoint.',
          )
        const parsed = parseDeliveryIssue({
          version: 1,
          issue: input.issue,
          ownerSessionId: ctx.sessionManager.getSessionId(),
          criteria: input.criteria,
          runtimeRequired: input.runtimeRequired,
          submissions: [],
          createdAt: Date.now(),
        })
        if (!parsed.ok) throw parsed.error
        issue = parsed.value
      } else if (issue === undefined)
        throw new DeliveryRejected('The managed issue does not exist.')
      if (input.action === 'repair') {
        const recordedAt = Date.now()
        const updated = repairDeliveryReport(issue, { ...input, recordedAt })
        if (!updated.ok) throw updated.error
        issue = updated.value
        const previous = journal.heads.get(issue.issue)
        if (previous === undefined)
          throw new DeliveryRejected('The delivery journal lost its issue head.')
        const event = makeDeliveryJournalEvent({
          version: 1,
          kind: 'repair',
          ownerSessionId: issue.ownerSessionId,
          issue: issue.issue,
          previous,
          agentId: input.agentId,
          artifactSha256: input.artifactSha256,
          attempt: input.attempt,
          evidenceSha256: input.evidenceSha256,
          recordedAt,
          report: input.report,
          reportSha256: input.reportSha256,
          revision: input.revision,
        })
        if (!event.ok) throw event.error
        pi.appendEntry(deliveryJournalEntryType, event.value)
      }
      if (input.action === 'record' || input.action === 'refresh') {
        const records =
          readSubagentState(ctx.sessionManager.getBranch(), ctx.sessionManager.getSessionId())
            ?.records ?? []
        const record = records.find((entry) => entry.agentId === input.agentId)
        if (record === undefined)
          throw new DeliveryRejected('No owned runtime record exists for this agent.')
        const binding = loadBindings(ctx).get(record.agentId)
        if (binding !== undefined && binding !== issue.issue)
          throw new DeliveryRejected('The runtime attempt belongs to another managed issue.')
        if (input.action === 'refresh' && deliveryIntegration(record) !== 'integrated') {
          throw new DeliveryRejected('Integration refresh requires a trusted integrated receipt.')
        }
        const existing = issue.submissions.find(
          (entry) =>
            entry.agentId === record.agentId && entry.attempt === (record.runGeneration ?? 1),
        )
        let updated: DeliveryResult<DeliveryIssue>
        if (input.action === 'record') {
          updated = recordDelivery(issue, await collectSubmission(record, issue))
        } else {
          if (existing === undefined) {
            throw new DeliveryRejected('No recorded attempt exists to refresh.')
          }
          updated = refreshDeliveryIntegration(issue, {
            ...existing,
            integration: deliveryIntegration(record),
          })
        }
        if (
          !updated.ok &&
          input.action === 'record' &&
          !issue.submissions.some(
            (entry) =>
              entry.agentId === record.agentId && entry.attempt === (record.runGeneration ?? 1),
          )
        )
          updated = recordDelivery(
            issue,
            await unprovenSubmission(record, issue, updated.error.message),
          )
        if (!updated.ok) throw updated.error
        issue = updated.value
        const previous = journal.heads.get(issue.issue)
        const submission = issue.submissions.find(
          (entry) =>
            entry.agentId === record.agentId && entry.attempt === (record.runGeneration ?? 1),
        )
        if (previous === undefined || submission === undefined)
          throw new DeliveryRejected(
            'The delivery journal lost its issue head or current submission.',
          )
        const identity = {
          version: 1,
          ownerSessionId: issue.ownerSessionId,
          issue: issue.issue,
          previous,
        }
        const event = makeDeliveryJournalEvent(
          input.action === 'record'
            ? { ...identity, kind: 'record', submission }
            : {
                ...identity,
                kind: 'refresh',
                agentId: submission.agentId,
                attempt: submission.attempt,
                integration: submission.integration,
              },
        )
        if (!event.ok) throw event.error
        pi.appendEntry(deliveryJournalEntryType, event.value)
      }
      if (input.action === 'open') pi.appendEntry(entryType, issue)
      const view = deliveryView(
        issue,
        input.action === 'read' ? input : { action: 'read', issue: issue.issue },
        deliveryNext(issue, ctx),
      )
      if (!view.ok) throw view.error
      const page: JsonValue = JSON.parse(view.value.text)
      return {
        content: [{ type: 'text', text: view.value.text }],
        details: view.value.details,
        structuredContent: {
          issue: view.value.details.issue,
          page,
          truncated: view.value.details.truncated,
        },
      }
    },
  })
  pi.on('tool_result', (event, ctx) => {
    if (event.toolName !== 'Task') return
    const bindings = loadBindings(ctx)
    const bind = (task: Static<typeof TaskViewSchema>, agentId: string) => {
      const issue = task.delivery?.kind === 'managed' ? task.delivery.issue : undefined
      if (issue === undefined) return
      const previous = bindings.get(agentId)
      if (previous === issue) return
      if (previous !== undefined)
        throw new DeliveryRejected('Managed dispatch cannot rebind an existing agent.')
      pi.appendEntry(bindingEntryType, {
        agentId,
        issue,
        ownerSessionId: ctx.sessionManager.getSessionId(),
        toolCallId: event.toolCallId,
      })
      bindings.set(agentId, issue)
    }
    if (
      Value.Check(BatchViewSchema, event.input) &&
      Value.Check(BatchResultSchema, event.details)
    ) {
      for (const result of event.details.items) {
        const task = event.input.tasks.find((entry) => entry.id === result.taskId)
        if (task !== undefined && result.agentId !== undefined && result.attemptStarted !== false)
          bind(task, result.agentId)
      }
    } else if (
      Value.Check(TaskViewSchema, event.input) &&
      Value.Check(TaskResultSchema, event.details) &&
      event.details.attemptStarted !== false
    )
      bind(event.input, event.details.agentId)
    if (
      event.isError ||
      !Value.Check(TaskViewSchema, event.input) ||
      !Value.Check(CompletedTaskResultSchema, event.details) ||
      event.input.role !== 'publication' ||
      event.input.run_in_background !== false ||
      event.input.delivery?.kind !== 'managed'
    )
      return
    const notice = publicationReleaseNotice(
      event.input.delivery.issue,
      resolve(ctx.cwd, event.input.cwd ?? '.'),
    )
    const content = [...event.content, { text: notice, type: 'text' as const }]
    return event.structuredContent === undefined
      ? { content }
      : { content, structuredContent: event.structuredContent }
  })
  pi.on('tool_call', (event) => {
    if (event.toolName !== 'TaskControl') return
    if (Value.Check(CompletionWaitSchema, event.input)) normalizeCompletionWait(event.input)
  })
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'Task') return
    if (Value.Check(BatchViewSchema, event.input)) {
      const tasks = event.input.tasks
      const prepared = tasks.map((task) => structuredClone(task))
      for (const task of prepared) await preflight(task, ctx)
      for (const [index, task] of prepared.entries()) {
        const original = tasks[index]
        if (original === undefined)
          throw new DeliveryRejected('The Task batch changed during preflight.')
        Object.assign(original, task)
      }
    } else if (Value.Check(TaskViewSchema, event.input)) await preflight(event.input, ctx)
  })
}
