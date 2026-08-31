import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const delegationRequestEvent = 'prompt-template:subagent:request'
const delegationStartedEvent = 'prompt-template:subagent:started'
const delegationUpdateEvent = 'prompt-template:subagent:update'
const delegationResponseEvent = 'prompt-template:subagent:response'
const delegationCancelEvent = 'prompt-template:subagent:cancel'
const rpcRequestEvent = 'subagents:rpc:v1:request'
const rpcReplyPrefix = 'subagents:rpc:v1:reply:'
export const asyncCompleteEvent = 'subagent:async-complete'

const DelegationIdentitySchema = Type.Object(
  {
    requestId: Type.String(),
    ownerRunId: Type.String(),
    nodeId: Type.String(),
  },
  { additionalProperties: true },
)

const DelegationUpdateSchema = Type.Object(
  {
    requestId: Type.String(),
    ownerRunId: Type.String(),
    nodeId: Type.String(),
    runId: Type.Optional(Type.String()),
    currentTool: Type.Optional(Type.String()),
    recentOutput: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    toolCount: Type.Optional(Type.Number({ minimum: 0 })),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: true },
)

const DelegationUsageSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
    turns: Type.Number({ minimum: 0 }),
    toolCalls: Type.Number({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: true },
)

const DelegationResultSchema = Type.Union([
  Type.Object({ kind: Type.Literal('text'), text: Type.String() }, { additionalProperties: true }),
  Type.Object(
    { kind: Type.Literal('structured'), value: Type.Unknown() },
    { additionalProperties: true },
  ),
])

const DelegationResponseSchema = Type.Object(
  {
    requestId: Type.String(),
    ownerRunId: Type.Optional(Type.String()),
    nodeId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal('completed'),
      Type.Literal('failed'),
      Type.Literal('timed_out'),
      Type.Literal('cancelled'),
      Type.Literal('interrupted'),
      Type.Literal('tool_budget_exhausted'),
      Type.Literal('structured_output_failed'),
      Type.Literal('acceptance_failed'),
      Type.Literal('invalid_request'),
      Type.Literal('unavailable_context'),
      Type.Literal('duplicate_node'),
    ]),
    error: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    agent: Type.Optional(Type.String()),
    model: Type.Optional(Type.String()),
    result: Type.Optional(DelegationResultSchema),
    usage: Type.Optional(DelegationUsageSchema),
  },
  { additionalProperties: true },
)

const RpcReplySchema = Type.Union([
  Type.Object(
    {
      version: Type.Literal(1),
      requestId: Type.String(),
      success: Type.Literal(true),
      data: Type.Unknown(),
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      version: Type.Literal(1),
      requestId: Type.String(),
      success: Type.Literal(false),
      error: Type.Object(
        { code: Type.String(), message: Type.String() },
        { additionalProperties: true },
      ),
    },
    { additionalProperties: true },
  ),
])

