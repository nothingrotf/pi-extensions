import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  type AgentSession,
  type CreateAgentSessionOptions,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  type PromptOptions,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

import type { GoalProgressEvent } from './activity.ts'
import { loadGoalContract } from './contracts.ts'
import {
  decodeGoalReviewerOutput,
  goalReviewerSystemPrompt,
  renderGoalReviewPrompt,
} from './review-prompt.ts'
import type { GoalReviewOutcome } from './runtime.ts'
import type { GoalCheckResult, GoalModeState, GoalTokenUsage } from './state.ts'

const defaultReviewTimeoutMs = 10 * 60 * 1_000

export interface GoalReviewRequest {
  onProgress?: (event: GoalProgressEvent) => void
  checks: readonly GoalCheckResult[]
  ctx: ExtensionContext
  images?: ImageContent[]
  signal: AbortSignal
  state: GoalModeState
}

export interface GoalReviewer {
  cancel(reason?: string): Promise<void>
  review(request: GoalReviewRequest): Promise<GoalReviewOutcome>
  steer(message: string, images?: ImageContent[]): Promise<boolean>
}

export class GoalReviewAbortedError extends Error {
  constructor(
    message: string,
    readonly usage: GoalTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  ) {
    super(message)
  }
}

export class GoalReviewSteeringPendingError extends GoalReviewAbortedError {}

function emptyUsage(): GoalTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

function addUsage(total: GoalTokenUsage, message: AssistantMessage): GoalTokenUsage {
  return {
    input: total.input + message.usage.input,
    output: total.output + message.usage.output,
    cacheRead: total.cacheRead + message.usage.cacheRead,
    cacheWrite: total.cacheWrite + message.usage.cacheWrite,
  }
}

function assistantText(message: AssistantMessage): string {
  return message.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n')
    .trim()
}

function scopedRefresh<TContext extends { signal: AbortSignal }, TResult>(
  refresh: (context: TContext) => Promise<TResult>,
  signal: AbortSignal,
): { refresh: (context: TContext) => Promise<TResult>; completed: Promise<void> } {
  const completed = Promise.withResolvers<void>()
  let pending: Promise<TResult> | undefined
  return {
    completed: completed.promise,
    refresh: (context) => {
      signal.throwIfAborted()
      if (pending === undefined) {
        pending = Promise.resolve().then(() => {
          signal.throwIfAborted()
          return refresh({ ...context, signal })
        })
        completed.resolve(pending.then(() => {}))
      }
      return pending
    },
  }
}

async function createReviewModelRuntime(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, signal })
  signal.throwIfAborted()
  const refreshes: Promise<void>[] = []
  for (const providerId of ctx.modelRegistry.getRegisteredProviderIds()) {
    const nativeProvider = ctx.modelRegistry.getRegisteredNativeProvider(providerId)
    const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(providerId)
    if (nativeProvider !== undefined) {
      const provider = { ...nativeProvider }
      if (nativeProvider.refreshModels !== undefined) {
        const scoped = scopedRefresh(nativeProvider.refreshModels.bind(nativeProvider), signal)
        provider.refreshModels = scoped.refresh
        refreshes.push(scoped.completed)
      }
      runtime.registerNativeProvider(provider)
    } else if (providerConfig !== undefined) {
      const config = { ...providerConfig }
      if (providerConfig.refreshModels !== undefined) {
        const scoped = scopedRefresh(providerConfig.refreshModels.bind(providerConfig), signal)
        config.refreshModels = scoped.refresh
        refreshes.push(scoped.completed)
      }
      runtime.registerProvider(providerId, config)
    }
  }
  await withCancellation(
    () => Promise.all([runtime.refresh({ allowNetwork: false, signal }), ...refreshes]),
    signal,
  )
  signal.throwIfAborted()
  return runtime
}

function modelSelector(state: GoalModeState): string | undefined {
  if (state.loop.iteration >= 3 && state.loop.reviewFallbackModel !== undefined) {
    return state.loop.reviewFallbackModel
  }
  return state.loop.reviewModel
}

function resolveReviewModel(ctx: ExtensionContext, state: GoalModeState) {
  const selector = modelSelector(state)
  if (selector === undefined) {
    if (ctx.model === undefined) throw new Error('The parent session has no active model.')
    return ctx.model
  }
  const separator = selector.indexOf('/')
  if (separator <= 0 || separator === selector.length - 1) {
    throw new Error('The reviewer model must use provider/model-id syntax.')
  }
  const provider = selector.slice(0, separator)
  const modelId = selector.slice(separator + 1)
  const model = ctx.modelRegistry.find(provider, modelId)
  if (model === undefined) throw new Error(`Reviewer model "${selector}" is unavailable.`)
  return model
}

function modelName(model: ReturnType<typeof resolveReviewModel>): string {
  return `${model.provider}/${model.id}`
}

