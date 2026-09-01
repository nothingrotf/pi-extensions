import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { SubagentResolver, type SubagentDefinition } from './agents.ts'
import {
  ChildSessionError,
  createChildModelRuntime,
  createChildSession,
  syncChildProviders,
} from './child.ts'
import { resolveInvocationCwd, resolveTools } from './execution.ts'
import { activitySnippet, describeCall } from './format.ts'
import { ParentSideTurnError, recordAutomaticReply, runParentSideTurn } from './intercom.ts'
import { resolveModel, resolveStoredModel, type ResolvedModel } from './model.ts'
import { isBuiltInRole, loadRolePrompt, resolveRole, type RoleDefinition } from './roles.ts'
import type { Effort, ExecutionContract, RunRecord, RunUsage, TaskInput } from './schema.ts'
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
  intercomController: AbortController
  intercomUsage: RunUsage
  handle: SubagentHandle
  lastActivity: string | undefined
  messages: AssistantMessage[]
  pendingQuestion: ReturnType<typeof runParentSideTurn> | undefined
  metrics: RunMetrics
  session: AgentSession
  startedAt: number
}

export interface SubagentHandle {
  agentId: string
  ownerGeneration: number
  ownerSessionId: string
  runGeneration: number
}

export interface SubagentSnapshot {
  agentId: string
  description: string
  effort: Effort
  endedAt: number | undefined
  error: string | undefined
  intercomUsage: RunUsage
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

export interface TaskReceipt {
  background: true
  createdAt: number
  handle: SubagentHandle
  revision: number
  status: 'running'
  transcriptPath: string
}

export interface SteerReceipt {
  handle?: SubagentHandle
  queuedAt?: number
  reason?: 'empty' | 'invalid-owner' | 'not-active' | 'stale-handle' | 'terminal'
  revision: number
  status: 'queued' | 'rejected'
}

export interface CancelReceipt {
  handle?: SubagentHandle
  revision: number
  status: 'requested' | 'not-found' | 'stale-handle' | 'already-terminal'
}

export interface SubagentResult {
  agentId: string
  error: string | undefined
  intercomUsage: RunUsage
  model: string
  output: string | undefined
  status: Exclude<RunRecord['status'], 'running'>
  transcriptPath: string
  usage: RunUsage
}

export type SubagentEvent =
  | { receipt: TaskReceipt; revision: number; type: 'created' }
  | { handle: SubagentHandle; revision: number; snapshot: SubagentSnapshot; type: 'updated' }
  | { handle: SubagentHandle; result: SubagentResult; revision: number; type: 'terminal' }
  | { ownerGeneration: number; ownerSessionId: string; revision: number; type: 'owner-invalidated' }

export interface SubagentInvocation {
  ctx: ExtensionContext
  input: TaskInput
  signal?: AbortSignal
}

export interface SubagentController {
  cancel(handle: SubagentHandle): Promise<CancelReceipt>
  invalidateAgentCache(): void
  registerAgents(sourceId: string, definitions: readonly SubagentDefinition[]): () => void
  result(handle: SubagentHandle): SubagentResult | undefined
  snapshot(handle: SubagentHandle): SubagentSnapshot | undefined
  start(invocation: SubagentInvocation): Promise<TaskReceipt>
  steer(handle: SubagentHandle, message: string): Promise<SteerReceipt>
  subscribe(ownerSessionId: string, listener: (event: SubagentEvent) => void): () => void
  wait(handle: SubagentHandle, signal?: AbortSignal): Promise<SubagentResult>
}

interface ResolvedExecution {
  contract: ExecutionContract
  model: ResolvedModel
  role: RoleDefinition
}

export interface RuntimeCompletedDetails {
  agentId: string
  durationMs: number
  effort: Effort
  fast: boolean
  finalMessage: string
  intercomUsage: RunUsage
  model: string
  status: 'completed'
  toolCallCount: number
  transcriptPath: string
  usage: RunUsage
}

export interface RuntimeBackgroundResult {
  details: {
    agentId: string
    createdAt: number
    effort: Effort
    fast: boolean
    handle: SubagentHandle
    model: string
    status: 'background'
    transcriptPath: string
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
  retainBackgroundSignal?: boolean
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

function addUsage(left: RunUsage, right: RunUsage): RunUsage {
  return {
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: left.cost + right.cost,
    durationMs: left.durationMs + right.durationMs,
    input: left.input + right.input,
    output: left.output + right.output,
    toolCalls: left.toolCalls + right.toolCalls,
    turns: left.turns + right.turns,
  }
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
  private ownerGeneration = 0
  private revision = 0
  private runGeneration = 0
  private readonly resolver = new SubagentResolver()
  private readonly state: StateStore

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly runTimeoutMs = DEFAULT_RUN_TIMEOUT_MS,
  ) {
    this.state = new StateStore(pi)
  }

  restore(ctx: Pick<ExtensionContext, 'sessionManager'>): void {
    if (this.active.size === 0) this.modelRuntimePromise = undefined
    this.ownerGeneration += 1
    this.state.restore(ctx)
    this.emitChange()
  }

  invalidateHandles(): void {
    this.ownerGeneration += 1
    this.emitChange()
  }

  registerAgents(sourceId: string, definitions: readonly SubagentDefinition[]): () => void {
    return this.resolver.register(sourceId, definitions)
  }

  invalidateAgentCache(): void {
    this.resolver.invalidateCache()
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
          intercomUsage: active?.intercomUsage ?? record.intercomUsage ?? emptyUsage(0),
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

  get currentRevision(): number {
    return this.revision
  }

  get currentOwnerGeneration(): number {
    return this.ownerGeneration
  }

  get ownerSessionId(): string {
    return this.state.owner
  }

  handle(agentId: string): SubagentHandle | undefined {
    return this.active.get(agentId)?.handle
  }

  snapshotFor(handle: SubagentHandle): SubagentSnapshot | undefined {
    if (!this.matchesHandle(handle)) return undefined
    return this.listSnapshots().find((snapshot) => snapshot.agentId === handle.agentId)
  }

  resultFor(handle: SubagentHandle): SubagentResult | undefined {
    if (
      handle.ownerSessionId !== this.state.owner ||
      handle.ownerGeneration !== this.ownerGeneration
    )
      return undefined
    const active = this.active.get(handle.agentId)
    if (active !== undefined && active.handle.runGeneration !== handle.runGeneration)
      return undefined
    const record = this.state.get(handle.agentId)
    if (
      record === undefined ||
      record.status === 'running' ||
      record.runGeneration !== handle.runGeneration
    )
      return undefined
    return this.recordResult(record)
  }

  async waitFor(handle: SubagentHandle, signal?: AbortSignal): Promise<SubagentResult> {
    if (!this.matchesHandle(handle)) {
      const terminal = this.resultFor(handle)
      if (terminal !== undefined) return terminal
      throw new Error('The subagent handle is stale.')
    }
    const completion = this.active.get(handle.agentId)?.completion
    if (completion === undefined) throw new Error('The subagent completion is unavailable.')
    if (signal === undefined) await completion
    else {
      if (signal.aborted) throw new Error('The wait was aborted.')
      await Promise.race([
        completion,
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('The wait was aborted.')), {
            once: true,
          })
        }),
      ])
    }
    const result = this.resultFor(handle)
    if (result === undefined) throw new Error('The subagent result is unavailable.')
    return result
  }

  async steer(handle: SubagentHandle, message: string): Promise<SteerReceipt> {
    const text = message.trim()
    if (text.length === 0) return { reason: 'empty', revision: this.revision, status: 'rejected' }
    if (handle.ownerSessionId !== this.state.owner) {
      return { reason: 'invalid-owner', revision: this.revision, status: 'rejected' }
    }
    if (handle.ownerGeneration !== this.ownerGeneration) {
      return { reason: 'stale-handle', revision: this.revision, status: 'rejected' }
    }
    const active = this.active.get(handle.agentId)
    if (active === undefined) {
      const reason = this.state.get(handle.agentId) === undefined ? 'not-active' : 'terminal'
      return { reason, revision: this.revision, status: 'rejected' }
    }
    if (!this.matchesHandle(handle)) {
      return { reason: 'stale-handle', revision: this.revision, status: 'rejected' }
    }
    if (!active.session.isStreaming) {
      return { reason: 'not-active', revision: this.revision, status: 'rejected' }
    }
    try {
      await active.session.steer(text)
    } catch {
      return { reason: 'not-active', revision: this.revision, status: 'rejected' }
    }
    if (!this.matchesHandle(handle)) {
      return { reason: 'stale-handle', revision: this.revision, status: 'rejected' }
    }
    this.emitChange()
    return {
      handle: { ...handle },
      queuedAt: Date.now(),
      revision: this.revision,
      status: 'queued',
    }
  }

  requestCancel(agentId: string): boolean {
    const active = this.active.get(agentId)
    if (active === undefined) return false
    active.abortReason = 'The child was canceled from the subagent pane.'
    active.intercomController.abort(active.abortReason)
    active.abortPromise ??= active.session.abort().catch((error) => {
      active.abortReason = errorMessage(error)
    })
    return true
  }

  async cancel(agentId: string): Promise<boolean> {
    const active = this.active.get(agentId)
    if (active === undefined || !this.requestCancel(agentId)) return false
    if (active.abortPromise !== undefined) await active.abortPromise
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
      active.intercomController.abort(reason)
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
    const runtime = await this.getModelRuntime(options.ctx)
    const execution = await this.resolveExecution(options.ctx, input, prior, runtime)
    const model = execution.model
    const contract = execution.contract

    const session = await createChildSession({
      ctx: options.ctx,
      cwd: contract.cwd,
      description,
      intercom: {
        askParent: (agentId, question) =>
          this.askParent(options.ctx, runtime, agentId, description, question),
        notifyParent: (agentId, message, level) => this.notifyParent(agentId, message, level),
        updateProgress: (agentId, phase, note) => this.updateProgress(agentId, phase, note),
      },
      model,
      resumeFile: prior?.sessionFile,
      runtime,
      systemPrompt: contract.systemPrompt,
      tools: contract.tools,
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
    this.runGeneration += 1
    const record: RunRecord = {
      agentId: session.sessionId,
      background,
      createdAt: prior?.createdAt ?? now,
      description,
      effort: model.effort,
      execution: contract,
      fast: model.fast,
      model: model.modelRef,
      modelSelector: model.selector,
      ownerSessionId: this.state.owner,
      readonly: contract.readonly,
      runGeneration: this.runGeneration,
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

    const handle: SubagentHandle = {
      agentId: record.agentId,
      ownerGeneration: this.ownerGeneration,
      ownerSessionId: this.state.owner,
      runGeneration: this.runGeneration,
    }
    const active: ActiveRun = {
      abortPromise: undefined,
      abortReason: undefined,
      completion: undefined,
      cwd: contract.cwd,
      intercomController: new AbortController(),
      handle,
      intercomUsage: emptyUsage(0),
      lastActivity: 'Starting',
      messages: [],
      metrics: { toolCalls: 0, turns: 0 },
      pendingQuestion: undefined,
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
      background && options.retainBackgroundSignal !== true ? undefined : options.signal,
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
        createdAt: record.createdAt,
        effort: model.effort,
        fast: model.fast,
        handle: { ...handle },
        model: model.modelRef,
        status: 'background',
        transcriptPath: record.sessionFile,
      },
      kind: 'background',
    }
  }

  private async resolveExecution(
    ctx: ExtensionContext,
    input: TaskInput,
    prior: RunRecord | undefined,
    runtime: Awaited<ReturnType<typeof createChildModelRuntime>>,
  ): Promise<ResolvedExecution> {
    if (prior?.execution !== undefined) {
      const contract = prior.execution
      const persistedCwd = await resolveInvocationCwd(ctx.cwd, contract.cwd)
      if (persistedCwd !== contract.cwd) {
        throw new Error('The persisted Task cwd no longer resolves to its original directory.')
      }
      if (input.cwd !== undefined) {
        const cwd = await resolveInvocationCwd(ctx.cwd, input.cwd)
        if (cwd !== contract.cwd) throw new Error('A resumed Task must preserve the original cwd.')
      }
      if (input.tools !== undefined) {
        const tools = resolveTools(
          { name: contract.agentName, tools: contract.tools },
          input.tools,
          contract.readonly,
        )
        if (
          tools.length !== contract.tools.length ||
          tools.some((name, index) => contract.tools[index] !== name)
        ) {
          throw new Error('A resumed Task must preserve the original tool policy.')
        }
      }
      const role: RoleDefinition = {
        effort: contract.effort,
        model: contract.modelSelector,
        name: contract.agentName,
        tools: contract.tools,
      }
      const model =
        input.model === undefined
          ? resolveStoredModel(prior.model, prior.effort, prior.fast, runtime)
          : resolveModel(input.model, role, ctx, runtime)
      this.validateResumeSelection(prior, model)
      return { contract, model, role }
    }

    if (prior !== undefined) {
      throw new Error('A legacy Task record cannot resume without a persisted execution contract.')
    }

    const cwd = await resolveInvocationCwd(ctx.cwd, input.cwd)
    const discovered = await this.resolver.resolve(input.subagent_type, cwd)
    if (discovered === undefined && !isBuiltInRole(input.subagent_type)) {
      throw new Error(`Subagent type "${input.subagent_type}" does not exist.`)
    }
    const readonly = input.readonly ?? discovered?.readonly ?? false
    let role: RoleDefinition
    if (discovered === undefined) role = resolveRole(input.subagent_type, readonly)
    else {
      role = {
        effort: discovered.effort,
        name: discovered.name,
        tools: discovered.tools,
      }
      if (discovered.model !== undefined) role.model = discovered.model
    }
    const systemPrompt =
      discovered === undefined ? await loadRolePrompt(role) : discovered.systemPrompt
    const selector = input.model ?? role.model
    const model = resolveModel(selector, role, ctx, runtime)
    const tools = resolveTools(role, input.tools, readonly)
    return {
      contract: {
        agentDescription: discovered?.description ?? input.subagent_type,
        agentName: discovered?.name ?? input.subagent_type,
        agentSource: discovered?.source ?? { kind: 'bundled' },
        cwd,
        effort: model.effort,
        fast: model.fast,
        model: model.modelRef,
        modelSelector: model.selector,
        readonly,
        systemPrompt,
        tools,
        version: 1,
      },
      model,
      role,
    }
  }

  private resolveResume(input: TaskInput): RunRecord {
    const agentId = input.resume?.trim()
    if (agentId === undefined || agentId.length === 0) {
      throw new Error('The resume Agent ID is missing.')
    }
    const record = this.state.get(agentId)
    if (record === undefined || record.ownerSessionId !== this.state.owner) {
      throw new Error('The requested Agent ID does not belong to the current parent session.')
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
    if (record.effort !== model.effort) {
      throw new Error('A resumed Task must preserve the original effort.')
    }
    if (record.fast !== model.fast) {
      throw new Error('A resumed Task must preserve the original fast mode.')
    }
  }

  private async askParent(
    ctx: ExtensionContext,
    runtime: Awaited<ReturnType<typeof createChildModelRuntime>>,
    agentId: string,
    description: string,
    question: string,
  ): Promise<string> {
    const active = this.active.get(agentId)
    if (active === undefined) throw new Error(`Agent ID "${agentId}" is not active.`)
    if (active.pendingQuestion !== undefined) {
      throw new Error('The child already has a parent-model question in progress.')
    }
    active.lastActivity = 'Consulting parent model'
    this.emitChange()
    const pending = runParentSideTurn({
      agentId,
      ctx,
      description,
      question,
      runtime,
      signal: active.intercomController.signal,
    })
    active.pendingQuestion = pending
    try {
      const result = await pending
      active.intercomUsage = addUsage(active.intercomUsage, result.usage)
      recordAutomaticReply(this.pi, agentId, question, result.reply)
      return result.reply
    } catch (error) {
      if (error instanceof ParentSideTurnError) {
        active.intercomUsage = addUsage(active.intercomUsage, error.usage)
      }
      throw error
    } finally {
      active.pendingQuestion = undefined
      const current = this.active.get(agentId)
      if (current !== undefined) current.lastActivity = 'Applying parent guidance'
      this.emitChange()
    }
  }

  private notifyParent(
    agentId: string,
    message: string,
    level: 'info' | 'warning' | 'error',
  ): void {
    if (!this.active.has(agentId)) return
    this.pi.sendMessage(
      {
        content: [
          `<subagent-notice agent-id="${agentId}" level="${level}">`,
          message,
          '</subagent-notice>',
        ].join('\n'),
        customType: 'subagent-intercom',
        details: { agentId, kind: 'notification', level, message },
        display: true,
      },
      { deliverAs: 'followUp', triggerTurn: true },
    )
  }

  private updateProgress(agentId: string, phase: string, note: string | undefined): void {
    const active = this.active.get(agentId)
    if (active === undefined) return
    active.lastActivity =
      note === undefined || note.trim().length === 0 ? phase : `${phase} · ${note}`
    this.emitChange()
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
      active.intercomController.abort(active.abortReason)
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
          active.intercomController.abort(active.abortReason)
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
      if (active.abortReason !== undefined) throw new Error(active.abortReason)

      const text = finalText(active.messages)
      const output = truncateOutput(
        text.length === 0 ? 'The child completed without text output.' : text,
      )
      const durationMs = Date.now() - active.startedAt
      const usage = collectUsage(active.messages, active.metrics, durationMs)
      const failure = stopError(active.messages.at(-1))
      if (failure !== undefined) {
        const status = active.messages.at(-1)?.stopReason === 'aborted' ? 'aborted' : 'failed'
        return this.finishFailure(
          record,
          failure,
          status,
          durationMs,
          usage,
          output,
          active.intercomUsage,
        )
      }

      const completedRecord: RunRecord = {
        ...record,
        durationMs,
        intercomUsage: active.intercomUsage,
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
          intercomUsage: active.intercomUsage,
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
        active.intercomUsage,
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
    active.intercomController.abort('The child run ended.')
    active.session.dispose()
    this.emitChange()
  }

  private matchesHandle(handle: SubagentHandle): boolean {
    const active = this.active.get(handle.agentId)
    return (
      active !== undefined &&
      active.handle.ownerSessionId === handle.ownerSessionId &&
      active.handle.ownerGeneration === handle.ownerGeneration &&
      active.handle.runGeneration === handle.runGeneration
    )
  }

  private recordResult(record: RunRecord): SubagentResult {
    if (record.status === 'running') throw new Error('The subagent result is not terminal.')
    return {
      agentId: record.agentId,
      error: record.error,
      intercomUsage: { ...(record.intercomUsage ?? emptyUsage(0)) },
      model: record.model,
      output: record.output,
      status: record.status,
      transcriptPath: record.sessionFile,
      usage: { ...(record.usage ?? emptyUsage(record.durationMs ?? 0)) },
    }
  }

  private emitChange(): void {
    this.revision += 1
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
    intercomUsage: RunUsage,
  ): RuntimeFailedResult {
    let failedRecord: RunRecord = {
      ...record,
      durationMs,
      error,
      intercomUsage,
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
