import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import {
  ChildSessionError,
  createChildModelRuntime,
  createChildSession,
  syncChildProviders,
} from './child.ts'
import { activitySnippet, describeCall } from './format.ts'
import { resolveModel, resolveStoredModel, type ResolvedModel } from './model.ts'
import { resolveRole } from './roles.ts'
import type { Effort, RunRecord, RunUsage, TaskInput } from './schema.ts'
import { StateStore } from './state.ts'

const MAX_OUTPUT_BYTES = 50 * 1024
export const DEFAULT_RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000

const ActivityArgumentSchema = Type.Object(
  {
    command: Type.Optional(Type.String()),
    file_path: Type.Optional(Type.String()),
    filePath: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    pattern: Type.Optional(Type.String()),
    query: Type.Optional(Type.String()),
    subject: Type.Optional(Type.String()),
    task: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

interface ActiveRun {
  abortPromise: Promise<void> | undefined
  abortReason: string | undefined
  completion: Promise<RuntimeTerminalResult> | undefined
  cwd: string
  lastActivity: string | undefined
  messages: AssistantMessage[]
  metrics: RunMetrics
  session: AgentSession
  startedAt: number
}

export interface SubagentSnapshot {
  agentId: string
  description: string
  effort: Effort
  endedAt: number | undefined
  error: string | undefined
  lastActivity: string | undefined
  model: string
  output: string | undefined
  readonly: boolean
  running: boolean
  sessionFile: string
  startedAt: number
  status: RunRecord['status']
  subagentType: RunRecord['subagentType']
  usage: RunUsage
}

export interface RuntimeCompletedDetails {
  agentId: string
  durationMs: number
  effort: Effort
  fast: boolean
  finalMessage: string
  model: string
  status: 'completed'
  toolCallCount: number
  transcriptPath: string
  usage: RunUsage
}

export interface RuntimeBackgroundResult {
  details: {
    agentId: string
    effort: Effort
    fast: boolean
    model: string
    status: 'background'
  }
  kind: 'background'
}

export interface RuntimeCompletedResult {
  content: string
  details: RuntimeCompletedDetails
  kind: 'completed'
}

export interface RuntimeFailedResult {
  details: { agentId: string; error: string; status: 'error' } | { error: string; status: 'error' }
  kind: 'failed'
  outcome: 'failed' | 'aborted'
}

export type RuntimeTerminalResult = RuntimeCompletedResult | RuntimeFailedResult
export type RuntimeResult = RuntimeBackgroundResult | RuntimeTerminalResult
export type RuntimeDetails = RuntimeResult['details']

interface StartOptions {
  ctx: ExtensionContext
  input: TaskInput
  signal: AbortSignal | undefined
}

interface RunMetrics {
  toolCalls: number
  turns: number
}

function emptyUsage(durationMs: number): RunUsage {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    durationMs,
    input: 0,
    output: 0,
    toolCalls: 0,
    turns: 0,
  }
}

function errorMessage<Input>(error: Input): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function textFromMessage(message: AssistantMessage): string {
  return message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
    .trim()
}

function finalText(messages: readonly AssistantMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined) continue
    const text = textFromMessage(message)
    if (text.length > 0) return text
  }
  return ''
}

function collectUsage(
  messages: readonly AssistantMessage[],
  metrics: RunMetrics,
  durationMs: number,
): RunUsage {
  const usage: RunUsage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    durationMs,
    input: 0,
    output: 0,
    toolCalls: metrics.toolCalls,
    turns: metrics.turns,
  }

  for (const message of messages) {
    usage.cacheRead += message.usage.cacheRead
    usage.cacheWrite += message.usage.cacheWrite
    usage.cost += message.usage.cost.total
    usage.input += message.usage.input
    usage.output += message.usage.output
  }
  return usage
}

export function truncateOutput(output: string): string {
  const encoded = new TextEncoder().encode(output)
  if (encoded.byteLength <= MAX_OUTPUT_BYTES) return output
  const suffix = '\n\n[Output truncated at 50 KiB.]'
  const suffixBytes = new TextEncoder().encode(suffix).byteLength
  let end = MAX_OUTPUT_BYTES - suffixBytes
  while (end > 0) {
    const byte = encoded[end]
    if (byte === undefined || (byte & 0xc0) !== 0x80) break
    end -= 1
  }
  const body = new TextDecoder().decode(encoded.slice(0, end))
  return `${body}${suffix}`
}

function actualModel(messages: readonly AssistantMessage[], fallback: string): string {
  const message = messages.at(-1)
  if (message === undefined) return fallback
  return `${message.provider}/${message.model}`
}

