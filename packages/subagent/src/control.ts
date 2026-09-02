import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { type StaticDecode, Type } from 'typebox'
import { Value } from 'typebox/value'

import type { SubagentControllerHost } from './controller.ts'
import type { IsolationDestination } from './isolation.ts'
import type {
  CancelReceipt,
  SteerReceipt,
  SubagentHandle,
  SubagentResult,
  SubagentRuntime,
  SubagentSnapshot,
} from './runtime.ts'

const MAX_LIST_RESULTS = 20
const DEFAULT_LIST_RESULTS = 10

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
  subagent_type: SubagentSnapshot['subagentType']
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
    usage: snapshot.usage,
  }
}

function status(runtime: SubagentRuntime, snapshot: SubagentSnapshot): TaskStatus {
  return {
    ...summary(snapshot),
    context_state: snapshot.contextState ?? null,
    effort: snapshot.effort,
    intercom_usage: snapshot.intercomUsage,
    model: snapshot.model,
    readonly: snapshot.readonly,
    retry_failure: snapshot.retryFailure ?? null,
    retry_state: snapshot.retryState ?? null,
    subagent_type: snapshot.subagentType,
    terminal_result: runtime.latestResult(snapshot.agentId) ?? null,
  }
}

function activeHandle(runtime: SubagentRuntime, agentId: string): SubagentHandle | undefined {
  return runtime.handle(agentId)
}

function inactiveSteerReceipt(runtime: SubagentRuntime, agentId: string): SteerReceipt {
  return {
    reason: runtime.latestResult(agentId) === undefined ? 'not-active' : 'terminal',
    revision: runtime.currentRevision,
    status: 'rejected',
  }
}

function inactiveCancelReceipt(runtime: SubagentRuntime, agentId: string): CancelReceipt {
  return {
    revision: runtime.currentRevision,
    status: runtime.latestResult(agentId) === undefined ? 'not-found' : 'already-terminal',
  }
}

function serialize(details: TaskControlDetails): string {
  return JSON.stringify(details, null, 2)
}

export async function executeTaskControl(
  input: TaskControlInput,
  ctx: ExtensionContext,
  runtime: SubagentRuntime,
  scope: TaskControlScope,
): Promise<TaskControlDetails> {
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

export function registerTaskControl(
  pi: ExtensionAPI,
  host: SubagentControllerHost,
  runtime: SubagentRuntime,
): void {
  const scope: TaskControlScope = {
    allows: () => true,
    callerId: (ctx) => ctx.sessionManager.getSessionId(),
    cancel: (handle, reason) => host.cancel(handle, reason),
    destination: (ctx) => runtime.rootDestination(ctx),
    snapshots: () => runtime.listSnapshots(),
    steer: (handle, message) => host.steer(handle, message),
  }
  pi.registerTool<typeof TaskControlInputSchema, TaskControlDetails>({
    description:
      'Inspect, steer, cancel, or join an existing Task without resume. Steer only queues text. Cancel prevents later integration only for isolated writers.',
    execute: async (_callId, rawInput, _signal, _onUpdate, ctx) => {
      const details = await executeTaskControl(
        Value.Decode(TaskControlInputSchema, rawInput),
        ctx,
        runtime,
        scope,
      )
      return { content: [{ text: serialize(details), type: 'text' }], details }
    },
    executionMode: 'parallel',
    label: 'Task Control',
    name: 'TaskControl',
    parameters: TaskControlInputSchema,
  })
}