function createSessionManager(ctx: ExtensionContext): SessionManager {
  const parentSession = ctx.sessionManager.getSessionFile()
  return parentSession === undefined
    ? SessionManager.inMemory(ctx.cwd)
    : SessionManager.inMemory(ctx.cwd, { parentSession })
}

async function createReviewSession(
  ctx: ExtensionContext,
  state: GoalModeState,
  signal: AbortSignal,
): Promise<{ model: string; session: AgentSession }> {
  signal.throwIfAborted()
  const model = resolveReviewModel(ctx, state)
  const runtime = await createReviewModelRuntime(ctx, signal)
  signal.throwIfAborted()
  const settingsManager = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  })
  const loader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    appendSystemPrompt: [goalReviewerSystemPrompt],
    cwd: ctx.cwd,
    settingsManager: SettingsManager.inMemory({}, { projectTrusted: ctx.isProjectTrusted() }),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  await loader.reload()
  signal.throwIfAborted()
  const options: CreateAgentSessionOptions = {
    cwd: ctx.cwd,
    model,
    modelRuntime: runtime,
    resourceLoader: loader,
    sessionManager: createSessionManager(ctx),
    settingsManager,
    tools: ['read', 'grep', 'find', 'ls'],
  }
  if (ctx.thinkingLevel !== undefined) options.thinkingLevel = ctx.thinkingLevel
  signal.throwIfAborted()
  const created = await createAgentSession(options)
  try {
    signal.throwIfAborted()
    if (created.modelFallbackMessage !== undefined) throw new Error(created.modelFallbackMessage)
    created.session.setSessionName(
      `Goal review ${state.loop.iteration + 1}/${state.loop.maxIterations}`,
    )
    signal.throwIfAborted()
    return { model: modelName(model), session: created.session }
  } catch (error) {
    created.session.dispose()
    throw error
  }
}

function failedChecks(checks: readonly GoalCheckResult[]): GoalCheckResult[] {
  return checks.filter((check) => check.kind !== 'scope' && check.status === 'failed')
}

export function enforceAutomatedChecks(
  outcome: GoalReviewOutcome,
  checks: readonly GoalCheckResult[],
): GoalReviewOutcome {
  const failures = failedChecks(checks)
  if (failures.length === 0) {
    const missing = checks.filter(
      (check) =>
        check.status === 'unavailable' && (check.command !== undefined || check.kind === 'runtime'),
    )
    if (outcome.status !== 'PASS' || missing.length === 0) return outcome
    return {
      ...outcome,
      status: 'PARTIAL',
      reason: `Required verification is unavailable: ${missing.map((check) => check.label).join(', ')}.`,
      evidence: missing.map(
        (check) => `${check.command ?? check.label}: ${check.output ?? 'No result.'}`,
      ),
    }
  }
  const labels = failures.map((check) => check.label).join(', ')
  const evidence = failures.map((check) => {
    const command = check.command === undefined ? check.label : check.command
    const output = check.output === undefined ? '' : `: ${check.output.slice(-400)}`
    return `${command}${output}`
  })
  return {
    ...outcome,
    status: 'FAIL',
    reason: `Automated checks failed: ${labels}.`,
    evidence,
  }
}

async function settleAbort(request: Promise<void> | undefined): Promise<void> {
  if (request === undefined) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 1_000)
  })
  try {
    await Promise.race([request.catch(() => {}), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function withCancellation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  const aborted = Promise.withResolvers<never>()
  const abort = () => aborted.reject(signal.reason)
  signal.addEventListener('abort', abort, { once: true })
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted()
        return operation()
      }),
      aborted.promise,
    ])
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

async function promptWithCancellation(
  session: AgentSession,
  prompt: string,
  images: ImageContent[] | undefined,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted()
  let abortRequest: Promise<void> | undefined
  const abort = () => {
    abortRequest = session.abort()
    abortRequest.catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const promptOptions: PromptOptions = {
      expandPromptTemplates: false,
      source: 'extension',
      preflightResult: () => signal.throwIfAborted(),
    }
    await withCancellation(
      () =>
        images === undefined || images.length === 0
          ? session.prompt(prompt, promptOptions)
          : session.prompt(prompt, { ...promptOptions, images }),
      signal,
    )
    signal.throwIfAborted()
  } finally {
    signal.removeEventListener('abort', abort)
    await settleAbort(abortRequest)
  }
}

function emitProgress(onProgress: GoalReviewRequest['onProgress'], event: GoalProgressEvent): void {
  try {
    Promise.resolve(onProgress?.(event)).catch(() => {})
  } catch {}
}

function totalTokens(usage: GoalTokenUsage): number {
  return usage.input + usage.output + usage.cacheWrite
}

export class FreshGoalReviewer implements GoalReviewer {
  #active: AgentSession | undefined
  #controller: AbortController | undefined

  constructor(private readonly timeoutMs = defaultReviewTimeoutMs) {}

