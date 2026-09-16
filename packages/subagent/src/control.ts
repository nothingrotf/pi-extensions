import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { type Component, Text, truncateToWidth } from '@earendil-works/pi-tui'
import { type StaticDecode, Type } from 'typebox'
import { Value } from 'typebox/value'

import { ARROW_OUT, MAIL_ICON, quotedBody } from './cards.ts'
import type { SubagentControllerHost } from './controller.ts'
import type { DecisionReceipt } from './decisions.ts'
import type { DeliveryRecord } from './delivery.ts'
import { oneLineLabel, type SubagentTheme, taskRoleLabel } from './format.ts'
import type { IsolationDestination } from './isolation.ts'
import {
  formatJobDuration,
  formatMoreItems,
  type JobProgressDetails,
  type JobSnapshot,
  JobTree,
  jobTitle,
  toJobSnapshot,
} from './jobs.ts'
import { JobProgress, type JobProgressHost } from './progress.ts'
import type {
  CancelReceipt,
  SteerReceipt,
  SubagentHandle,
  SubagentResult,
  SubagentRuntime,
  SubagentSnapshot,
} from './runtime.ts'
import { EvidenceSectionSchema, type EvidenceSection } from './schema.ts'
import { type AgentRow, TaskResult } from './task-render.ts'

const MAX_LIST_RESULTS = 20
const DEFAULT_LIST_RESULTS = 10
const MAX_EVIDENCE_BYTES = 8 * 1024
const MAX_SERIALIZED_BYTES = 32 * 1024
const DEFAULT_EVIDENCE_BYTES = 4 * 1024
const DELIVERY_PREVIEW_BYTES = 2 * 1024
const STATUS_ERROR_PREVIEW_BYTES = 2 * 1024
const MAX_WAIT_MS = 3_600_000
const DEFAULT_WAIT_MS = MAX_WAIT_MS

const EvidenceInputSchema = Type.Object(
  {
    action: Type.Literal('evidence'),
    agent_id: Type.String({ minLength: 1 }),
    attempt: Type.Integer({ minimum: 1 }),
    section: EvidenceSectionSchema,
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    digest: Type.Optional(Type.String({ minLength: 64, maxLength: 64 })),
    limit: Type.Optional(Type.Integer({ maximum: MAX_EVIDENCE_BYTES, minimum: 256 })),
  },
  { additionalProperties: false },
)

const StatusInputSchema = Type.Object(
  {
    action: Type.Literal('status'),
    agent_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const SteerInputSchema = Type.Object(
  {
    action: Type.Literal('steer'),
    agent_id: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const CancelInputSchema = Type.Object(
  {
    action: Type.Literal('cancel'),
    agent_id: Type.String({ minLength: 1 }),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const JoinInputSchema = Type.Object(
  {
    action: Type.Literal('join'),
    agent_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const WaitInputSchema = Type.Object(
  {
    action: Type.Literal('wait'),
    agent_ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        description: 'Narrow the wait to these agents. Omit to watch every running Task.',
        minItems: 1,
      }),
    ),
    timeout_ms: Type.Optional(
      Type.Integer({
        description: 'Return after this many milliseconds when nothing settles. Default 3600000.',
        maximum: MAX_WAIT_MS,
        minimum: 1_000,
      }),
    ),
  },
  { additionalProperties: false },
)

const JobsInputSchema = Type.Object(
  {
    action: Type.Literal('jobs'),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ maximum: MAX_LIST_RESULTS, minimum: 1 })),
  },
  { additionalProperties: false },
)

const ListInputSchema = Type.Object(
  {
    action: Type.Literal('list'),
    active_only: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ maximum: MAX_LIST_RESULTS, minimum: 1 })),
  },
  { additionalProperties: false },
)

const InboxInputSchema = Type.Object(
  {
    action: Type.Literal('inbox'),
    agent_id: Type.Optional(Type.String({ minLength: 1 })),
    cursor: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Optional(Type.Integer({ maximum: MAX_LIST_RESULTS, minimum: 1 })),
  },
  { additionalProperties: false },
)