function stopError(message: AssistantMessage | undefined): string | undefined {
  if (message === undefined) return 'The child returned no assistant response.'
  if (message.stopReason === 'stop') return undefined
  if (message.stopReason === 'length') return 'The child reached its output token limit.'
  if (message.stopReason === 'aborted') return 'The child run was aborted.'
  if (message.stopReason === 'error') {
    return message.errorMessage ?? 'The child model returned an error.'
  }
  if (message.stopReason === 'deferred') return 'The child returned a deferred response.'
  return `The child stopped with reason "${message.stopReason}".`
}

export class SubagentRuntime {
  private readonly active = new Map<string, ActiveRun>()
  private readonly leases = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private modelRuntimePromise: ReturnType<typeof createChildModelRuntime> | undefined
  private readonly state: StateStore

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  ) {
    this.state = new StateStore(pi)
  }

  restore(ctx: ExtensionContext): void {
    if (this.active.size === 0) this.modelRuntimePromise = undefined
    this.state.restore(ctx)
    this.emitChange()
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasActiveRun(): boolean {
    return this.active.size > 0
  }

  listSnapshots(): SubagentSnapshot[] {
    return this.state
      .all()
      .map((record) => {
        const active = this.active.get(record.agentId)
        const durationMs =
          active === undefined ? (record.durationMs ?? 0) : Date.now() - active.startedAt
        const terminalStartedAt =
          record.durationMs === undefined
            ? record.createdAt
            : Math.max(record.createdAt, record.updatedAt - record.durationMs)
        return {
          agentId: record.agentId,
          description: record.description,
          effort: record.effort,
          endedAt:
            active === undefined && record.status !== 'running' ? record.updatedAt : undefined,
          error: record.error,
          lastActivity: active?.lastActivity,
          model: record.model,
          output: record.output,
          readonly: record.readonly,
          running: active !== undefined,
          sessionFile: record.sessionFile,
          startedAt: active?.startedAt ?? terminalStartedAt,
          status: active === undefined ? record.status : 'running',
          subagentType: record.subagentType,
          usage:
            active === undefined
              ? (record.usage ?? emptyUsage(durationMs))
              : collectUsage(active.messages, active.metrics, durationMs),
        }
      })
      .reverse()
  }

  async cancel(agentId: string): Promise<boolean> {
    const active = this.active.get(agentId)
    if (active === undefined) return false
    active.abortReason = 'The child was canceled from the subagent pane.'
    active.abortPromise ??= active.session.abort().catch((error) => {
      active.abortReason = errorMessage(error)
    })
    await active.abortPromise
    if (active.completion !== undefined) await active.completion
    return true
  }

  async run(options: StartOptions): Promise<RuntimeResult> {
    try {
      return await this.start(options)
    } catch (error) {
      if (error instanceof ChildSessionError) {
        return {
          details: { agentId: error.agentId, error: error.message, status: 'error' },
          kind: 'failed',
          outcome: 'failed',
        }
      }
      const resume = options.input.resume?.trim()
      const record = resume === undefined ? undefined : this.state.get(resume)
      if (record !== undefined && record.ownerSessionId === this.state.owner) {
        return {
          details: { agentId: record.agentId, error: errorMessage(error), status: 'error' },
          kind: 'failed',
          outcome: 'failed',
        }
      }
      return {
        details: { error: errorMessage(error), status: 'error' },
        kind: 'failed',
        outcome: 'failed',
      }
    }
  }

  async shutdown(reason = 'The parent session stopped.'): Promise<void> {
    const activeRuns = [...this.active.values()]
    for (const active of activeRuns) {
      active.abortReason = reason
      active.abortPromise ??= active.session.abort().catch((error) => {
        active.abortReason = `${reason} ${errorMessage(error)}`
      })
      await active.abortPromise
    }
    for (const active of activeRuns) {
      if (active.completion !== undefined) await active.completion
    }
  }

  private async start(options: StartOptions): Promise<RuntimeResult> {
    this.state.ensureOwner(options.ctx)
    const input = options.input
    const description = input.description.trim()
    const prompt = input.prompt.trim()
    if (description.length === 0) throw new Error('The Task description is empty.')
    if (prompt.length === 0) throw new Error('The Task prompt is empty.')
    const prior = input.resume === undefined ? undefined : this.resolveResume(input)
    if (prior === undefined) return this.startSession(options, description, prompt, undefined)

    this.leases.add(prior.agentId)
    try {
      return await this.startSession(options, description, prompt, prior)
    } catch (error) {
      this.leases.delete(prior.agentId)
      throw error
    }
  }

  private async startSession(
    options: StartOptions,
    description: string,
    prompt: string,
    prior: RunRecord | undefined,
  ): Promise<RuntimeResult> {
    const input = options.input
    const readonly = input.readonly ?? prior?.readonly ?? false
    const role = resolveRole(input.subagent_type, readonly)
    const runtime = await this.getModelRuntime(options.ctx)
    const selector = input.model ?? (prior === undefined ? role.model : undefined)
    const model =
      prior !== undefined && input.model === undefined
        ? resolveStoredModel(prior.model, prior.effort, prior.fast, runtime)
        : resolveModel(selector, role, options.ctx, runtime)
    if (prior !== undefined) this.validateResumeSelection(prior, model)

    const session = await createChildSession({
      ctx: options.ctx,
      description,
      model,
      resumeFile: prior?.sessionFile,
      role,
      runtime,
    })
    const sessionFile = session.sessionFile
    if (sessionFile === undefined) {
      const agentId = session.sessionId
      session.dispose()
      throw new ChildSessionError(
        'The child session did not create a persistent transcript.',
        agentId,
      )
    }
    if (prior !== undefined && session.sessionId !== prior.agentId) {
      session.dispose()
      throw new Error('The resumed transcript returned a different Agent ID.')
    }

    const now = Date.now()
    const background = input.run_in_background ?? false
    const record: RunRecord = {
      agentId: session.sessionId,
      background,
      createdAt: prior?.createdAt ?? now,
      description,
      effort: model.effort,
      fast: model.fast,
      model: model.modelRef,
      modelSelector: model.selector,
      ownerSessionId: this.state.owner,
      readonly,
      sessionFile,
      status: 'running',
      subagentType: input.subagent_type,
      updatedAt: now,
    }

    try {
      if (prior === undefined) {
        this.state.add(record)
        this.leases.add(record.agentId)
      } else this.state.update(record)
    } catch (error) {
      const agentId = session.sessionId
      session.dispose()
      throw new ChildSessionError(errorMessage(error), agentId)
    }

    const active: ActiveRun = {
      abortPromise: undefined,
      abortReason: undefined,
      completion: undefined,
      cwd: options.ctx.cwd,
      lastActivity: 'Starting',
      messages: [],
      metrics: { toolCalls: 0, turns: 0 },
      session,
      startedAt: Date.now(),
    }
    this.active.set(record.agentId, active)
    this.emitChange()
    const turn = this.completeRun(
      record,
      model,
      prompt,
      active,
      background ? undefined : options.signal,
    )
    const completion = turn.then(
      (result) => this.finalizeRun(record, active, background, result),
      (error) =>
        this.finalizeRun(record, active, background, {
          details: { agentId: record.agentId, error: errorMessage(error), status: 'error' },
          kind: 'failed',
          outcome: 'failed',
        }),
    )
    active.completion = completion

    if (!background) return completion
    return {
      details: {
        agentId: record.agentId,
        effort: model.effort,
        fast: model.fast,
        model: model.modelRef,
        status: 'background',
      },
      kind: 'background',
    }
  }

  private resolveResume(input: TaskInput): RunRecord {
    const agentId = input.resume?.trim()
    if (agentId === undefined || agentId.length === 0) {
      throw new Error('The resume Agent ID is missing.')
    }
    const record = this.state.get(agentId)
    if (record === undefined || record.ownerSessionId !== this.state.owner) {
      throw new Error(`Agent ID "${agentId}" does not belong to the current parent session.`)
    }
    if (this.leases.has(agentId) || this.active.has(agentId) || record.status === 'running') {
      throw new Error(`Agent ID "${agentId}" already has an active run.`)
    }
    if (record.subagentType !== input.subagent_type) {
      throw new Error('A resumed Task must use the original subagent_type.')
    }
    if (input.readonly !== undefined && record.readonly !== input.readonly) {
      throw new Error('A resumed Task must preserve the original readonly policy.')
    }
    return record
  }

  private validateResumeSelection(record: RunRecord, model: ResolvedModel): void {
    if (record.model !== model.modelRef) {
      throw new Error('A resumed Task must preserve the original model.')
    }
  }

  private async getModelRuntime(ctx: ExtensionContext) {
    this.modelRuntimePromise ??= createChildModelRuntime(ctx)
    const runtime = await this.modelRuntimePromise
    syncChildProviders(ctx, runtime)
    return runtime
  }

  private async completeRun(
    record: RunRecord,
    model: ResolvedModel,
    prompt: string,
    active: ActiveRun,
    signal: AbortSignal | undefined,
  ): Promise<RuntimeTerminalResult> {
    const unsubscribe = active.session.subscribe((event) => {
      if (event.type === 'turn_start') {
        active.metrics.turns += 1
        active.lastActivity = 'Thinking'
      }
      if (event.type === 'tool_execution_start') {
        active.metrics.toolCalls += 1
        active.lastActivity = Value.Check(ActivityArgumentSchema, event.args)
          ? describeCall(
              event.toolName,
              Value.Decode(ActivityArgumentSchema, event.args),
              active.cwd,
            )
          : event.toolName.charAt(0).toUpperCase() + event.toolName.slice(1)
      }
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        active.messages.push(event.message)
        const text = textFromMessage(event.message)
        active.lastActivity = text.length === 0 ? 'Responding' : activitySnippet(text)
      }
      this.emitChange()
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    const abortFromSignal = () => {
      active.abortReason = 'The parent Task call was aborted.'
      active.abortPromise ??= active.session.abort().catch((error) => {
        active.abortReason = errorMessage(error)
      })
    }

    if (signal?.aborted === true) abortFromSignal()
    else signal?.addEventListener('abort', abortFromSignal, { once: true })

    try {
      if (active.abortReason !== undefined) throw new Error(active.abortReason)

      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          active.abortReason = 'The child exceeded the six-hour runtime limit.'
          active.abortPromise ??= active.session.abort().catch((error) => {
            active.abortReason = errorMessage(error)
          })
          reject(new Error(active.abortReason))
        }, this.runTimeoutMs)
      })
      await Promise.race([
        active.session.prompt(prompt, { expandPromptTemplates: false }),
        timeoutPromise,
      ])

      const text = finalText(active.messages)
      const output = truncateOutput(
        text.length === 0 ? 'The child completed without text output.' : text,
      )
      const durationMs = Date.now() - active.startedAt
      const usage = collectUsage(active.messages, active.metrics, durationMs)
      const failure = stopError(active.messages.at(-1))
      if (failure !== undefined) {
        const status = active.messages.at(-1)?.stopReason === 'aborted' ? 'aborted' : 'failed'
        return this.finishFailure(record, failure, status, durationMs, usage, output)
      }

      const completedRecord: RunRecord = {
        ...record,
        durationMs,
        output,
        status: 'completed',
        updatedAt: Date.now(),
        usage,
      }
      this.state.update(completedRecord)
      return {
        content: output,
        details: {
          agentId: record.agentId,
          durationMs,
          effort: model.effort,
          fast: model.fast,
          finalMessage: output,
          model: actualModel(active.messages, model.modelRef),
          status: 'completed',
          toolCallCount: active.metrics.toolCalls,
          transcriptPath: record.sessionFile,
          usage,
        },
        kind: 'completed',
      }
    } catch (error) {
      if (active.abortPromise !== undefined) await active.abortPromise
      const output = truncateOutput(finalText(active.messages))
      const durationMs = Date.now() - active.startedAt
      const usage = collectUsage(active.messages, active.metrics, durationMs)
      const status = active.abortReason === undefined ? 'failed' : 'aborted'
      return this.finishFailure(
        record,
        active.abortReason ?? errorMessage(error),
        status,
        durationMs,
        usage,
        output,
      )
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      signal?.removeEventListener('abort', abortFromSignal)
      unsubscribe()
    }
  }

  private finalizeRun(
    record: RunRecord,
    active: ActiveRun,
    background: boolean,
    result: RuntimeTerminalResult,
  ): RuntimeTerminalResult {
    if (background) {
      try {
        this.notify(record, result)
      } catch (error) {
        this.cleanupRun(record, active)
        return {
          details: {
            agentId: record.agentId,
            error: `The background notification failed: ${errorMessage(error)}`,
            status: 'error',
          },
          kind: 'failed',
          outcome: 'failed',
        }
      }
    }
    this.cleanupRun(record, active)
    return result
  }

  private cleanupRun(record: RunRecord, active: ActiveRun): void {
    this.active.delete(record.agentId)
    this.leases.delete(record.agentId)
    active.session.dispose()
    this.emitChange()
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {}
    }
  }

  private finishFailure(
    record: RunRecord,
    error: string,
    status: 'failed' | 'aborted',
    durationMs: number,
    usage: RunUsage,
    output: string,
  ): RuntimeFailedResult {
    let failedRecord: RunRecord = {
      ...record,
      durationMs,
      error,
      status,
      updatedAt: Date.now(),
      usage,
    }
    if (output.length > 0) failedRecord = { ...failedRecord, output }
    this.state.update(failedRecord)
    return {
      details: { agentId: record.agentId, error, status: 'error' },
      kind: 'failed',
      outcome: status,
    }
  }

  private notify(record: RunRecord, result: RuntimeTerminalResult): void {
    const status =
      result.kind === 'completed' ? 'success' : result.outcome === 'aborted' ? 'aborted' : 'error'
    const detail = result.kind === 'completed' ? result.content : result.details.error
    const notification = {
      detail,
      kind: 'subagent',
      status,
      taskId: record.agentId,
      title: record.description,
    }
    this.pi.sendMessage(
      {
        content: `Task notification: ${JSON.stringify(notification)}`,
        customType: 'system/task_notification',
        details: notification,
        display: false,
      },
      { deliverAs: 'followUp', triggerTurn: true },
    )
  }
}
