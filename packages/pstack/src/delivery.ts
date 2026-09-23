import { createHash } from 'node:crypto'

import { decodeJsonValue, isJsonObject, jsonEquals, type JsonValue } from '@nothingrotf/subagent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { isImplementationRole } from './delivery-roles.ts'

const text = Type.String({ minLength: 1, maxLength: 4096 })
const id = Type.String({ minLength: 1, maxLength: 256 })
const digest = Type.String({ pattern: '^[a-f0-9]{64}$' })
const gitId = Type.String({ pattern: '^[a-f0-9]{40,64}$' })
const result = Type.Enum(['pass', 'fail', 'pending', 'blocked'])
const reportKind = [
  'implementation',
  'technical-review',
  'runtime-verification',
  'comments',
  'diagnosis',
] as const
const reportState = ['wip', 'candidate', 'blocked', 'accepted'] as const
const reportFailureClass = [
  'none',
  'omitted-requirement',
  'regression',
  'environment',
  'execution-contract',
  'context',
  'external-decision',
] as const

export const DELIVERY_REASON_LIMIT = 4096

export const DeliveryReportSchema = Type.Object(
  {
    issue: id,
    kind: Type.Enum(reportKind),
    state: Type.Enum(reportState),
    criteria: Type.Array(
      Type.Object(
        {
          id,
          result,
          evidence: Type.Array(id, { maxItems: 16 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 128 },
    ),
    findings: Type.Array(
      Type.Object(
        {
          id,
          blocking: Type.Boolean(),
          disposition: Type.Enum(['open', 'corrected', 'rejected']),
          evidence: Type.Array(id, { maxItems: 16 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 256 },
    ),
    reason: Type.String({ maxLength: DELIVERY_REASON_LIMIT }),
    failureClass: Type.Enum(reportFailureClass),
  },
  { additionalProperties: false },
)

export type DeliveryReport = Static<typeof DeliveryReportSchema>

const semanticCriteria = Type.Array(
  Type.Object(
    { id: Type.String(), result, evidence: Type.Array(Type.String()) },
    { additionalProperties: false },
  ),
)
const semanticFindings = Type.Array(
  Type.Object(
    {
      id: Type.String(),
      blocking: Type.Boolean(),
      disposition: Type.Enum(['open', 'corrected', 'rejected']),
      evidence: Type.Array(Type.String()),
    },
    { additionalProperties: false },
  ),
)

export const DeliveryReportSemanticSchema = Type.Object(
  {
    issue: Type.String(),
    kind: Type.Enum(reportKind),
    state: Type.Enum(reportState),
    criteria: semanticCriteria,
    findings: semanticFindings,
    reason: Type.String(),
    failureClass: Type.Enum(reportFailureClass),
  },
  { additionalProperties: false },
)

const DeliveryReportDraftSchema = Type.Object(
  {
    issue: Type.String(),
    kind: Type.Enum(reportKind),
    state: Type.Enum(reportState),
    criteria: semanticCriteria,
    findings: semanticFindings,
    reason: Type.String(),
    failureClass: Type.Optional(Type.Enum(reportFailureClass)),
  },
  { additionalProperties: false },
)

export interface DeliveryReportDraft {
  failureClassProvided: boolean
  report: DeliveryReport
}

function claimsNoFailure(report: Static<typeof DeliveryReportDraftSchema>): boolean {
  return (
    (report.state === 'accepted' || report.state === 'candidate') &&
    report.criteria.every((criterion) => criterion.result === 'pass') &&
    report.findings.every((finding) => finding.disposition !== 'open')
  )
}

export function deliveryReportDraft(value: JsonValue | undefined): DeliveryReportDraft | undefined {
  if (value === undefined) return undefined
  if (Value.Check(DeliveryReportSemanticSchema, value)) {
    return { failureClassProvided: true, report: value }
  }
  if (!Value.Check(DeliveryReportDraftSchema, value) || !claimsNoFailure(value)) return undefined
  return { failureClassProvided: false, report: { ...value, failureClass: 'none' } }
}

export function pruneFailedPassEvidence(
  report: DeliveryReport,
  evidence: readonly DeliveryEvidence[],
): { pruned: readonly string[]; report: DeliveryReport } {
  const failed = new Set(
    evidence.filter((entry) => !entry.passed || entry.kind === 'failure').map((entry) => entry.id),
  )
  if (failed.size === 0) return { pruned: [], report }
  const succeeded = new Set(
    evidence.filter((entry) => entry.passed && entry.kind !== 'failure').map((entry) => entry.id),
  )
  const pruned: string[] = []
  const criteria = report.criteria.map((criterion) => {
    if (criterion.result !== 'pass') return criterion
    const removed = criterion.evidence.filter((reference) => failed.has(reference))
    if (removed.length === 0) return criterion
    const kept = criterion.evidence.filter((reference) => !failed.has(reference))
    if (!kept.some((reference) => succeeded.has(reference))) return criterion
    pruned.push(...removed)
    return { ...criterion, evidence: kept }
  })
  return pruned.length === 0 ? { pruned: [], report } : { pruned, report: { ...report, criteria } }
}

export function normalizeDeliveryReportProse(report: DeliveryReport): DeliveryReport {
  if (report.reason.length <= DELIVERY_REASON_LIMIT) return report
  const marker = ' [reason truncated]'
  return {
    ...report,
    reason: `${report.reason.slice(0, DELIVERY_REASON_LIMIT - marker.length).trimEnd()}${marker}`,
  }
}

function outputSchema(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(outputSchema)
  if (!isJsonObject(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['minLength', 'maxLength', 'minItems', 'maxItems'].includes(key))
      .map(([key, entry]) => [key, outputSchema(entry)]),
  )
}

export const DeliveryOutputSchema: JsonValue = outputSchema(decodeJsonValue(DeliveryReportSchema))

export const DeliveryArtifactSchema = Type.Object(
  {
    repositories: Type.Array(
      Type.Object(
        {
          root: text,
          relativePath: Type.String(),
          base: gitId,
          tree: gitId,
          patch: digest,
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 64 },
    ),
  },
  { additionalProperties: false },
)
export type DeliveryArtifact = Static<typeof DeliveryArtifactSchema>

const EvidenceSchema = Type.Object(
  {
    id,
    kind: Type.Union([Type.Literal('command'), Type.Literal('patch'), Type.Literal('failure')]),
    passed: Type.Boolean(),
    reference: text,
    sha256: digest,
    status: Type.Optional(Type.Union([Type.Literal('success'), Type.Literal('error')])),
    command: Type.Optional(text),
  },
  { additionalProperties: false },
)
export type DeliveryEvidence = Static<typeof EvidenceSchema>

const ReportCorrectionSchema = Type.Object(
  {
    artifactSha256: digest,
    evidenceSha256: digest,
    recordedAt: Type.Number({ minimum: 0 }),
    report: DeliveryReportSchema,
    reportSha256: digest,
    revision: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
)

const SubmissionSchema = Type.Object(
  {
    agentId: id,
    attempt: Type.Integer({ minimum: 1 }),
    role: id,
    execution: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('aborted'),
    ]),
    failureKind: Type.Optional(Type.Literal('report-contract')),
    artifact: Type.Optional(DeliveryArtifactSchema),
    integration: Type.Union([
      Type.Literal('captured'),
      Type.Literal('pending'),
      Type.Literal('integrated'),
      Type.Literal('conflict'),
    ]),
    evidence: Type.Array(EvidenceSchema, { maxItems: 8192 }),
    intendedReport: Type.Optional(DeliveryReportSchema),
    report: DeliveryReportSchema,
    reportCorrections: Type.Optional(Type.Array(ReportCorrectionSchema, { maxItems: 16 })),
    recordedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type DeliverySubmission = Static<typeof SubmissionSchema>
export type DeliveryReportCorrection = Static<typeof ReportCorrectionSchema>

function sha256(value: JsonValue): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function artifactSha256(artifact: DeliveryArtifact | undefined): string | undefined {
  return artifact === undefined ? undefined : sha256(decodeJsonValue(artifact))
}

function evidenceSha256(evidence: readonly DeliveryEvidence[]): string {
  return sha256(decodeJsonValue(evidence))
}

export function currentDeliveryReport(submission: DeliverySubmission): DeliveryReport {
  return submission.reportCorrections?.at(-1)?.report ?? submission.report
}

export interface DeliveryRepairIdentity {
  artifactSha256: string
  evidenceSha256: string
  reportSha256: string
}

export function deliveryRepairIdentity(submission: DeliverySubmission): DeliveryRepairIdentity {
  const artifact = artifactSha256(submission.artifact)
  if (artifact === undefined)
    throw new DeliveryRejected('Report repair requires a captured artifact.')
  return {
    artifactSha256: artifact,
    evidenceSha256: evidenceSha256(submission.evidence),
    reportSha256: sha256(decodeJsonValue(currentDeliveryReport(submission))),
  }
}

const CriterionSchema = Type.Object({ id, description: text }, { additionalProperties: false })
export const DeliveryIssueSchema = Type.Object(
  {
    version: Type.Literal(1),
    issue: id,
    ownerSessionId: id,
    criteria: Type.Array(CriterionSchema, { minItems: 1, maxItems: 128 }),
    runtimeRequired: Type.Boolean(),
    submissions: Type.Array(SubmissionSchema, { maxItems: 1024 }),
    createdAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)
export type DeliveryIssue = Static<typeof DeliveryIssueSchema>

export class DeliveryRejected extends Error {
  readonly _tag = 'DeliveryRejected'
  constructor(readonly reason: string) {
    super(`Delivery rejected: ${reason}`)
  }
}
export type DeliveryResult<T> = { ok: true; value: T } | { ok: false; error: DeliveryRejected }
const reject = (reason: string): { ok: false; error: DeliveryRejected } => ({
  ok: false,
  error: new DeliveryRejected(reason),
})

function uniqueIds(items: readonly { id: string }[]): boolean {
  return (
    items.every((item) => item.id.trim().length > 0) &&
    new Set(items.map((item) => item.id)).size === items.length
  )
}

function uniqueRepositories(artifact: DeliveryArtifact): boolean {
  return (
    new Set(artifact.repositories.map((entry) => JSON.stringify([entry.root, entry.relativePath])))
      .size === artifact.repositories.length
  )
}

export function sameDeliveryArtifact(left: DeliveryArtifact, right: DeliveryArtifact): boolean {
  return (
    uniqueRepositories(left) &&
    uniqueRepositories(right) &&
    left.repositories.length === right.repositories.length &&
    left.repositories.every((repository) =>
      right.repositories.some(
        (other) =>
          repository.root === other.root &&
          repository.relativePath === other.relativePath &&
          repository.base === other.base &&
          repository.tree === other.tree &&
          repository.patch === other.patch,
      ),
    )
  )
}

function proven(references: readonly string[], evidence: readonly DeliveryEvidence[]): boolean {
  return (
    references.length > 0 &&
    references.every((reference) =>
      evidence.some((entry) => entry.id === reference && entry.passed && entry.kind !== 'failure'),
    )
  )
}

function complete(issue: DeliveryIssue, submission: DeliverySubmission): boolean {
  const report = currentDeliveryReport(submission)
  return (
    (submission.execution === 'completed' ||
      (submission.execution === 'failed' && submission.failureKind === 'report-contract')) &&
    submission.artifact !== undefined &&
    report.criteria.length === issue.criteria.length &&
    issue.criteria.every((criterion) =>
      report.criteria.some(
        (entry) =>
          entry.id === criterion.id &&
          entry.result === 'pass' &&
          proven(entry.evidence, submission.evidence),
      ),
    ) &&
    report.findings.every(
      (finding) =>
        !finding.blocking ||
        (finding.disposition !== 'open' && proven(finding.evidence, submission.evidence)),
    )
  )
}

function technical(submission: DeliverySubmission): boolean {
  const report = currentDeliveryReport(submission)
  return (
    (report.kind === 'technical-review' && submission.role === 'code review') ||
    (report.kind === 'runtime-verification' && submission.role === 'runtime verification')
  )
}

function runtimeProof(submission: DeliverySubmission): boolean {
  const report = currentDeliveryReport(submission)
  return (
    report.kind === 'runtime-verification' &&
    submission.evidence.some(
      (entry) =>
        entry.kind === 'command' &&
        entry.passed &&
        report.criteria.some((criterion) => criterion.evidence.includes(entry.id)),
    )
  )
}

export interface DeliverySummary {
  state: 'wip' | 'candidate' | 'blocked' | 'accepted'
  artifact: DeliveryArtifact | undefined
  integration: DeliverySubmission['integration'] | undefined
  unresolvedCriteria: readonly string[]
  unresolvedFindings: readonly string[]
  incompleteReturns: number
  diagnosisRequired: boolean
}

export function summarizeDelivery(issue: DeliveryIssue): DeliverySummary {
  const implementations = issue.submissions.filter(
    (entry) =>
      currentDeliveryReport(entry).kind === 'implementation' && isImplementationRole(entry.role),
  )
  const candidate = implementations.at(-1)
  const authors = new Set(implementations.map((entry) => entry.agentId))
  const candidateArtifact = candidate?.artifact
  const reviews =
    candidate === undefined || candidateArtifact === undefined
      ? []
      : issue.submissions
          .slice(issue.submissions.lastIndexOf(candidate) + 1)
          .filter(
            (entry) =>
              technical(entry) &&
              !authors.has(entry.agentId) &&
              (entry.artifact === undefined
                ? ['wip', 'blocked'].includes(currentDeliveryReport(entry).state)
                : sameDeliveryArtifact(candidateArtifact, entry.artifact)),
          )
  const latestReviews = new Map<string, DeliverySubmission>()
  for (const review of reviews) latestReviews.set(currentDeliveryReport(review).kind, review)
  const currentReviews = [...latestReviews.values()]
  const findings = new Map<string, DeliveryReport['findings'][number]>()
  for (const submission of issue.submissions) {
    for (const finding of currentDeliveryReport(submission).findings) {
      const previous = findings.get(finding.id)
      if (finding.disposition === 'open') {
        findings.set(finding.id, {
          ...finding,
          blocking: previous?.blocking === true || finding.blocking,
        })
      } else if (
        reviews.includes(submission) &&
        submission.artifact !== undefined &&
        submission.execution === 'completed' &&
        proven(finding.evidence, submission.evidence)
      ) {
        findings.set(finding.id, {
          ...finding,
          blocking: previous?.blocking === true || finding.blocking,
        })
      }
    }
  }
  const unresolvedFindings = [...findings.values()]
    .filter((finding) => finding.blocking && finding.disposition === 'open')
    .map((finding) => finding.id)
  const unresolvedCriteria = issue.criteria
    .filter(
      (criterion) =>
        !candidate ||
        !currentDeliveryReport(candidate).criteria.some(
          (entry) =>
            entry.id === criterion.id &&
            entry.result === 'pass' &&
            proven(entry.evidence, candidate.evidence),
        ),
    )
    .map((criterion) => criterion.id)
  let incompleteReturns = 0
  let previousArtifact: DeliveryArtifact | undefined
  const passed = new Set<string>()
  for (const submission of issue.submissions) {
    const report = currentDeliveryReport(submission)
    if (report.kind === 'diagnosis') {
      incompleteReturns = 0
      continue
    }
    if (report.kind !== 'implementation' || !isImplementationRole(submission.role)) continue
    const current = report.criteria
      .filter((entry) => entry.result === 'pass' && proven(entry.evidence, submission.evidence))
      .map((entry) => entry.id)
    const newCriterion = current.some((criterion) => !passed.has(criterion))
    for (const criterion of current) passed.add(criterion)
    const cited = new Set([
      ...report.criteria.flatMap((criterion) => criterion.evidence),
      ...report.findings.flatMap((finding) => finding.evidence),
    ])
    const verifiedChange =
      submission.execution === 'completed' &&
      submission.artifact !== undefined &&
      submission.artifact.repositories.some(
        (repository) =>
          repository.tree !== repository.base &&
          !previousArtifact?.repositories.some(
            (previous) =>
              previous.root === repository.root &&
              previous.relativePath === repository.relativePath &&
              previous.tree === repository.tree,
          ),
      ) &&
      submission.evidence.some(
        (entry) => entry.kind === 'command' && entry.passed && cited.has(entry.id),
      )
    if (submission.artifact !== undefined) previousArtifact = submission.artifact
    incompleteReturns =
      complete(issue, submission) || newCriterion || verifiedChange ? 0 : incompleteReturns + 1
  }
  const candidateReady =
    candidate !== undefined &&
    currentDeliveryReport(candidate).state === 'candidate' &&
    complete(issue, candidate)
  const reviewReady =
    currentReviews.length > 0 &&
    currentReviews.every(
      (review) => currentDeliveryReport(review).state === 'accepted' && complete(issue, review),
    )
  const runtimeReady =
    !issue.runtimeRequired ||
    currentReviews.some(
      (entry) =>
        currentDeliveryReport(entry).state === 'accepted' &&
        complete(issue, entry) &&
        runtimeProof(entry),
    )
  const accepted = candidateReady && reviewReady && runtimeReady && unresolvedFindings.length === 0
  return {
    state: accepted
      ? 'accepted'
      : candidate !== undefined && currentDeliveryReport(candidate).state === 'blocked'
        ? 'blocked'
        : candidateReady
          ? 'candidate'
          : 'wip',
    artifact:
      candidateArtifact ??
      implementations.findLast((entry) => entry.artifact !== undefined)?.artifact,
    integration: candidate?.integration,
    unresolvedCriteria,
    unresolvedFindings,
    incompleteReturns,
    diagnosisRequired: incompleteReturns >= 2,
  }
}

const stateRank: ReadonlyMap<DeliveryReport['state'], number> = new Map([
  ['wip', 0],
  ['blocked', 0],
  ['candidate', 1],
  ['accepted', 2],
])

const criterionRank: ReadonlyMap<DeliveryReport['criteria'][number]['result'], number> = new Map([
  ['fail', 0],
  ['blocked', 0],
  ['pending', 0],
  ['pass', 1],
])

export function sameDeliveryTechnicalVerdict(
  original: DeliveryReport,
  repaired: DeliveryReport,
): boolean {
  const originalState = stateRank.get(original.state)
  const repairedState = stateRank.get(repaired.state)
  return (
    original.issue === repaired.issue &&
    original.kind === repaired.kind &&
    originalState !== undefined &&
    repairedState !== undefined &&
    repairedState <= originalState &&
    original.failureClass === repaired.failureClass &&
    original.criteria.length === repaired.criteria.length &&
    original.criteria.every((criterion) => {
      const candidate = repaired.criteria.find((entry) => entry.id === criterion.id)
      const originalResult = criterionRank.get(criterion.result)
      const repairedResult =
        candidate === undefined ? undefined : criterionRank.get(candidate.result)
      return (
        originalResult !== undefined &&
        repairedResult !== undefined &&
        repairedResult <= originalResult
      )
    }) &&
    original.findings.length === repaired.findings.length &&
    original.findings.every((finding) =>
      repaired.findings.some(
        (candidate) =>
          candidate.id === finding.id &&
          (!finding.blocking || candidate.blocking) &&
          (candidate.disposition === finding.disposition ||
            (finding.disposition !== 'open' && candidate.disposition === 'open')),
      ),
    )
  )
}

function correctionContractError(submission: DeliverySubmission): string | undefined {
  let current = submission.report
  const identity = {
    artifactSha256: artifactSha256(submission.artifact),
    evidenceSha256: evidenceSha256(submission.evidence),
  }
  if (identity.artifactSha256 === undefined && (submission.reportCorrections?.length ?? 0) > 0) {
    return 'Report repair requires a captured artifact.'
  }
  const basis = submission.intendedReport ?? submission.report
  for (const [index, correction] of (submission.reportCorrections ?? []).entries()) {
    if (
      correction.revision !== index + 1 ||
      correction.reportSha256 !== sha256(decodeJsonValue(current)) ||
      correction.evidenceSha256 !== identity.evidenceSha256 ||
      correction.artifactSha256 !== identity.artifactSha256
    ) {
      return 'A report correction does not match the immutable prior report, evidence, or artifact.'
    }
    if (!sameDeliveryTechnicalVerdict(basis, correction.report)) {
      return 'Report correction cannot change the original technical verdict.'
    }
    current = correction.report
  }
  return undefined
}

export function deliveryReportDiagnostics(
  issue: DeliveryIssue,
  submission: DeliverySubmission,
): readonly string[] {
  const report = currentDeliveryReport(submission)
  const diagnostics: string[] = []
  if (technical(submission)) {
    const retainedFindings = new Map<string, DeliveryReport['findings'][number]>()
    for (const prior of issue.submissions) {
      for (const finding of currentDeliveryReport(prior).findings) {
        const previous = retainedFindings.get(finding.id)
        if (finding.disposition === 'open') {
          retainedFindings.set(finding.id, {
            ...finding,
            blocking: previous?.blocking === true || finding.blocking,
          })
        } else if (
          technical(prior) &&
          prior.execution === 'completed' &&
          proven(finding.evidence, prior.evidence)
        ) {
          retainedFindings.set(finding.id, {
            ...finding,
            blocking: previous?.blocking === true || finding.blocking,
          })
        }
      }
    }
    const omitted = [...retainedFindings.values()]
      .filter(
        (finding) =>
          finding.blocking &&
          finding.disposition === 'open' &&
          !report.findings.some((candidate) => candidate.id === finding.id),
      )
      .map((finding) => finding.id)
    if (omitted.length > 0) {
      diagnostics.push(`Review omitted open blocking finding IDs: ${omitted.join(', ')}.`)
    }
  }
  const expected = issue.criteria.map((criterion) => criterion.id)
  const actual = report.criteria.map((criterion) => criterion.id)
  const missing = expected.filter((criterion) => !actual.includes(criterion))
  const unknown = actual.filter((criterion) => !expected.includes(criterion))
  const requiresCompleteCriteria =
    (report.kind === 'implementation' && report.state === 'candidate') ||
    report.state === 'accepted'
  if (requiresCompleteCriteria && missing.length > 0) {
    diagnostics.push(`Missing criterion IDs: ${missing.join(', ')}.`)
  }
  if (unknown.length > 0) diagnostics.push(`Unknown criterion IDs: ${unknown.join(', ')}.`)
  for (const criterion of report.criteria) {
    if (criterion.result === 'pass' && criterion.evidence.length === 0) {
      diagnostics.push(`Criterion ${criterion.id} passes without evidence.`)
    }
    for (const reference of criterion.evidence) {
      const evidence = submission.evidence.find((entry) => entry.id === reference)
      if (evidence === undefined) {
        diagnostics.push(`Criterion ${criterion.id} references missing receipt ${reference}.`)
      } else if (criterion.result === 'pass' && (!evidence.passed || evidence.kind === 'failure')) {
        diagnostics.push(
          `Criterion ${criterion.id} references ${reference} with status ${evidence.status ?? 'error'}.`,
        )
      }
    }
  }
  if (
    report.kind === 'implementation' &&
    (report.state === 'candidate' || report.state === 'accepted') &&
    !submission.evidence.some(
      (entry) => entry.kind === 'command' && entry.passed && !entry.id.startsWith('read:'),
    )
  ) {
    diagnostics.push(
      'An implementation candidate requires at least one successful command receipt from this attempt.',
    )
  }
  for (const finding of report.findings) {
    for (const reference of finding.evidence) {
      const evidence = submission.evidence.find((entry) => entry.id === reference)
      if (evidence === undefined) {
        diagnostics.push(`Finding ${finding.id} references missing receipt ${reference}.`)
      } else if (
        finding.disposition !== 'open' &&
        (!evidence.passed || evidence.kind === 'failure')
      ) {
        diagnostics.push(
          `Finding ${finding.id} references ${reference} with status ${evidence.status ?? 'error'}.`,
        )
      }
    }
  }
  return diagnostics
}

export interface DeliveryReportRepairInput extends DeliveryRepairIdentity {
  agentId: string
  attempt: number
  recordedAt: number
  report: DeliveryReport
  revision: number
}

export function repairDeliveryReport(
  issue: DeliveryIssue,
  input: DeliveryReportRepairInput,
): DeliveryResult<DeliveryIssue> {
  const submission = issue.submissions.find(
    (entry) => entry.agentId === input.agentId && entry.attempt === input.attempt,
  )
  if (submission === undefined) return reject('No recorded attempt exists to repair.')
  if (
    submission.execution !== 'completed' &&
    !(submission.execution === 'failed' && submission.failureKind === 'report-contract')
  )
    return reject('Execution failures and aborted evidence cannot be repaired.')
  const expectedRevision = (submission.reportCorrections?.length ?? 0) + 1
  if (input.revision !== expectedRevision) return reject('The report correction revision is stale.')
  let identity: DeliveryRepairIdentity
  try {
    identity = deliveryRepairIdentity(submission)
  } catch (error) {
    return reject(
      error instanceof DeliveryRejected ? error.reason : 'Report repair identity failed.',
    )
  }
  if (
    !jsonEquals(
      decodeJsonValue(identity),
      decodeJsonValue({
        artifactSha256: input.artifactSha256,
        evidenceSha256: input.evidenceSha256,
        reportSha256: input.reportSha256,
      }),
    )
  )
    return reject('Report repair identity is stale or does not match immutable evidence.')
  const basis = submission.intendedReport ?? submission.report
  if (!sameDeliveryTechnicalVerdict(basis, input.report)) {
    return reject('Report repair cannot change the original technical verdict.')
  }
  const corrected: DeliverySubmission = {
    ...submission,
    reportCorrections: [
      ...(submission.reportCorrections ?? []),
      {
        artifactSha256: input.artifactSha256,
        evidenceSha256: input.evidenceSha256,
        recordedAt: input.recordedAt,
        report: input.report,
        reportSha256: input.reportSha256,
        revision: input.revision,
      },
    ],
  }
  const diagnostics = deliveryReportDiagnostics(issue, corrected)
  if (diagnostics.length > 0) return reject(diagnostics.join(' '))
  const withoutTarget: DeliveryIssue = {
    ...issue,
    submissions: issue.submissions.filter((entry) => entry !== submission),
  }
  const validated = recordDelivery(withoutTarget, corrected)
  if (!validated.ok) return validated
  const next: DeliveryIssue = {
    ...issue,
    submissions: issue.submissions.map((entry) => (entry === submission ? corrected : entry)),
  }
  if (!Value.Check(DeliveryIssueSchema, next))
    return reject('Invalid repaired delivery checkpoint.')
  return { ok: true, value: next }
}

export function recordDelivery(
  issue: DeliveryIssue,
  submission: DeliverySubmission,
): DeliveryResult<DeliveryIssue> {
  if (!Value.Check(SubmissionSchema, submission)) return reject('Invalid submission contract.')
  if (submission.artifact !== undefined && !uniqueRepositories(submission.artifact))
    return reject('Repository identities must be unique.')
  const correctionError = correctionContractError(submission)
  if (correctionError !== undefined) return reject(correctionError)
  const report = currentDeliveryReport(submission)
  if (
    report.issue !== issue.issue ||
    (submission.intendedReport !== undefined && submission.intendedReport.issue !== issue.issue)
  )
    return reject('The report belongs to a different issue.')
  if (
    issue.submissions.some(
      (entry) => entry.agentId === submission.agentId && entry.attempt === submission.attempt,
    )
  ) {
    return reject('This attempt is already recorded. Resume the owner for new evidence.')
  }
  if (
    !uniqueIds(report.criteria) ||
    !uniqueIds(report.findings) ||
    !uniqueIds(submission.evidence)
  ) {
    return reject('Criterion, finding, and evidence IDs must be unique and nonempty.')
  }
  const unknownCriteria = report.criteria.filter(
    (entry) => !issue.criteria.some((criterion) => criterion.id === entry.id),
  )
  if (unknownCriteria.length > 0) {
    return reject(
      `The report names an unknown criterion. Unknown criterion IDs: ${unknownCriteria.map((entry) => entry.id).join(', ')}. Registered criterion IDs: ${issue.criteria.map((criterion) => criterion.id).join(', ')}. Keep review findings in findings, not criteria.`,
    )
  }
  if (
    ((report.kind === 'implementation' && report.state === 'candidate') ||
      report.state === 'accepted') &&
    !complete(issue, submission)
  ) {
    const unrecorded = new Set(
      [...report.criteria, ...report.findings]
        .flatMap((entry) => entry.evidence)
        .filter((reference) => !submission.evidence.some((entry) => entry.id === reference)),
    )
    if (unrecorded.size > 0) {
      return reject(
        `Unrecorded evidence references: ${[...unrecorded].join(', ')}. Use recorded receipt IDs, not prose or file paths.`,
      )
    }
    const diagnostics = deliveryReportDiagnostics(issue, submission)
    if (diagnostics.length > 0) return reject(diagnostics.join(' '))
  }
  if ((report.state === 'wip' || report.state === 'blocked') && report.reason.trim().length === 0) {
    return reject('An incomplete return requires an explicit remaining obligation or blocker.')
  }
  if (
    report.kind === 'implementation' &&
    (report.state === 'accepted' || (report.state === 'candidate' && !complete(issue, submission)))
  ) {
    return reject(
      'Only complete self-proof can create a candidate. Implementation cannot accept itself.',
    )
  }
  if (report.state === 'accepted' && (!technical(submission) || !complete(issue, submission))) {
    return reject('Acceptance requires a complete technical verdict from a review role.')
  }
  if (
    report.kind === 'runtime-verification' &&
    report.state === 'accepted' &&
    !runtimeProof(submission)
  ) {
    return reject('Runtime acceptance requires a successful tool-originated command receipt.')
  }
  if (report.kind === 'diagnosis') {
    const evidence = submission.evidence.filter((entry) => entry.passed || entry.kind === 'failure')
    if (
      submission.role !== 'hardest tasks' ||
      submission.execution !== 'completed' ||
      report.reason.trim().length === 0 ||
      report.failureClass === 'none' ||
      evidence.length === 0
    )
      return reject(
        'Diagnosis requires a cause, reproduction evidence, and a completed diagnostic owner.',
      )
    if (report.failureClass === 'context' && !evidence.some((entry) => entry.kind === 'failure')) {
      return reject(
        'Context failure requires recorded failure evidence, not a token-count inference.',
      )
    }
  }
  const next = { ...issue, submissions: [...issue.submissions, submission] }
  if (!Value.Check(DeliveryIssueSchema, next))
    return reject('The delivery checkpoint exceeds its contract limits.')
  return { ok: true, value: next }
}

export function refreshDeliveryIntegration(
  issue: DeliveryIssue,
  submission: DeliverySubmission,
): DeliveryResult<DeliveryIssue> {
  const existing = issue.submissions.find(
    (entry) => entry.agentId === submission.agentId && entry.attempt === submission.attempt,
  )
  if (existing === undefined) return reject('No recorded attempt exists to refresh.')
  if (
    !Value.Check(SubmissionSchema, submission) ||
    !jsonEquals(
      decodeJsonValue({
        ...existing,
        integration: submission.integration,
        recordedAt: submission.recordedAt,
      }),
      decodeJsonValue(submission),
    )
  )
    return reject('Integration refresh cannot change immutable delivery evidence.')
  return {
    ok: true,
    value: {
      ...issue,
      submissions: issue.submissions.map((entry) =>
        entry === existing ? { ...entry, integration: submission.integration } : entry,
      ),
    },
  }
}

export function parseDeliveryIssue<Input>(input: Input): DeliveryResult<DeliveryIssue> {
  if (!Value.Check(DeliveryIssueSchema, input) || !uniqueIds(input.criteria))
    return reject('Invalid versioned delivery checkpoint.')
  let issue: DeliveryIssue = { ...input, submissions: [] }
  for (const submission of input.submissions) {
    const next = recordDelivery(issue, submission)
    if (!next.ok) return next
    issue = next.value
  }
  return { ok: true, value: issue }
}
