import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  captureWorkspaceSnapshot,
  decodeJsonValue,
  jsonEquals,
  readSubagentState,
  type RunRecord,
  type StructuredOutput,
  type TerminalValidationInput,
  type TerminalValidationResult,
  type WorkspaceSnapshot,
} from '@nothingrotf/subagent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import {
  deliveryJournalEntryType,
  makeDeliveryJournalEvent,
  readDeliveryJournal,
} from './delivery-journal.ts'
import { isDeliveryRole, isImplementationRole } from './delivery-roles.ts'
import { DeliveryReadSchema, deliveryView } from './delivery-views.ts'
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

const DeliveryToolSchema = Type.Union(
  [
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
  ],
  { type: 'object' },
)

function loadJournal(ctx: Pick<ExtensionContext, 'sessionManager'>) {
  const journal = readDeliveryJournal(
    ctx.sessionManager.getBranch(),
    ctx.sessionManager.getSessionId(),
  )
  if (!journal.ok) throw journal.error
  return journal.value
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

function implementationArtifact(
  isolation: TerminalValidationInput['isolation'],
  workspaceIdentity: TerminalValidationInput['workspaceIdentity'],
): DeliveryArtifact {
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
  return implementationArtifact(record.isolation, workspaceIdentity)
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
): DeliveryArtifact {
  if (candidate === undefined)
    throw new DeliveryRejected('No implementation artifact exists for this review.')
  const snapshot = workspaceIdentity?.snapshot
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
  if (record.isolation === undefined && (execution?.version === 4 || execution?.version === 5)) {
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
    if (record.isolation !== undefined && record.isolation.repositories.length > 0)
      artifact = artifactFromRun(record)
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
  if (structured?.kind === 'implementation' && record.isolation?.repositories.length) {
    submission.artifact = artifactFromRun(record)
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

export function deliveryReviewerPacket(issue: DeliveryIssue): string {
  const summary = summarizeDelivery(issue)
  const latest = issue.submissions.at(-1)
  const owner = issue.submissions.findLast(
    (entry) =>
      currentDeliveryReport(entry).kind === 'implementation' && isImplementationRole(entry.role),
  )
  const priorFindings = issue.submissions.flatMap((entry) =>
    currentDeliveryReport(entry).findings.map((finding) => ({
      agentId: entry.agentId,
      attempt: entry.attempt,
      id: finding.id,
      severity: finding.blocking ? 'blocking' : 'non-blocking',
      disposition: finding.disposition,
      evidence: finding.evidence,
    })),
  )
  const findingIds = new Set(priorFindings.map((finding) => finding.id))
  const receiptIndex = issue.submissions.flatMap((entry) =>
    entry.evidence.map((evidence) => ({
      agentId: entry.agentId,
      attempt: entry.attempt,
      id: evidence.id,
      kind: evidence.kind,
      status: evidence.status ?? (evidence.passed ? 'success' : 'error'),
      sha256: evidence.sha256,
      reference: evidence.reference,
    })),
  )
  const commandLocators = issue.submissions.flatMap((entry) =>
    entry.evidence
      .filter((evidence) => evidence.kind === 'command' || evidence.kind === 'failure')
      .map((evidence) => ({
        agentId: entry.agentId,
        attempt: entry.attempt,
        id: evidence.id,
        command: evidence.command ?? null,
        sha256: evidence.sha256,
        log: evidence.reference,
      })),
  )
  return [
    `Managed issue: ${issue.issue}. Delivery: ${summary.state}.`,
    `Report limits: issue id 256 characters, reason ${DELIVERY_REASON_LIMIT}, 128 criteria, 256 findings, and 16 evidence references per criterion or finding. Oversized prose is truncated; oversized evidence arrays are rejected.`,
    `Registered criterion IDs: ${issue.criteria.map((criterion) => criterion.id).join(', ')}.`,
    'Report every registered criterion, including previously passing criteria. Do not rename criteria or add finding IDs as criteria.',
    `Open criteria: ${summary.unresolvedCriteria.join(', ') || 'none'}.`,
    ...issue.criteria.map((criterion) => `${criterion.id}: ${criterion.description}`),
    `Registered finding IDs: ${[...findingIds].join(', ') || 'none'}.`,
    `Prior findings with severity and disposition: ${JSON.stringify(priorFindings)}`,
    'Reuse complete finding IDs. Do not abbreviate or renumber them. Put dispositions in findings and explanations in reason.',
    `Open blocking findings: ${summary.unresolvedFindings.join(', ') || 'none'}.`,
    `Implementation owner: ${owner?.agentId ?? 'none'}. Last reporter: ${latest?.agentId ?? 'none'}. Last reason: ${latest === undefined ? 'none' : currentDeliveryReport(latest).reason || 'none'}.`,
    `Exact candidate identity: ${JSON.stringify(summary.artifact ?? null)}`,
    `Digest-addressable retained receipt index: ${JSON.stringify(receiptIndex)}`,
    `Prior harness and gate command/log locators: ${JSON.stringify(commandLocators)}`,
    'Retained receipt entries are prior-attempt locators only. They are not current command:n or read:n aliases and do not establish proof reuse. Current-attempt aliases are created only by tools in this attempt.',
    'Preserve explicit reading requirements. Reuse accepted grounding and inspect only necessary changes when that policy permits.',
    'Return only the JSON report. Do not wrap it in Markdown or surrounding text.',
    'Evidence arrays contain recorded receipt IDs, not prose or file paths. Put explanations and file-line references in reason.',
    'Cite shell receipts as command:1, command:2, and later values in execution order. Read-only static reviews and diagnoses may cite read:1, read:2, and later values in read execution order. Cite patch:<repository relative path, or .> for captured patches. Never invent a receipt reference.',
    'Receipt numbering belongs to the current attempt. A resume transfers no previous alias, including command:n, read:n, and every other family.',
    'A resumed attempt starts an empty receipt index. Reopen in this attempt every file or command you cite, or cite patch:<path> for the captured artifact.',
    'An implementation candidate requires at least one successful command receipt from this attempt.',
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
    return implementationArtifact(input.isolation, input.workspaceIdentity)
  }
  if (report.kind === 'diagnosis') return undefined
  return reviewerArtifact(
    input.role,
    input.readonly,
    input.isolation,
    input.workspaceIdentity,
    packet.artifact,
  )
}

function terminalEvidence(
  input: TerminalValidationInput,
  report: DeliveryReport | undefined,
): DeliveryEvidence[] {
  const evidence: DeliveryEvidence[] = []
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
  if (input.isolation === undefined) {
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
    if (isolation?.mode !== 'worktree' || isolation.integration !== 'manual') {
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
  task.outputSchema = structuredClone(DeliveryOutputSchema)
  task.schemaMode = 'strict'
  task.prompt = `${promptIssue === undefined ? `issue: ${issueId}\n` : ''}${task.prompt}\n\n${deliveryReviewerPacket(issue)}`
}

export function registerDeliveryProtocol(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_delivery',
    label: 'Delivery',
    executionMode: 'sequential',
    description:
      'Open criteria, read a compact checkpoint, or record a terminal Task report using trusted artifacts and receipts. Read view: submissions or criteria pages retained data. Oversized submissions return a detail locator. View: submission with agentId and attempt returns exact JSON chunks using UTF-16 offset and limit. Concatenate content chunks before parsing. Output and details stay within 32 KiB. Execution completion never implies acceptance.',
    parameters: DeliveryToolSchema,
    async execute(_callId, input, _signal, _onUpdate, ctx) {
      const journal = loadJournal(ctx)
      let issue = journal.issues.get(input.issue)
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
      )
      if (!view.ok) throw view.error
      return {
        content: [{ type: 'text', text: view.value.text }],
        details: view.value.details,
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