  async review(request: GoalReviewRequest): Promise<GoalReviewOutcome> {
    if (this.#controller !== undefined) throw new Error('A goal review is already active.')
    const controller = new AbortController()
    this.#controller = controller
    const cancellation = AbortSignal.any([request.signal, controller.signal])
    const deadline = new AbortController()
    const signal = AbortSignal.any([cancellation, deadline.signal])
    const timeout = setTimeout(
      () => deadline.abort(new Error(`Goal review exceeded ${this.timeoutMs} ms.`)),
      this.timeoutMs,
    )
    let model = request.state.loop.reviewModel ?? 'inherit'
    let usage = emptyUsage()
    let report = ''
    let stopReason: AssistantMessage['stopReason'] | undefined
    let failure: string | undefined
    let session: AgentSession | undefined
    let unsubscribe: (() => void) | undefined
    try {
      signal.throwIfAborted()
      emitProgress(request.onProgress, { type: 'reviewer', phase: 'starting-reviewer', tokens: 0 })
      const contract = await withCancellation(
        () => loadGoalContract(request.ctx.cwd, request.state.goal.objective),
        signal,
      )
      const created = await withCancellation(async () => {
        const result = await createReviewSession(request.ctx, request.state, signal)
        if (signal.aborted) {
          result.session.dispose()
          signal.throwIfAborted()
        }
        session = result.session
        return result
      }, signal)
      model = created.model
      this.#active = created.session
      let lastStreamingProgress = 0
      const activeTools = new Map<string, string>()
      const progress = (tokens: number) => {
        if (signal.aborted) return
        const event: GoalProgressEvent = { type: 'reviewer', phase: 'reviewing', model, tokens }
        const tool = activeTools.values().next().value
        if (tool !== undefined) event.tool = tool
        emitProgress(request.onProgress, event)
      }
      unsubscribe = created.session.subscribe((event) => {
        if (event.type === 'tool_execution_start' || event.type === 'tool_execution_end') {
          if (event.type === 'tool_execution_start')
            activeTools.set(event.toolCallId, event.toolName)
          else activeTools.delete(event.toolCallId)
          progress(totalTokens(usage))
          return
        }
        if (event.type === 'message_update' && event.message.role === 'assistant') {
          const now = Date.now()
          if (now - lastStreamingProgress >= 250) {
            lastStreamingProgress = now
            progress(totalTokens(addUsage(usage, event.message)))
          }
          return
        }
        if (event.type !== 'message_end' || event.message.role !== 'assistant') return
        usage = addUsage(usage, event.message)
        stopReason = event.message.stopReason
        failure = event.message.errorMessage
        const text = assistantText(event.message)
        if (text.length > 0) report = text
        progress(totalTokens(usage))
      })
      progress(0)
      await promptWithCancellation(
        created.session,
        renderGoalReviewPrompt(request.state, request.checks, contract),
        request.images,
        signal,
      )
      if (created.session.getSteeringMessages().length > 0) {
        throw new GoalReviewSteeringPendingError('The reviewer has unread user steering.', usage)
      }
      if (stopReason !== 'stop')
        throw new Error(
          `The reviewer did not finish successfully (${failure ?? stopReason ?? 'no response'}).`,
        )
      const decoded = decodeGoalReviewerOutput(report)
      return enforceAutomatedChecks(
        {
          status: decoded.status,
          reason: decoded.reason,
          evidence: decoded.evidence,
          checks: request.checks,
          reviewerModel: model,
          report,
          usage,
        },
        request.checks,
      )
    } catch (error) {
      if (error instanceof GoalReviewSteeringPendingError) throw error
      if (error instanceof GoalReviewAbortedError || cancellation.aborted) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new GoalReviewAbortedError(reason, usage)
      }
      const reason = error instanceof Error ? error.message : String(error)
      return enforceAutomatedChecks(
        {
          status: 'PARTIAL',
          reason: `Independent review failed: ${reason}`,
          evidence: [],
          checks: request.checks,
          reviewerModel: model,
          report,
          usage,
        },
        request.checks,
      )
    } finally {
      clearTimeout(timeout)
      unsubscribe?.()
      session?.dispose()
      if (this.#active === session) this.#active = undefined
      if (this.#controller === controller) this.#controller = undefined
    }
  }

  async steer(message: string, images?: ImageContent[]): Promise<boolean> {
    const active = this.#active
    const text = message.trim()
    if (
      active === undefined ||
      !active.isStreaming ||
      (text.length === 0 && (images?.length ?? 0) === 0)
    )
      return false
    try {
      await active.steer(
        text.length === 0
          ? 'Inspect the user-provided review image.'
          : `User steering for this review:\n${text}`,
        images,
      )
      return true
    } catch {
      return false
    }
  }

  async cancel(): Promise<void> {
    this.#controller?.abort()
    await settleAbort(this.#active?.abort())
  }
}
