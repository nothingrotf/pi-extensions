import { createHash } from 'node:crypto'

import { Type, type Static } from 'typebox'

import { isImplementationRole } from './delivery-roles.ts'
import {
  currentDeliveryReport,
  deliveryRepairIdentity,
  DeliveryRejected,
  type DeliveryIssue,
  type DeliveryResult,
  type DeliverySubmission,
  type DeliverySummary,
  summarizeDelivery,
} from './delivery.ts'

const id = Type.String({ minLength: 1, maxLength: 256 })
const offset = Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
const maxBytes = 32 * 1024
const pageBudget = maxBytes - 2048

export const DeliveryReadSchema = Type.Union([
  Type.Object({ action: Type.Literal('read'), issue: id }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal('read'),
      issue: id,
      view: Type.Enum(['submissions', 'criteria']),
      offset,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('read'),
      issue: id,
      view: Type.Literal('submission'),
      agentId: id,
      attempt: Type.Integer({ minimum: 1 }),
      sha256: Type.Optional(Type.String({ pattern: '^[a-f0-9]{64}$' })),
      offset,
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 4096 })),
    },
    { additionalProperties: false },
  ),
])

type DeliveryRead = Static<typeof DeliveryReadSchema>

function summaryView(summary: DeliverySummary) {
  return {
    state: summary.state,
    integration: summary.integration,
    incompleteReturns: summary.incompleteReturns,
    diagnosisRequired: summary.diagnosisRequired,
    unresolvedCriteria: summary.unresolvedCriteria.slice(0, 4),
    unresolvedCriterionCount: summary.unresolvedCriteria.length,
    unresolvedFindings: summary.unresolvedFindings.slice(0, 4),
    unresolvedFindingCount: summary.unresolvedFindings.length,
    artifact:
      summary.artifact === undefined
        ? undefined
        : {
            repositories: summary.artifact.repositories.slice(0, 2).map((repository) => ({
              ...repository,
              root: repository.root.slice(0, 256),
              relativePath: repository.relativePath.slice(0, 256),
              pathTruncated: repository.root.length > 256 || repository.relativePath.length > 256,
            })),
            repositoryCount: summary.artifact.repositories.length,
          },
  }
}

function submissionLocator(issue: string, submission: DeliverySubmission) {
  return {
    action: 'read',
    issue,
    view: 'submission',
    agentId: submission.agentId,
    attempt: submission.attempt,
  }
}

function repairLocator(issue: string, submission: DeliverySubmission) {
  if (
    submission.artifact === undefined ||
    (submission.execution !== 'completed' && submission.failureKind !== 'report-contract')
  )
    return undefined
  return {
    action: 'repair',
    issue,
    agentId: submission.agentId,
    attempt: submission.attempt,
    revision: (submission.reportCorrections?.length ?? 0) + 1,
    ...deliveryRepairIdentity(submission),
  }
}

function submissionPreview(issue: string, submission: DeliverySubmission) {
  const report = currentDeliveryReport(submission)
  return {
    agentId: submission.agentId,
    attempt: submission.attempt,
    role: submission.role,
    execution: submission.execution,
    integration: submission.integration,
    state: report.state,
    failureClass: report.failureClass,
    reason: report.reason.slice(0, 500),
    reasonTruncated: report.reason.length > 500,
    evidenceCount: submission.evidence.length,
    partial: true,
    detail: submissionLocator(issue, submission),
    repair: repairLocator(issue, submission),
  }
}

function issueCheckpoint(issue: DeliveryIssue, summary: ReturnType<typeof summaryView>) {
  const implementation = issue.submissions.findLast(
    (entry) =>
      currentDeliveryReport(entry).kind === 'implementation' && isImplementationRole(entry.role),
  )
  const artifactOwner = issue.submissions.findLast(
    (entry) =>
      currentDeliveryReport(entry).kind === 'implementation' &&
      isImplementationRole(entry.role) &&
      entry.artifact !== undefined,
  )
  const review = issue.submissions.findLast((entry) =>
    ['technical-review', 'runtime-verification'].includes(currentDeliveryReport(entry).kind),
  )
  return {
    issue: issue.issue,
    summary,
    implementationOwner: implementation?.agentId ?? null,
    reviewOwner: review?.agentId ?? null,
    artifactSource:
      artifactOwner === undefined ? null : submissionLocator(issue.issue, artifactOwner),
    criteria: issue.criteria.slice(0, 8).map((criterion) => ({
      id: criterion.id,
      description: criterion.description.slice(0, 160),
      descriptionTruncated: criterion.description.length > 160,
      implementationResult:
        (implementation === undefined
          ? undefined
          : currentDeliveryReport(implementation).criteria.find(
              (entry) => entry.id === criterion.id,
            )?.result) ?? 'pending',
    })),
    criterionCount: issue.criteria.length,
    omittedCriteria: Math.max(0, issue.criteria.length - 8),
    submissionCount: issue.submissions.length,
    recentAttempts: issue.submissions.slice(-3).map((entry) => ({
      ...submissionPreview(issue.issue, entry),
      evidence: entry.evidence.slice(0, 2).map((evidence) => ({
        ...evidence,
        reference: evidence.reference.slice(0, 160),
        referenceTruncated: evidence.reference.length > 160,
      })),
      omittedEvidence: Math.max(0, entry.evidence.length - 2),
    })),
    omittedAttempts: Math.max(0, issue.submissions.length - 3),
    source:
      'Retained ledger, not fresh verification. Use read view: criteria or submissions with offset and limit. Use view: submission with agentId and attempt for exact JSON chunks.',
  }
}