const AcknowledgeInputSchema = Type.Object(
  {
    action: Type.Literal('acknowledge'),
    agent_id: Type.String({ minLength: 1 }),
    delivery_id: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

const ReplyInputSchema = Type.Object(
  {
    action: Type.Literal('reply'),
    agent_id: Type.String({ minLength: 1 }),
    request_id: Type.String({ minLength: 1 }),
    message: Type.String({ minLength: 1, maxLength: 8000 }),
  },
  { additionalProperties: false },
)

export const TaskControlInputSchema = Type.Union(
  [
    EvidenceInputSchema,
    InboxInputSchema,
    AcknowledgeInputSchema,
    ReplyInputSchema,
    StatusInputSchema,
    SteerInputSchema,
    CancelInputSchema,
    JoinInputSchema,
    ListInputSchema,
    WaitInputSchema,
    JobsInputSchema,
  ],
  { type: 'object' },
)

export type TaskControlInput = StaticDecode<typeof TaskControlInputSchema>

interface IsolationSummary {
  attempt_id: string
  changed_files: number
  integration: string
  integration_status: string | null
  repositories: number
  status: string
}

interface TaskStatusSummary {
  activity: string | null
  agent_id: string
  attempt: number
  description: string
  ended_at: number | null
  isolation: IsolationSummary | null
  model?: string | undefined
  running: boolean
  role?: string | undefined
  started_at: number
  state: SubagentSnapshot['status']
  subagent_type: SubagentSnapshot['subagentType']
  timing?: SubagentSnapshot['timing']
  usage: SubagentSnapshot['usage']
}

interface TaskStatus extends TaskStatusSummary {
  artifact: SubagentResult['artifact'] | null
  context_state: SubagentSnapshot['contextState'] | null
  effort: SubagentSnapshot['effort']
  evidence: EvidenceSection[]
  error: string | null
  gate_count: number
  intercom_usage: SubagentSnapshot['intercomUsage']
  model: string
  output_bytes: number
  readonly: boolean
  retry_failure: SubagentSnapshot['retryFailure'] | null
  retry_state: SubagentSnapshot['retryState'] | null
  structured_output_status: string | null
  tool_receipt_count: number
}

interface DeliverySummary {
  agentId: string
  content: string
  id: string
  kind: DeliveryRecord['kind']
  level: DeliveryRecord['level']
  requestId?: string | undefined
  state: DeliveryRecord['state']
}

export type TaskControlDetails =
  | {
      action: 'evidence'
      agent_id: string
      attempt: number
      content: string
      cursor: number
      digest: string | null
      freshness: 'current' | 'stale' | null
      next_cursor: number | null
      outcome: 'found' | 'not-found' | 'invalid-cursor'
      section: EvidenceSection
      total_bytes: number
    }
  | {
      action: 'inbox'
      count: number
      cursor: number
      deliveries: DeliverySummary[]
      has_more: boolean
      next_cursor: number | null
      total: number
    }
  | {
      action: 'acknowledge'
      agent_id: string
      delivery_id: string
      outcome: 'acknowledged' | 'rejected'
    }
  | ({ action: 'reply'; agent_id: string } & DecisionReceipt)
  | { action: 'status'; agent_id: string; outcome: 'not-found' }
  | { action: 'status'; outcome: 'found'; task: TaskStatus }
  | {
      action: 'steer'
      agent_id: string
      outcome: 'queued' | 'rejected'
      queued_at: number | null
      reason: 'empty' | 'invalid-owner' | 'not-active' | 'stale-handle' | 'terminal' | null
      revision: number
    }
  | {
      action: 'cancel'
      agent_id: string
      outcome:
        | 'requested'
        | 'already-terminal'
        | 'not-found'
        | 'stale-handle'
        | 'integration-started'
      reason: string
      revision: number
    }
  | {
      action: 'join'
      agent_id: string
      outcome: 'joined' | 'conflict' | 'rejected'
      reason:
        | 'conflict'
        | 'integrated'
        | 'invalid-lineage'
        | 'not-completed'
        | 'not-found'
        | 'not-staged'
        | 'running'
        | null
      receipt: IsolationSummary | null
      revision: number
    }
  | {
      action: 'list'
      active_only: boolean
      count: number
      has_more: boolean
      limit: number
      tasks: TaskStatusSummary[]
      total: number
    }
  | TaskWaitDetails
  | {
      action: 'jobs'
      count: number
      cursor: number
      has_more: boolean
      jobs: JobSnapshot[]
      next_cursor: number | null
      total: number
    }
  | JobProgressDetails

export interface TaskWaitDetails {
  action: 'wait'
  jobs: JobSnapshot[]
  outcome: 'settled' | 'timeout' | 'aborted' | 'idle' | 'attention'
  settled: string[]
}

export interface TaskControlExecution {
  events?: JobProgressHost['events']
  onUpdate: AgentToolUpdateCallback<JobProgressDetails> | undefined
  signal: AbortSignal | undefined
}

export type TaskControlRuntime = Pick<
  SubagentRuntime,
  | 'currentRevision'
  | 'deliveries'
  | 'handle'
  | 'joinStaged'
  | 'latestResult'
  | 'readEvidence'
  | 'replyToDecision'
  | 'subscribe'
>

export interface TaskControlScope {
  allows: (agentId: string) => boolean
  callerId: (ctx: ExtensionContext) => string
  cancel: (handle: SubagentHandle, reason: string) => Promise<CancelReceipt>
  destination: (ctx: ExtensionContext, agentId: string) => Promise<IsolationDestination>
  snapshots: () => SubagentSnapshot[]
  steer: (handle: SubagentHandle, message: string) => Promise<SteerReceipt>
}

function isolationSummary(isolation: SubagentSnapshot['isolation']): IsolationSummary | null {
  if (isolation === undefined) return null
  return {
    attempt_id: isolation.attemptId,
    changed_files: isolation.repositories.reduce(
      (count, repository) => count + repository.changedFiles.length,
      0,
    ),
    integration: isolation.integration,
    integration_status: isolation.integrationStatus ?? null,
    repositories: isolation.repositories.length,
    status: isolation.status,
  }
}

function summary(snapshot: SubagentSnapshot): TaskStatusSummary {
  return {
    activity: snapshot.lastActivity ?? null,
    agent_id: snapshot.agentId,
    attempt: snapshot.attempt,
    description: snapshot.description,
    ended_at: snapshot.endedAt ?? null,
    isolation: isolationSummary(snapshot.isolation),
    model: snapshot.role === undefined ? undefined : snapshot.model,
    running: snapshot.running,
    role: snapshot.role,
    started_at: snapshot.startedAt,
    state: snapshot.status,
    subagent_type: snapshot.subagentType,
    timing: snapshot.timing,
    usage: snapshot.usage,
  }
}

export function taskStatus(
  runtime: Pick<TaskControlRuntime, 'latestResult'>,
  snapshot: SubagentSnapshot,
): TaskStatus {
  const terminal = runtime.latestResult(snapshot.agentId)
  const evidence: EvidenceSection[] = []
  if (terminal?.artifact !== undefined) evidence.push('output')
  if (terminal?.isolation !== undefined) evidence.push('isolation')
  if (terminal?.structuredOutput !== undefined) evidence.push('structured-output')
  if ((terminal?.toolExecutionReceipts.length ?? 0) > 0) evidence.push('tool-receipts')
  if ((terminal?.gateResults.length ?? 0) > 0) evidence.push('gates')
  const error = terminal?.error ?? snapshot.error
  return {
    ...summary(snapshot),
    artifact: terminal?.artifact ?? null,
    context_state: snapshot.contextState ?? null,
    effort: snapshot.effort,
    evidence,
    error: error === undefined ? null : utf8Preview(error, STATUS_ERROR_PREVIEW_BYTES),
    gate_count: terminal?.gateResults.length ?? 0,
    intercom_usage: snapshot.intercomUsage,
    model: snapshot.model,
    output_bytes: terminal?.artifact?.byteLength ?? 0,
    readonly: snapshot.readonly,
    retry_failure: snapshot.retryFailure ?? null,
    retry_state: snapshot.retryState ?? null,
    structured_output_status: terminal?.structuredOutput?.status ?? null,
    tool_receipt_count: terminal?.toolExecutionReceipts.length ?? 0,
  }
}

function activeHandle(runtime: TaskControlRuntime, agentId: string): SubagentHandle | undefined {
  return runtime.handle(agentId)
}

function inactiveSteerReceipt(runtime: TaskControlRuntime, agentId: string): SteerReceipt {
  return {
    reason: runtime.latestResult(agentId) === undefined ? 'not-active' : 'terminal',
    revision: runtime.currentRevision,
    status: 'rejected',
  }
}

function inactiveCancelReceipt(runtime: TaskControlRuntime, agentId: string): CancelReceipt {
  return {
    revision: runtime.currentRevision,
    status: runtime.latestResult(agentId) === undefined ? 'not-found' : 'already-terminal',
  }
}

function jobLine(job: JobSnapshot): string {
  const identity = taskRoleLabel(job.role, job.model)
  return `- ${job.agentId} ${job.status}${identity ? ` ${identity}` : ''} "${oneLineLabel(job.description, 80)}" ${formatJobDuration(job.durationMs)}`
}

function jobsText(jobs: readonly JobSnapshot[]): string {
  return jobs.length === 0 ? 'No jobs.' : jobs.map(jobLine).join('\n')
}

export function serializeTaskControl(details: TaskControlDetails): string {
  if ('status' in details) return jobTitle(details.jobs)
  if (details.action === 'jobs') return `${jobTitle(details.jobs)}\n${jobsText(details.jobs)}`
  if (details.action === 'wait') {
    const head =
      details.outcome === 'idle'
        ? 'No running jobs to wait on.'
        : details.outcome === 'attention'
          ? 'A child needs a coordinator decision. Inspect inbox and reply to the pending request.'
          : details.outcome === 'settled'
            ? `Settled: ${details.settled.join(', ')}. Results arrive at the next turn boundary. Use status to inspect a result.`
            : details.outcome === 'timeout'
              ? 'Wait window elapsed. Re-issue wait to keep waiting.'
              : 'Wait aborted.'
    return `${head}\n${jobsText(details.jobs)}`
  }
  return JSON.stringify(details, null, 2)
}

function utf8Preview(content: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(content)
  if (encoded.byteLength <= maxBytes) return content
  let end = maxBytes
  while (end > 0 && (encoded[end] ?? 0) >> 6 === 2) end -= 1
  return `${new TextDecoder().decode(encoded.slice(0, end))}\n[Preview truncated.]`
}

function deliverySummary(record: DeliveryRecord): DeliverySummary {
  const summary: DeliverySummary = {
    agentId: record.agentId,
    content: utf8Preview(record.content, DELIVERY_PREVIEW_BYTES),
    id: record.id,
    kind: record.kind,
    level: record.level,
    state: record.state,
  }
  if (record.requestId !== undefined) summary.requestId = record.requestId
  return summary
}

export function evidencePage(
  content: string,
  cursor: number,
  limit: number,
  serialize: (content: string, nextCursor: number | null, totalBytes: number) => string,
): { content: string; nextCursor: number | null; totalBytes: number } | undefined {
  const encoded = new TextEncoder().encode(content)
  if (cursor > encoded.byteLength) return undefined
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(encoded.slice(0, cursor))
  } catch {
    return undefined
  }
  const maximum = Math.min(encoded.byteLength, cursor + limit)
  const boundaries = [cursor]
  for (let end = cursor + 1; end <= maximum; end += 1) {
    if (end === encoded.byteLength || ((encoded[end] ?? 0) & 0xc0) !== 0x80) boundaries.push(end)
  }
  const pageAt = (index: number) => {
    const end = boundaries[index]
    if (end === undefined) return undefined
    const page = new TextDecoder().decode(encoded.slice(cursor, end))
    const nextCursor = end < encoded.byteLength ? end : null
    return { content: page, nextCursor, totalBytes: encoded.byteLength }
  }
  let accepted = 0
  let low = 1
  let high = boundaries.length - 1
  const maximumPage = pageAt(high)
  if (
    maximumPage !== undefined &&
    Buffer.byteLength(
      serialize(maximumPage.content, maximumPage.nextCursor, maximumPage.totalBytes),
    ) <= MAX_SERIALIZED_BYTES
  ) {
    return maximumPage
  }
  high -= 1
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const page = pageAt(middle)
    if (page === undefined) break
    if (
      Buffer.byteLength(serialize(page.content, page.nextCursor, page.totalBytes)) <=
      MAX_SERIALIZED_BYTES
    ) {
      accepted = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const page = pageAt(accepted)
  if (page !== undefined && accepted > 0) return page
  return {
    content: '',
    nextCursor: cursor < encoded.byteLength ? cursor : null,
    totalBytes: encoded.byteLength,
  }
}

function watchedJobs(
  scope: TaskControlScope,
  ids: ReadonlySet<string>,
  now: number,
): JobSnapshot[] {
  return scope
    .snapshots()
    .filter((snapshot) => ids.has(snapshot.agentId) && scope.allows(snapshot.agentId))
    .map((snapshot) => toJobSnapshot(snapshot, now))
}

function boundedWaitJobs(
  scope: TaskControlScope,
  ids: ReadonlySet<string>,
  now: number,
): JobSnapshot[] {
  return watchedJobs(scope, ids, now)
    .sort((left, right) => Number(left.status === 'running') - Number(right.status === 'running'))
    .slice(0, MAX_LIST_RESULTS)
}

export type WaitInput = StaticDecode<typeof WaitInputSchema>

export async function waitForJobs(
  input: WaitInput,
  host: JobProgressHost,
  runtime: Pick<TaskControlRuntime, 'subscribe'>,
  scope: TaskControlScope,
  execution: TaskControlExecution,
): Promise<TaskWaitDetails> {
  const running = scope
    .snapshots()
    .filter((snapshot) => snapshot.running && scope.allows(snapshot.agentId))
    .map((snapshot) => snapshot.agentId)
  const requested = input.agent_ids?.map((id) => id.trim())
  const ids = new Set(
    requested === undefined ? running : requested.filter((id) => running.includes(id)),
  )
  if (ids.size === 0) {
    return { action: 'wait', jobs: [], outcome: 'idle', settled: [] }
  }
  const progress = new JobProgress(
    {
      listSnapshots: () => scope.snapshots(),
      subscribe: (listener) => runtime.subscribe(listener),
    },
    { events: execution.events, hasUI: host.hasUI, ui: host.ui },
    execution.onUpdate,
  )
  for (const id of ids) progress.started(id)
  const settledIds = (): string[] =>
    watchedJobs(scope, ids, Date.now())
      .filter((job) => job.status !== 'running')
      .map((job) => job.agentId)
  try {
    const outcome = await new Promise<'settled' | 'timeout' | 'aborted' | 'attention'>(
      (resolve) => {
        let unsubscribe = (): void => undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let finished = false
        const finish = (value: 'settled' | 'timeout' | 'aborted' | 'attention'): void => {
          if (finished) return
          finished = true
          unsubscribe()
          if (timer !== undefined) clearTimeout(timer)
          execution.signal?.removeEventListener('abort', onAbort)
          resolve(value)
        }
        const onAbort = (): void => finish('aborted')
        const check = (): void => {
          if (settledIds().length > 0) finish('settled')
          else if (
            watchedJobs(scope, ids, Date.now()).some(
              (job) => job.lastActivity === 'Waiting for coordinator decision',
            )
          )
            finish('attention')
        }
        if (execution.signal?.aborted === true) {
          finish('aborted')
          return
        }
        execution.signal?.addEventListener('abort', onAbort)
        timer = setTimeout(() => finish('timeout'), input.timeout_ms ?? DEFAULT_WAIT_MS)
        const stop = runtime.subscribe(check)
        unsubscribe = stop
        if (finished) unsubscribe()
        else check()
      },
    )
    return {
      action: 'wait',
      jobs: boundedWaitJobs(scope, ids, Date.now()),
      outcome,
      settled: settledIds(),
    }
  } finally {
    progress.stop()
  }
}

export async function executeTaskControl(
  input: TaskControlInput,
  ctx: ExtensionContext,
  runtime: TaskControlRuntime,
  scope: TaskControlScope,
  execution: TaskControlExecution = { onUpdate: undefined, signal: undefined },
): Promise<TaskControlDetails> {
  if (input.action === 'evidence') {
    const agentId = input.agent_id.trim()
    if (!scope.allows(agentId)) {
      return {
        action: 'evidence',
        agent_id: agentId,
        attempt: input.attempt,
        content: '',
        cursor: input.cursor ?? 0,
        digest: null,
        freshness: null,
        next_cursor: null,
        outcome: 'not-found',
        section: input.section,
        total_bytes: 0,
      }
    }
    const cursor = input.cursor ?? 0
    if (cursor > 0 && input.digest === undefined) {
      return {
        action: 'evidence',
        agent_id: agentId,
        attempt: input.attempt,
        content: '',
        cursor,
        digest: null,
        freshness: null,
        next_cursor: null,
        outcome: 'invalid-cursor',
        section: input.section,
        total_bytes: 0,
      }
    }
    const evidence = await runtime.readEvidence(agentId, input.attempt, input.section, input.digest)
    if (evidence === undefined) {
      return {
        action: 'evidence',
        agent_id: agentId,
        attempt: input.attempt,
        content: '',
        cursor,
        digest: null,
        freshness: null,
        next_cursor: null,
        outcome: 'not-found',
        section: input.section,
        total_bytes: 0,
      }
    }
    const page = evidencePage(
      evidence.content,
      cursor,
      input.limit ?? DEFAULT_EVIDENCE_BYTES,
      (content, nextCursor, totalBytes) => {
        const details: TaskControlDetails = {
          action: 'evidence',
          agent_id: agentId,
          attempt: input.attempt,
          content,
          cursor,
          digest: evidence.digest,
          freshness: evidence.freshness,
          next_cursor: nextCursor,
          outcome: 'found',
          section: input.section,
          total_bytes: totalBytes,
        }
        return JSON.stringify({
          content: [{ text: serializeTaskControl(details), type: 'text' }],
          details,
        })
      },
    )
    return page === undefined
      ? {
          action: 'evidence',
          agent_id: agentId,
          attempt: input.attempt,
          content: '',
          cursor,
          digest: evidence.digest,
          freshness: evidence.freshness,
          next_cursor: null,
          outcome: 'invalid-cursor',
          section: input.section,
          total_bytes: Buffer.byteLength(evidence.content),
        }
      : {
          action: 'evidence',
          agent_id: agentId,
          attempt: input.attempt,
          content: page.content,
          cursor,
          digest: evidence.digest,
          freshness: evidence.freshness,
          next_cursor: page.nextCursor,
          outcome: 'found',
          section: input.section,
          total_bytes: page.totalBytes,
        }
  }
  if (input.action === 'inbox') {
    const cursor = input.cursor ?? 0
    const limit = input.limit ?? DEFAULT_LIST_RESULTS
    const records = runtime.deliveries
      .list(input.agent_id?.trim())
      .filter((delivery) => scope.allows(delivery.agentId))
    const deliveries = records.slice(cursor, cursor + limit).map(deliverySummary)
    const nextCursor = cursor + deliveries.length
    return {
      action: 'inbox',
      count: deliveries.length,
      cursor,
      deliveries,
      has_more: nextCursor < records.length,
      next_cursor: nextCursor < records.length ? nextCursor : null,
      total: records.length,
    }
  }
  if (input.action === 'acknowledge') {
    const record = runtime.deliveries.get(input.delivery_id)
    const allowed =
      scope.allows(input.agent_id) &&
      record?.agentId === input.agent_id &&
      record.kind !== 'request'
    return {
      action: 'acknowledge',
      agent_id: input.agent_id,
      delivery_id: input.delivery_id,
      outcome:
        allowed && runtime.deliveries.acknowledge(input.delivery_id) ? 'acknowledged' : 'rejected',
    }
  }
  if (input.action === 'reply') {
    const receipt: DecisionReceipt = scope.allows(input.agent_id)
      ? runtime.replyToDecision(
          input.agent_id,
          input.request_id,
          input.message,
          scope.callerId(ctx),
        )
      : { outcome: 'rejected', reason: 'not-pending', requestId: input.request_id }
    return { action: 'reply', agent_id: input.agent_id, ...receipt }
  }
  if (input.action === 'wait') return waitForJobs(input, ctx, runtime, scope, execution)
  if (input.action === 'jobs') {
    const now = Date.now()
    const cursor = input.cursor ?? 0
    const limit = input.limit ?? DEFAULT_LIST_RESULTS
    const all = scope
      .snapshots()
      .filter((snapshot) => scope.allows(snapshot.agentId))
      .map((snapshot) => toJobSnapshot(snapshot, now))
    const jobs = all.slice(cursor, cursor + limit)
    const nextCursor = cursor + jobs.length
    return {
      action: 'jobs',
      count: jobs.length,
      cursor,
      has_more: nextCursor < all.length,
      jobs,
      next_cursor: nextCursor < all.length ? nextCursor : null,
      total: all.length,
    }
  }
  if (input.action === 'status') {
    const agentId = input.agent_id.trim()
    const snapshot = scope
      .snapshots()
      .find((candidate) => candidate.agentId === agentId && scope.allows(candidate.agentId))
    return snapshot === undefined
      ? { action: 'status', agent_id: agentId, outcome: 'not-found' }
      : { action: 'status', outcome: 'found', task: taskStatus(runtime, snapshot) }
  }
  if (input.action === 'list') {
    const activeOnly = input.active_only ?? false
    const limit = input.limit ?? DEFAULT_LIST_RESULTS
    const snapshots = scope
      .snapshots()
      .filter((snapshot) => scope.allows(snapshot.agentId) && (!activeOnly || snapshot.running))
    return {
      action: 'list',
      active_only: activeOnly,
      count: Math.min(limit, snapshots.length),
      has_more: snapshots.length > limit,
      limit,
      tasks: snapshots.slice(0, limit).map((snapshot) => summary(snapshot)),
      total: snapshots.length,
    }
  }

  const agentId = input.agent_id.trim()
  if (!scope.allows(agentId)) {
    if (input.action === 'join') {
      return {
        action: 'join',
        agent_id: agentId,
        outcome: 'rejected',
        reason: 'not-found',
        receipt: null,
        revision: runtime.currentRevision,
      }
    }
    if (input.action === 'steer') {
      return {
        action: 'steer',
        agent_id: agentId,
        outcome: 'rejected',
        queued_at: null,
        reason: 'not-active',
        revision: runtime.currentRevision,
      }
    }
    return {
      action: 'cancel',
      agent_id: agentId,
      outcome: 'not-found',
      reason: input.reason.trim(),
      revision: runtime.currentRevision,
    }
  }
  if (input.action === 'join') {
    const destination = await scope.destination(ctx, agentId).catch(() => undefined)
    if (destination === undefined) {
      return {
        action: 'join',
        agent_id: agentId,
        outcome: 'rejected',
        reason: 'invalid-lineage',
        receipt: null,
        revision: runtime.currentRevision,
      }
    }
    const join = await runtime.joinStaged(agentId, destination, scope.callerId(ctx))
    if (join.status === 'joined')
      runtime.deliveries.settleAgent(agentId, 'completion', 'acknowledged')
    return {
      action: 'join',
      agent_id: agentId,
      outcome: join.status === 'rejected' ? 'rejected' : join.status,
      reason: join.reason ?? null,
      receipt: isolationSummary(join.receipt),
      revision: join.revision,
    }
  }
  const handle = activeHandle(runtime, agentId)
  if (input.action === 'steer') {
    const receipt =
      handle === undefined
        ? inactiveSteerReceipt(runtime, agentId)
        : await scope.steer(handle, input.message)
    return {
      action: 'steer',
      agent_id: agentId,
      outcome: receipt.status,
      queued_at: receipt.queuedAt ?? null,
      reason: receipt.reason ?? null,
      revision: receipt.revision,
    }
  }

  const reason = input.reason.trim()
  if (reason.length === 0) throw new Error('The cancellation reason is empty.')
  const receipt =
    handle === undefined
      ? inactiveCancelReceipt(runtime, agentId)
      : await scope.cancel(handle, reason)
  return {
    action: 'cancel',
    agent_id: agentId,
    outcome: receipt.status,
    reason,
    revision: receipt.revision,
  }
}

export interface TaskControlRenderState {
  hasResult?: boolean
}

class PendingLine implements Component {
  constructor(
    private readonly state: TaskControlRenderState,
    private readonly lines: readonly string[],
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return this.state.hasResult === true
      ? []
      : this.lines.map((line) => truncateToWidth(line, width, '…'))
  }
}

export type LabelResolver = (agentId: string) => string

function pendingTarget(input: TaskControlInput, label: LabelResolver): string {
  switch (input.action) {
    case 'evidence':
      return `${input.section} evidence ${label(input.agent_id)} attempt ${input.attempt}`
    case 'inbox':
      return 'notification inbox'
    case 'acknowledge':
      return `Acknowledge ${label(input.agent_id)}`
    case 'reply':
      return `Reply ${ARROW_OUT} ${label(input.agent_id)}`
    case 'jobs':
      return 'background jobs'
    case 'wait': {
      if (input.agent_ids === undefined) return 'all running jobs'
      const first = input.agent_ids[0]
      return input.agent_ids.length === 1 && first !== undefined
        ? `poll ${label(first)}`
        : `poll ${input.agent_ids.length} jobs`
    }
    case 'list':
      return 'tasks'
    case 'status':
      return `status ${label(input.agent_id)}`
    case 'steer':
      return `Steer ${ARROW_OUT} ${label(input.agent_id)}`
    case 'cancel':
      return `Cancel ${label(input.agent_id)}`
    case 'join':
      return `Join ${label(input.agent_id)}`
  }
}

export function renderTaskControlCall(
  input: TaskControlInput,
  theme: SubagentTheme,
  state: TaskControlRenderState,
  label: LabelResolver = (agentId) => agentId,
): Component {
  const lines = [`${theme.fg('muted', '⏳')} ${theme.fg('accent', pendingTarget(input, label))}`]
  if (input.action === 'steer') {
    lines.push(
      ...quotedBody(input.message, theme, { collapsedLines: 1, expanded: false, tone: 'dim' }),
    )
  }
  return new PendingLine(state, lines)
}

function statusRow(
  task: TaskStatusSummary & { error?: string | null },
  agentType: string,
  now: number,
): AgentRow {
  const running = task.running
  return {
    activity: running ? (task.activity ?? undefined) : undefined,
    agentType,
    background: false,
    context: undefined,
    cost: task.usage.cost,
    durationMs: Math.max(0, (task.ended_at ?? now) - task.started_at),
    error: task.error ?? undefined,
    label: task.description,
    model: task.model,
    role: task.role,
    output: undefined,
    status: task.state,
    task: undefined,
    toolCalls: task.usage.toolCalls,
  }
}

function receiptLine(
  icon: string,
  color: 'error' | 'success' | 'warning',
  title: string,
  outcome: string,
  reason: string | null,
  theme: SubagentTheme,
): string {
  const meta = [theme.fg(color, outcome), reason === null ? '' : reason].filter(
    (part) => part.length > 0,
  )
  return `${theme.fg(color, icon)} ${theme.fg('accent', title)} ${theme.fg('dim', meta.join(' · '))}`
}

export function renderTaskControlResult(
  details: TaskControlDetails | undefined,
  text: string,
  options: { expanded: boolean; isPartial: boolean },
  theme: SubagentTheme,
  state: TaskControlRenderState,
  label: LabelResolver = (agentId) => agentId,
  args?: TaskControlInput,
): Component {
  if (details === undefined) return new Text(text, 0, 0)
  state.hasResult = true
  if ('status' in details) {
    return new JobTree(details.jobs, { expanded: options.expanded, isPartial: true }, theme)
  }
  const rowOptions = { expanded: options.expanded, live: false }
  switch (details.action) {
    case 'evidence':
      return new Text(text, 0, 0)
    case 'inbox':
      return new Text(
        details.deliveries
          .map(
            (delivery) =>
              `${label(delivery.agentId)} · ${delivery.kind} · ${delivery.state}\n${delivery.content}`,
          )
          .join('\n\n') || 'No notifications.',
        0,
        0,
      )
    case 'acknowledge':
    case 'reply':
      return new Text(`${label(details.agent_id)} · ${details.outcome}`, 0, 0)
    case 'wait':
      return new JobTree(details.jobs, { expanded: options.expanded, isPartial: false }, theme)
    case 'jobs':
      return new JobTree(
        details.jobs,
        { expanded: options.expanded, isPartial: false, retainRunning: true },
        theme,
      )
    case 'status': {
      if (details.outcome === 'not-found') {
        return new Text(
          `${theme.fg('warning', '⚠')} ${theme.fg('accent', 'Task')} ${theme.fg('dim', `${details.agent_id} not found`)}`,
          0,
          0,
        )
      }
      const task = details.task
      return new TaskResult([statusRow(task, task.subagent_type, Date.now())], rowOptions, theme)
    }
    case 'list': {
      if (details.tasks.length === 0) {
        return new Text(
          `${theme.fg('accent', 'ⓘ')} ${theme.fg('muted', 'No tasks in this session.')}`,
          0,
          0,
        )
      }
      const now = Date.now()
      const rows = details.tasks.map((task) => statusRow(task, task.subagent_type, now))
      const summary = details.has_more
        ? theme.fg('dim', formatMoreItems(details.total - details.count, 'task'))
        : undefined
      return new TaskResult(rows, rowOptions, theme, summary)
    }
    case 'steer': {
      const title = `Steer ${ARROW_OUT} ${label(details.agent_id)}`
      const queued = details.outcome === 'queued'
      const lines = [
        receiptLine(
          queued ? MAIL_ICON : '⚠',
          queued ? 'success' : 'warning',
          title,
          details.outcome,
          details.reason,
          theme,
        ),
      ]
      if (args?.action === 'steer') {
        lines.push(...quotedBody(args.message, theme, { expanded: options.expanded, tone: 'dim' }))
      }
      return new Text(lines.join('\n'), 0, 0)
    }
    case 'cancel': {
      const requested = details.outcome === 'requested'
      return new Text(
        receiptLine(
          requested ? '⏹' : '⚠',
          requested ? 'warning' : 'warning',
          `Cancel ${label(details.agent_id)}`,
          details.outcome,
          details.reason,
          theme,
        ),
        0,
        0,
      )
    }
    case 'join': {
      const joined = details.outcome === 'joined'
      const conflict = details.outcome === 'conflict'
      return new Text(
        receiptLine(
          joined ? '✔' : conflict ? '⚠' : '✘',
          joined ? 'success' : conflict ? 'warning' : 'error',
          `Join ${label(details.agent_id)}`,
          details.outcome,
          details.reason,
          theme,
        ),
        0,
        0,
      )
    }
  }
}

export const taskControlDescription =
  'Inspect, steer, cancel, join, or wait on existing Tasks without resume. Operational responses are bounded summaries. evidence retrieves paginated output or verification evidence for an exact Agent ID and attempt. inbox shows bounded notification delivery previews. acknowledge resolves a notice; reply answers a request_parent decision by request_id. Acknowledge and reply require identifiers returned by inbox. wait blocks until a job settles, timeout, or abort; use it only without other work. jobs does not wait. Steer only queues text. Cancel prevents later integration only for isolated writers.'

export function registerTaskControl(
  pi: ExtensionAPI,
  host: SubagentControllerHost,
  runtime: SubagentRuntime,
): void {
  const labelFor: LabelResolver = (agentId) =>
    runtime.listSnapshots().find((snapshot) => snapshot.agentId === agentId)?.description ?? agentId
  const scope: TaskControlScope = {
    allows: () => true,
    callerId: (ctx) => ctx.sessionManager.getSessionId(),
    cancel: (handle, reason) => host.cancel(handle, reason),
    destination: (ctx, agentId) => runtime.rootDestination(ctx, agentId),
    snapshots: () => runtime.listSnapshots(),
    steer: (handle, message) => host.steer(handle, message),
  }
  pi.registerTool<typeof TaskControlInputSchema, TaskControlDetails, TaskControlRenderState>({
    description: taskControlDescription,
    execute: async (_callId, rawInput, signal, onUpdate, ctx) => {
      runtime.ensureContext(ctx)
      const details = await executeTaskControl(
        Value.Decode(TaskControlInputSchema, rawInput),
        ctx,
        runtime,
        scope,
        { events: pi.events, onUpdate, signal },
      )
      return { content: [{ text: serializeTaskControl(details), type: 'text' }], details }
    },
    executionMode: 'parallel',
    label: 'Task Control',
    name: 'TaskControl',
    parameters: TaskControlInputSchema,
    renderCall: (args, theme, context) =>
      renderTaskControlCall(args, theme, context.state, labelFor),
    renderResult: (result, options, theme, context) =>
      renderTaskControlResult(
        result.details,
        result.content.find((item) => item.type === 'text')?.text ?? '',
        options,
        theme,
        context.state,
        labelFor,
        context.args,
      ),
  })
}
