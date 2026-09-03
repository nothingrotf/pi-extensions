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
import { oneLineLabel, type SubagentTheme } from './format.ts'
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
import { type AgentRow, TaskResult } from './task-render.ts'

const MAX_LIST_RESULTS = 20
const DEFAULT_LIST_RESULTS = 10
const DEFAULT_WAIT_MS = 300_000
const MAX_WAIT_MS = 3_600_000

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
        description: 'Return after this many milliseconds when nothing settles. Default 300000.',
        maximum: MAX_WAIT_MS,
        minimum: 1_000,
      }),
    ),
  },
  { additionalProperties: false },
)

const JobsInputSchema = Type.Object(
  { action: Type.Literal('jobs') },
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

export const TaskControlInputSchema = Type.Union([
  StatusInputSchema,
  SteerInputSchema,
  CancelInputSchema,
  JoinInputSchema,
  ListInputSchema,
  WaitInputSchema,
  JobsInputSchema,
])

export type TaskControlInput = StaticDecode<typeof TaskControlInputSchema>

interface TaskStatusSummary {
  activity: string | null
  agent_id: string
  description: string
  ended_at: number | null
  isolation: SubagentSnapshot['isolation'] | null
  running: boolean
  started_at: number
  state: SubagentSnapshot['status']
  subagent_type: SubagentSnapshot['subagentType']
  usage: SubagentSnapshot['usage']
}

interface TaskStatus extends TaskStatusSummary {
  context_state: SubagentSnapshot['contextState'] | null
  effort: SubagentSnapshot['effort']
  intercom_usage: SubagentSnapshot['intercomUsage']
  model: string
  readonly: boolean
  retry_failure: SubagentSnapshot['retryFailure'] | null
  retry_state: SubagentSnapshot['retryState'] | null
  terminal_result: SubagentResult | null
}

export type TaskControlDetails =
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
      outcome: 'requested' | 'already-terminal' | 'not-found' | 'stale-handle'
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
      receipt: SubagentResult['isolation'] | null
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
  | { action: 'jobs'; jobs: JobSnapshot[] }
  | JobProgressDetails

export interface TaskWaitDetails {
  action: 'wait'
  jobs: JobSnapshot[]
  outcome: 'settled' | 'timeout' | 'aborted' | 'idle'
  settled: string[]
}

export interface TaskControlExecution {
  events?: JobProgressHost['events']
  onUpdate: AgentToolUpdateCallback<JobProgressDetails> | undefined
  signal: AbortSignal | undefined
}

export type TaskControlRuntime = Pick<
  SubagentRuntime,
  'currentRevision' | 'handle' | 'joinStaged' | 'latestResult' | 'subscribe'
>

export interface TaskControlScope {
  allows: (agentId: string) => boolean
  callerId: (ctx: ExtensionContext) => string
  cancel: (handle: SubagentHandle, reason: string) => Promise<CancelReceipt>
  destination: (ctx: ExtensionContext) => Promise<IsolationDestination>
  snapshots: () => SubagentSnapshot[]
  steer: (handle: SubagentHandle, message: string) => Promise<SteerReceipt>
}

function summary(snapshot: SubagentSnapshot): TaskStatusSummary {
  return {
    activity: snapshot.lastActivity ?? null,
    agent_id: snapshot.agentId,
    description: snapshot.description,
    ended_at: snapshot.endedAt ?? null,
    isolation: snapshot.isolation ?? null,
    running: snapshot.running,
    started_at: snapshot.startedAt,
    state: snapshot.status,
    subagent_type: snapshot.subagentType,
    usage: snapshot.usage,
  }
}

function status(runtime: TaskControlRuntime, snapshot: SubagentSnapshot): TaskStatus {
  return {
    ...summary(snapshot),
    context_state: snapshot.contextState ?? null,
    effort: snapshot.effort,
    intercom_usage: snapshot.intercomUsage,
    model: snapshot.model,
    readonly: snapshot.readonly,
    retry_failure: snapshot.retryFailure ?? null,
    retry_state: snapshot.retryState ?? null,
    terminal_result: runtime.latestResult(snapshot.agentId) ?? null,
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
  return `- ${job.agentId} ${job.status} "${oneLineLabel(job.description, 80)}" ${formatJobDuration(job.durationMs)}`
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
        : details.outcome === 'settled'
          ? `Settled: ${details.settled.join(', ')}. Each result arrives as a follow-up message.`
          : details.outcome === 'timeout'
            ? 'Wait window elapsed. Re-issue wait to keep waiting.'
            : 'Wait aborted.'
    return `${head}\n${jobsText(details.jobs)}`
  }
  return JSON.stringify(details, null, 2)
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
    const outcome = await new Promise<'settled' | 'timeout' | 'aborted'>((resolve) => {
      let unsubscribe = (): void => undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (value: 'settled' | 'timeout' | 'aborted'): void => {
        unsubscribe()
        if (timer !== undefined) clearTimeout(timer)
        execution.signal?.removeEventListener('abort', onAbort)
        resolve(value)
      }
      const onAbort = (): void => finish('aborted')
      const check = (): void => {
        if (settledIds().length > 0) finish('settled')
      }
      if (execution.signal?.aborted === true) {
        finish('aborted')
        return
      }
      execution.signal?.addEventListener('abort', onAbort)
      unsubscribe = runtime.subscribe(check)
      timer = setTimeout(() => finish('timeout'), input.timeout_ms ?? DEFAULT_WAIT_MS)
      check()
    })
    return {
      action: 'wait',
      jobs: watchedJobs(scope, ids, Date.now()),
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
  if (input.action === 'wait') return waitForJobs(input, ctx, runtime, scope, execution)
  if (input.action === 'jobs') {
    const now = Date.now()
    return {
      action: 'jobs',
      jobs: scope
        .snapshots()
        .filter((snapshot) => scope.allows(snapshot.agentId))
        .map((snapshot) => toJobSnapshot(snapshot, now)),
    }
  }
  if (input.action === 'status') {
    const agentId = input.agent_id.trim()
    const snapshot = scope
      .snapshots()
      .find((candidate) => candidate.agentId === agentId && scope.allows(candidate.agentId))
    return snapshot === undefined
      ? { action: 'status', agent_id: agentId, outcome: 'not-found' }
      : { action: 'status', outcome: 'found', task: status(runtime, snapshot) }
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
    const join = await runtime.joinStaged(
      agentId,
      await scope.destination(ctx),
      scope.callerId(ctx),
    )
    return {
      action: 'join',
      agent_id: agentId,
      outcome: join.status === 'rejected' ? 'rejected' : join.status,
      reason: join.reason ?? null,
      receipt: join.receipt ?? null,
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
  task: TaskStatusSummary,
  agentType: string,
  terminal: SubagentResult | null,
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
    error: terminal?.error,
    label: task.description,
    output: terminal?.output,
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
      return new TaskResult(
        [statusRow(task, task.subagent_type, task.terminal_result, Date.now())],
        rowOptions,
        theme,
      )
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
      const rows = details.tasks.map((task) => statusRow(task, task.subagent_type, null, now))
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
  'Inspect, steer, cancel, join, or wait on existing Tasks without resume. wait blocks until the first watched job settles, the timeout elapses, or the call is aborted; use it only when you have no other work. jobs returns a status snapshot without waiting. Steer only queues text. Cancel prevents later integration only for isolated writers.'

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
    destination: (ctx) => runtime.rootDestination(ctx),
    snapshots: () => runtime.listSnapshots(),
    steer: (handle, message) => host.steer(handle, message),
  }
  pi.registerTool<typeof TaskControlInputSchema, TaskControlDetails, TaskControlRenderState>({
    description: taskControlDescription,
    execute: async (_callId, rawInput, signal, onUpdate, ctx) => {
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
