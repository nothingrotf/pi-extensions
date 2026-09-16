import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import {
  DeliveryIssueSchema,
  DeliveryRejected,
  type DeliveryIssue,
  type DeliveryResult,
  type DeliverySubmission,
  parseDeliveryIssue,
  recordDelivery,
  repairDeliveryReport,
  refreshDeliveryIntegration,
} from './delivery.ts'

const deliveryCheckpointEntryType = '@nothingrotf/pstack/delivery-v1'
export const deliveryJournalEntryType = '@nothingrotf/pstack/delivery-event-v1'

const id = Type.String({ minLength: 1, maxLength: 256 })
const previous = Type.String({ minLength: 1 })
const SubmissionSchema = DeliveryIssueSchema.properties.submissions.items
const integration = SubmissionSchema.properties.integration
const DeliveryJournalEventSchema = Type.Union([
  Type.Object(
    {
      version: Type.Literal(1),
      kind: Type.Literal('record'),
      ownerSessionId: id,
      issue: id,
      previous,
      submission: SubmissionSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      version: Type.Literal(1),
      kind: Type.Literal('repair'),
      ownerSessionId: id,
      issue: id,
      previous,
      agentId: id,
      artifactSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      attempt: Type.Integer({ minimum: 1 }),
      evidenceSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      report: DeliveryIssueSchema.properties.submissions.items.properties.report,
      recordedAt: Type.Number({ minimum: 0 }),
      reportSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      revision: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      version: Type.Literal(1),
      kind: Type.Literal('refresh'),
      ownerSessionId: id,
      issue: id,
      previous,
      agentId: id,
      attempt: Type.Integer({ minimum: 1 }),
      integration,
    },
    { additionalProperties: false },
  ),
])
const EntryOwnerSchema = Type.Object({ ownerSessionId: id }, { additionalProperties: true })

export type DeliveryJournalEvent = Static<typeof DeliveryJournalEventSchema>

export interface DeliveryJournal {
  readonly issues: Map<string, DeliveryIssue>
  readonly heads: Map<string, string>
}

function reject(reason: string): DeliveryResult<never> {
  return { ok: false, error: new DeliveryRejected(reason) }
}

export function makeDeliveryJournalEvent<Input>(
  input: Input,
): DeliveryResult<DeliveryJournalEvent> {
  if (!Value.Check(DeliveryJournalEventSchema, input))
    return reject('Invalid delivery journal event.')
  return { ok: true, value: input }
}

function owned<Input>(data: Input, ownerSessionId: string): boolean {
  return !Value.Check(EntryOwnerSchema, data) || data.ownerSessionId === ownerSessionId
}

function replayRecord(
  issue: DeliveryIssue,
  event: Extract<DeliveryJournalEvent, { kind: 'record' }>,
): DeliveryResult<DeliveryIssue> {
  if (event.submission.report.issue !== event.issue)
    return reject('The delivery journal record belongs to a different issue.')
  return recordDelivery(issue, event.submission)
}

function replayRepair(
  issue: DeliveryIssue,
  event: Extract<DeliveryJournalEvent, { kind: 'repair' }>,
): DeliveryResult<DeliveryIssue> {
  return repairDeliveryReport(issue, {
    agentId: event.agentId,
    artifactSha256: event.artifactSha256,
    attempt: event.attempt,
    evidenceSha256: event.evidenceSha256,
    recordedAt: event.recordedAt,
    report: event.report,
    reportSha256: event.reportSha256,
    revision: event.revision,
  })
}

function replayRefresh(
  issue: DeliveryIssue,
  event: Extract<DeliveryJournalEvent, { kind: 'refresh' }>,
): DeliveryResult<DeliveryIssue> {
  const submission = issue.submissions.find(
    (entry) => entry.agentId === event.agentId && entry.attempt === event.attempt,
  )
  if (submission === undefined)
    return reject('The delivery journal refresh names an unrecorded attempt.')
  const refreshed: DeliverySubmission = { ...submission, integration: event.integration }
  return refreshDeliveryIntegration(issue, refreshed)
}

export function readDeliveryJournal(
  branch: readonly SessionEntry[],
  ownerSessionId: string,
): DeliveryResult<DeliveryJournal> {
  const issues = new Map<string, DeliveryIssue>()
  const heads = new Map<string, string>()
  const journalIssues = new Set<string>()
  for (const entry of branch) {
    if (entry.type !== 'custom') continue
    if (entry.customType === deliveryCheckpointEntryType) {
      if (!owned(entry.data, ownerSessionId)) continue
      const parsed = parseDeliveryIssue(entry.data)
      if (!parsed.ok) return parsed
      if (parsed.value.ownerSessionId !== ownerSessionId) continue
      if (journalIssues.has(parsed.value.issue))
        return reject('A legacy delivery checkpoint cannot replace an active event journal.')
      issues.set(parsed.value.issue, parsed.value)
      heads.set(parsed.value.issue, entry.id)
      continue
    }
    if (entry.customType !== deliveryJournalEntryType) continue
    if (!owned(entry.data, ownerSessionId)) continue
    const parsed = makeDeliveryJournalEvent(entry.data)
    if (!parsed.ok) return parsed
    const event = parsed.value
    if (event.ownerSessionId !== ownerSessionId) continue
    const issue = issues.get(event.issue)
    const head = heads.get(event.issue)
    if (issue === undefined || head === undefined)
      return reject('The delivery journal event has no legacy checkpoint.')
    if (event.previous !== head)
      return reject('The delivery journal event is disconnected from the current issue head.')
    const replayed =
      event.kind === 'record'
        ? replayRecord(issue, event)
        : event.kind === 'repair'
          ? replayRepair(issue, event)
          : replayRefresh(issue, event)
    if (!replayed.ok) return replayed
    issues.set(event.issue, replayed.value)
    heads.set(event.issue, entry.id)
    journalIssues.add(event.issue)
  }
  return { ok: true, value: { issues, heads } }
}