function pageItems<Item>(items: readonly Item[], start: number, limit: number) {
  const page: Item[] = []
  let bytes = 2
  for (const item of items.slice(start, start + limit)) {
    const itemBytes = Buffer.byteLength(JSON.stringify(item)) + 1
    if (bytes + itemBytes > pageBudget) break
    page.push(item)
    bytes += itemBytes
  }
  return {
    items: page,
    nextOffset: start + page.length < items.length ? start + page.length : null,
  }
}

function readPage(issue: DeliveryIssue, input: DeliveryRead): DeliveryResult<object> {
  if (!('view' in input))
    return { ok: true, value: issueCheckpoint(issue, summaryView(summarizeDelivery(issue))) }
  const start = input.offset ?? 0
  if (input.view === 'submission') {
    const submission = issue.submissions.find(
      (entry) => entry.agentId === input.agentId && entry.attempt === input.attempt,
    )
    if (submission === undefined)
      return {
        ok: false,
        error: new DeliveryRejected('No retained submission exists for this agent and attempt.'),
      }
    const serialized = JSON.stringify(submission)
    const repair = repairLocator(issue.issue, submission)
    const sha256 = createHash('sha256').update(serialized).digest('hex')
    if (
      (start > 0 && input.sha256 === undefined) ||
      (input.sha256 !== undefined && input.sha256 !== sha256)
    ) {
      return {
        ok: false,
        error: new DeliveryRejected(
          'Submission pages require the current sha256 after offset zero. Restart at offset zero if the retained submission changed.',
        ),
      }
    }
    const splitsPair = (index: number) => {
      const prior = serialized.charCodeAt(index - 1)
      const next = serialized.charCodeAt(index)
      return prior >= 0xd800 && prior <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
    }
    if (splitsPair(start))
      return {
        ok: false,
        error: new DeliveryRejected(
          'Submission offset splits a Unicode character. Follow the returned nextOffset.',
        ),
      }
    let end = Math.min(serialized.length, start + (input.limit ?? 4096))
    if (splitsPair(end)) end += end - start === 1 ? 1 : -1
    const content = serialized.slice(start, end)
    return {
      ok: true,
      value: {
        issue: issue.issue,
        agentId: input.agentId,
        attempt: input.attempt,
        encoding: 'json',
        sha256,
        offsetUnit: 'utf16',
        offset: start,
        nextOffset: start + content.length < serialized.length ? start + content.length : null,
        totalCharacters: serialized.length,
        content,
        repair,
      },
    }
  }
  if (input.view === 'criteria') {
    const page = pageItems(issue.criteria, start, input.limit ?? 5)
    return {
      ok: true,
      value: {
        issue: issue.issue,
        offset: start,
        nextOffset: page.nextOffset,
        criterionCount: issue.criteria.length,
        criteria: page.items,
      },
    }
  }
  const entries = issue.submissions.map((submission) => {
    const entry = { ...submission, repair: repairLocator(issue.issue, submission) }
    return Buffer.byteLength(JSON.stringify(entry)) > pageBudget
      ? submissionPreview(issue.issue, submission)
      : entry
  })
  const page = pageItems(entries, start, input.limit ?? 5)
  return {
    ok: true,
    value: {
      issue: issue.issue,
      offset: start,
      nextOffset: page.nextOffset,
      submissionCount: issue.submissions.length,
      submissions: page.items,
    },
  }
}

interface DeliveryView {
  text: string
  details: ReturnType<typeof summaryView> & { issue: string; truncated: boolean }
}

export function deliveryView(
  issue: DeliveryIssue,
  input: DeliveryRead,
): DeliveryResult<DeliveryView> {
  const summary = summaryView(summarizeDelivery(issue))
  const page = readPage(issue, input)
  if (!page.ok) return page
  let text = JSON.stringify(page.value)
  const truncated = Buffer.byteLength(text) > maxBytes
  if (truncated) {
    text = JSON.stringify({
      issue: issue.issue,
      summary,
      criterionCount: issue.criteria.length,
      submissionCount: issue.submissions.length,
      repairs: issue.submissions
        .slice(-3)
        .map((submission) => repairLocator(issue.issue, submission))
        .filter((repair) => repair !== undefined),
      partial: true,
      source:
        'Read view: criteria or submissions with offset and limit for details. Large submissions expose an exact detail locator.',
    })
  }
  return { ok: true, value: { text, details: { issue: issue.issue, ...summary, truncated } } }
}