const RpcLaunchDataSchema = Type.Object(
  {
    text: Type.String(),
    details: Type.Object(
      {
        runId: Type.Optional(Type.String()),
        asyncId: Type.Optional(Type.String()),
        asyncDir: Type.Optional(Type.String()),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
)

const AsyncUsageSchema = Type.Object(
  {
    input: Type.Optional(Type.Number({ minimum: 0 })),
    output: Type.Optional(Type.Number({ minimum: 0 })),
    cacheRead: Type.Optional(Type.Number({ minimum: 0 })),
    cacheWrite: Type.Optional(Type.Number({ minimum: 0 })),
    cost: Type.Optional(Type.Number({ minimum: 0 })),
    turns: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: true },
)

const AsyncChildSchema = Type.Object(
  {
    output: Type.Optional(Type.String()),
    error: Type.Optional(Type.String()),
    success: Type.Optional(Type.Boolean()),
    state: Type.Optional(Type.String()),
    status: Type.Optional(Type.String()),
    interrupted: Type.Optional(Type.Boolean()),
    stopped: Type.Optional(Type.Boolean()),
    model: Type.Optional(Type.String()),
    transcriptPath: Type.Optional(Type.String()),
    usage: Type.Optional(AsyncUsageSchema),
    toolBudget: Type.Optional(
      Type.Object(
        { toolCount: Type.Optional(Type.Number({ minimum: 0 })) },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)

export const AsyncCompletionSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    runId: Type.Optional(Type.String()),
    success: Type.Optional(Type.Boolean()),
    state: Type.Optional(Type.String()),
    interrupted: Type.Optional(Type.Boolean()),
    stopped: Type.Optional(Type.Boolean()),
    summary: Type.Optional(Type.String()),
    durationMs: Type.Optional(Type.Number({ minimum: 0 })),
    results: Type.Optional(Type.Array(AsyncChildSchema)),
  },
  { additionalProperties: true },
)

export type DelegationUpdate = Static<typeof DelegationUpdateSchema>
export type DelegationResponse = Static<typeof DelegationResponseSchema>
export type AsyncCompletion = Static<typeof AsyncCompletionSchema>
export type DelegationUsage = Static<typeof DelegationUsageSchema>

export type TaskEventBus = ExtensionAPI['events']

export interface ForegroundRequest {
  requestId: string
  ownerRunId: string
  nodeId: string
  agent: string
  task: string
  cwd: string
  model?: string
}

export type ForegroundOutcome =
  | {
      kind: 'completed'
      runId: string
      finalMessage: string
      model?: string
      usage?: DelegationUsage
    }
  | { kind: 'error'; error: string; runId?: string }

export type CompletionOutcome =
  | {
      kind: 'completed'
      runId: string
      finalMessage: string
      toolCallCount: number
      durationMs: number
      model?: string
      transcriptPath?: string
    }
  | { kind: 'error'; runId: string; error: string }
  | { kind: 'aborted'; runId: string; error: string }

function decodeIdentity<Input>(value: Input): Static<typeof DelegationIdentitySchema> | null {
  try {
    return Value.Decode(DelegationIdentitySchema, value)
  } catch {
    return null
  }
}

function decodeUpdate<Input>(value: Input): DelegationUpdate | null {
  try {
    return Value.Decode(DelegationUpdateSchema, value)
  } catch {
    return null
  }
}

function decodeResponse<Input>(value: Input): DelegationResponse | null {
  try {
    return Value.Decode(DelegationResponseSchema, value)
  } catch {
    return null
  }
}

function decodeRpcReply<Input>(value: Input): Static<typeof RpcReplySchema> | null {
  try {
    return Value.Decode(RpcReplySchema, value)
  } catch {
    return null
  }
}

function subscription(value: (() => void) | void): () => void {
  return value ?? (() => undefined)
}

function sameIdentity(
  value: { requestId: string; ownerRunId?: string; nodeId?: string },
  request: ForegroundRequest,
): boolean {
  return (
    value.requestId === request.requestId &&
    value.ownerRunId === request.ownerRunId &&
    value.nodeId === request.nodeId
  )
}

export function delegateForeground(
  events: TaskEventBus,
  request: ForegroundRequest,
  signal: AbortSignal | undefined,
  onUpdate: ((update: DelegationUpdate) => void) | undefined,
): Promise<ForegroundOutcome> {
  return new Promise((resolve) => {
    let started = false
    let settled = false
    const cleanups: Array<() => void> = []

    const cleanup = () => {
      for (const dispose of cleanups) {
        dispose()
      }
      signal?.removeEventListener('abort', cancel)
    }

    const finish = (outcome: ForegroundOutcome) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(outcome)
    }

    const cancel = () => {
      events.emit(delegationCancelEvent, {
        requestId: request.requestId,
        ownerRunId: request.ownerRunId,
        nodeId: request.nodeId,
      })
    }

    cleanups.push(
      subscription(
        events.on(delegationStartedEvent, (data) => {
          const value = decodeIdentity(data)
          if (value !== null && sameIdentity(value, request)) {
            started = true
          }
        }),
      ),
    )

    cleanups.push(
      subscription(
        events.on(delegationUpdateEvent, (data) => {
          const value = decodeUpdate(data)
          if (value !== null && sameIdentity(value, request)) {
            onUpdate?.(value)
          }
        }),
      ),
    )

    cleanups.push(
      subscription(
        events.on(delegationResponseEvent, (data) => {
          const value = decodeResponse(data)
          if (value === null || value.requestId !== request.requestId) {
            return
          }
          if (
            value.ownerRunId !== undefined &&
            value.nodeId !== undefined &&
            !sameIdentity(value, request)
          ) {
            return
          }
          if (value.status !== 'completed') {
            const error = value.error ?? `Task child ended with status ${value.status}.`
            if (value.runId === undefined) {
              finish({ kind: 'error', error })
            } else {
              finish({ kind: 'error', error, runId: value.runId })
            }
            return
          }
          if (value.runId === undefined) {
            finish({ kind: 'error', error: 'pi-subagents returned no foreground run ID.' })
            return
          }
          const finalMessage = value.result?.kind === 'text' ? value.result.text : ''
          if (value.model !== undefined && value.usage !== undefined) {
            finish({
              kind: 'completed',
              runId: value.runId,
              finalMessage,
              model: value.model,
              usage: value.usage,
            })
            return
          }
          if (value.model !== undefined) {
            finish({
              kind: 'completed',
              runId: value.runId,
              finalMessage,
              model: value.model,
            })
            return
          }
          if (value.usage !== undefined) {
            finish({
              kind: 'completed',
              runId: value.runId,
              finalMessage,
              usage: value.usage,
            })
            return
          }
          finish({ kind: 'completed', runId: value.runId, finalMessage })
        }),
      ),
    )

    if (signal?.aborted === true) {
      cancel()
      finish({ kind: 'error', error: 'Task was aborted by the user.' })
      return
    }
    signal?.addEventListener('abort', cancel, { once: true })
    const payload = {
      requestId: request.requestId,
      ownerRunId: request.ownerRunId,
      nodeId: request.nodeId,
      agent: request.agent,
      task: request.task,
      context: 'fresh',
      cwd: request.cwd,
      result: { kind: 'text' },
    }
    events.emit(
      delegationRequestEvent,
      request.model === undefined ? payload : { ...payload, model: request.model },
    )
    if (!started && !settled) {
      finish({
        kind: 'error',
        error: 'pi-subagents is not installed or its delegation bridge is not ready.',
      })
    }
  })
}

export async function rpcRequest<Params>(
  events: TaskEventBus,
  method: 'ping' | 'spawn' | 'resume' | 'stop',
  params: Params,
  timeoutMs = 30_000,
): Promise<unknown> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    let settled = false
    const replyEvent = `${rpcReplyPrefix}${requestId}`
    const dispose = subscription(
      events.on(replyEvent, (data) => {
        const reply = decodeRpcReply(data)
        if (reply === null || reply.requestId !== requestId || settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        dispose()
        if (reply.success) {
          resolve(reply.data)
          return
        }
        reject(new Error(`${reply.error.code}: ${reply.error.message}`))
      }),
    )
    const timer = setTimeout(() => {
      if (settled) {
        return
      }
      settled = true
      dispose()
      reject(new Error(`pi-subagents RPC ${method} did not respond.`))
    }, timeoutMs)
    events.emit(rpcRequestEvent, {
      version: 1,
      requestId,
      method,
      params,
      source: { extension: '@nothingrotf/task' },
    })
  })
}

export function decodeRpcLaunch<Input>(value: Input): { runId: string; asyncDir?: string } | null {
  let data: Static<typeof RpcLaunchDataSchema>
  try {
    data = Value.Decode(RpcLaunchDataSchema, value)
  } catch {
    return null
  }
  const runId = data.details.runId ?? data.details.asyncId
  if (runId === undefined) {
    return null
  }
  if (data.details.asyncDir === undefined) {
    return { runId }
  }
  return { runId, asyncDir: data.details.asyncDir }
}

export function decodeAsyncCompletion<Input>(value: Input): AsyncCompletion | null {
  try {
    return Value.Decode(AsyncCompletionSchema, value)
  } catch {
    return null
  }
}

export function completionRunId(value: AsyncCompletion): string | undefined {
  return value.runId ?? value.id
}

export function completionOutcome(value: AsyncCompletion): CompletionOutcome | null {
  const runId = completionRunId(value)
  if (runId === undefined) {
    return null
  }
  const child = value.results?.at(0)
  const aborted =
    value.interrupted === true ||
    value.stopped === true ||
    value.state === 'stopped' ||
    child?.interrupted === true ||
    child?.stopped === true ||
    child?.state === 'stopped' ||
    child?.status === 'stopped'
  if (aborted) {
    return {
      kind: 'aborted',
      runId,
      error: child?.error ?? child?.output ?? value.summary ?? 'Task child was aborted.',
    }
  }
  const success = child?.success ?? value.success ?? value.state === 'complete'
  if (!success) {
    return {
      kind: 'error',
      runId,
      error:
        child?.error ?? value.summary ?? `Task child ended with state ${value.state ?? 'failed'}.`,
    }
  }
  const completed: {
    kind: 'completed'
    runId: string
    finalMessage: string
    toolCallCount: number
    durationMs: number
  } = {
    kind: 'completed',
    runId,
    finalMessage: child?.output ?? value.summary ?? '',
    toolCallCount: child?.toolBudget?.toolCount ?? 0,
    durationMs: value.durationMs ?? 0,
  }
  if (child?.model !== undefined && child.transcriptPath !== undefined) {
    return { ...completed, model: child.model, transcriptPath: child.transcriptPath }
  }
  if (child?.model !== undefined) {
    return { ...completed, model: child.model }
  }
  if (child?.transcriptPath !== undefined) {
    return { ...completed, transcriptPath: child.transcriptPath }
  }
  return completed
}

export function waitForCompletion(
  events: TaskEventBus,
  runId: string,
  signal: AbortSignal | undefined,
  stop: () => Promise<unknown>,
): Promise<CompletionOutcome> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: CompletionOutcome) => {
      if (settled) {
        return
      }
      settled = true
      dispose()
      signal?.removeEventListener('abort', cancel)
      resolve(outcome)
    }
    const cancel = () => {
      stop().catch(() => undefined)
      finish({ kind: 'error', runId, error: 'Task was aborted by the user.' })
    }
    const dispose = subscription(
      events.on(asyncCompleteEvent, (data) => {
        const value = decodeAsyncCompletion(data)
        if (value === null || completionRunId(value) !== runId) {
          return
        }
        const outcome = completionOutcome(value)
        if (outcome !== null) {
          finish(outcome)
        }
      }),
    )
    if (signal?.aborted === true) {
      cancel()
      return
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}
