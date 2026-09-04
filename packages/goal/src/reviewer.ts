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

async function createReviewModelRuntime(ctx: ExtensionContext): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  for (const providerId of ctx.modelRegistry.getRegisteredProviderIds()) {
    const nativeProvider = ctx.modelRegistry.getRegisteredNativeProvider(providerId)
    const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(providerId)
    if (nativeProvider !== undefined) runtime.registerNativeProvider(nativeProvider)
    else if (providerConfig !== undefined) runtime.registerProvider(providerId, providerConfig)
  }
  await runtime.refresh({ allowNetwork: false })
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
): Promise<{ model: string; session: AgentSession }> {
  const model = resolveReviewModel(ctx, state)
  const runtime = await createReviewModelRuntime(ctx)
  const settingsManager = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  })
  const loader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    appendSystemPrompt: [goalReviewerSystemPrompt],
    cwd: ctx.cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
  })
  await loader.reload()
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
  const created = await createAgentSession(options)
  if (created.modelFallbackMessage !== undefined) {
    created.session.dispose()
    throw new Error(created.modelFallbackMessage)
  }
  created.session.setSessionName(
    `Goal review ${state.loop.iteration + 1}/${state.loop.maxIterations}`,
  )
  return { model: modelName(model), session: created.session }
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

async function promptWithCancellation(
  session: AgentSession,
  prompt: string,
  images: ImageContent[] | undefined,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (signal.aborted) throw new GoalReviewAbortedError('Goal review was aborted.')
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortRequest: Promise<void> | undefined
  let rejectAbort: ((error: GoalReviewAbortedError) => void) | undefined
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const abort = () => {
    abortRequest = session.abort()
    abortRequest.catch(() => {})
    rejectAbort?.(new GoalReviewAbortedError('Goal review was aborted.'))
  }
  signal.addEventListener('abort', abort, { once: true })
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      abortRequest = session.abort()
      abortRequest.catch(() => {})
      reject(new Error(`Goal review exceeded ${timeoutMs} ms.`))
    }, timeoutMs)
  })
  try {
    const promptOptions: PromptOptions = {
      expandPromptTemplates: false,
      source: 'extension',
    }
    const request =
      images === undefined || images.length === 0
        ? session.prompt(prompt, promptOptions)
        : session.prompt(prompt, { ...promptOptions, images })
    await Promise.race([request, abortPromise, timeoutPromise])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    await settleAbort(abortRequest)
  }
}

export class FreshGoalReviewer implements GoalReviewer {
  #active: AgentSession | undefined
  #controller: AbortController | undefined

  constructor(private readonly timeoutMs = defaultReviewTimeoutMs) {}

  async review(request: GoalReviewRequest): Promise<GoalReviewOutcome> {
    if (this.#controller !== undefined) throw new Error('A goal review is already active.')
    const controller = new AbortController()
    this.#controller = controller
    const signal = AbortSignal.any([request.signal, controller.signal])
    let model = request.state.loop.reviewModel ?? 'inherit'
    let usage = emptyUsage()
    let report = ''
    let stopReason: AssistantMessage['stopReason'] | undefined
    let failure: string | undefined
    let session: AgentSession | undefined
    let unsubscribe: (() => void) | undefined
    try {
      if (signal.aborted) throw new GoalReviewAbortedError('Goal review was aborted.')
      const contract = await loadGoalContract(request.ctx.cwd, request.state.goal.objective)
      if (signal.aborted) throw new GoalReviewAbortedError('Goal review was aborted.')
      const created = await createReviewSession(request.ctx, request.state)
      session = created.session
      model = created.model
      this.#active = session
      unsubscribe = session.subscribe((event) => {
        if (event.type !== 'message_end' || event.message.role !== 'assistant') return
        usage = addUsage(usage, event.message)
        stopReason = event.message.stopReason
        failure = event.message.errorMessage
        const text = assistantText(event.message)
        if (text.length > 0) report = text
      })
      await promptWithCancellation(
        session,
        renderGoalReviewPrompt(request.state, request.checks, contract),
        request.images,
        signal,
        this.timeoutMs,
      )
      if (session.getSteeringMessages().length > 0) {
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
      if (error instanceof GoalReviewAbortedError || signal.aborted) {
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
