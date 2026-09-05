import { randomUUID } from 'node:crypto'

import type { ImageContent } from '@earendil-works/pi-ai'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'
import { type Component, Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import {
  GoalActivitySchema,
  GoalActivityTracker,
  type GoalActivity,
  type GoalProgressEvent,
} from './activity.ts'
import { type GoalCheckRunner, ProjectGoalCheckRunner } from './checks.ts'
import {
  goalSubcommands,
  parseBudgetInput,
  parseGoalStartOptions,
  parseGoalSubcommand,
  parseToggle,
} from './commands.ts'
import { isLoopActive } from './loop-activity.ts'
import { GoalOverlay } from './overlay.ts'
import { goalToolDescription, renderGuidedGoalInterview } from './prompts.ts'
import {
  enforceAutomatedChecks,
  FreshGoalReviewer,
  GoalReviewAbortedError,
  GoalReviewSteeringPendingError,
  type GoalReviewer,
} from './reviewer.ts'
import {
  type GoalCreateInput,
  type GoalReviewOutcome,
  completionBudgetReport,
  GoalRuntime,
  GoalRuntimeError,
} from './runtime.ts'
import {
  cloneGoalState,
  decodeGoalModeEntry,
  encodeGoalModeEntry,
  type Goal,
  GoalLoopStateSchema,
  type GoalModeState,
  type GoalPersistMode,
  GoalSchema,
  type GoalTokenUsage,
  isAccountingStatus,
  MAX_GOAL_ITERATIONS,
  remainingTokens,
  restoreGoalModeState,
} from './state.ts'
import { readTodosFromBranch, renderTodoContext, todoWriteToolName } from './todo-context.ts'

const modeEntryType = 'pi-goal-mode'
const completedEntryType = 'pi-goal-completed'
const reviewEntryType = 'pi-goal-review'
const statusKey = 'pi-goal'
const toolName = 'goal'
const continuationDelayMs = 800

export const GOAL_ACTIVITY_EVENT = '@nothingrotf/goal/activity'
export const GOAL_REVIEW_START_EVENT = '@nothingrotf/goal/review-start'
export const GOAL_REVIEW_VERDICT_EVENT = '@nothingrotf/goal/review-verdict'
export const GOAL_REVIEW_STOP_EVENT = '@nothingrotf/goal/review-stop'

const goalToolParameters = Type.Object(
  {
    op: Type.Union([
      Type.Literal('create'),
      Type.Literal('get'),
      Type.Literal('complete'),
      Type.Literal('resume'),
      Type.Literal('drop'),
    ]),
    objective: Type.Optional(Type.String()),
    token_budget: Type.Optional(Type.Integer()),
    max_iterations: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_GOAL_ITERATIONS })),
    review_model: Type.Optional(Type.String({ minLength: 3 })),
    review_fallback_model: Type.Optional(Type.String({ minLength: 3 })),
    runtime_probe: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

const GoalToolDetailsSchema = Type.Object({
  op: Type.Union([
    Type.Literal('create'),
    Type.Literal('get'),
    Type.Literal('complete'),
    Type.Literal('resume'),
    Type.Literal('drop'),
  ]),
  goal: Type.Union([GoalSchema, Type.Null()]),
  loop: Type.Union([GoalLoopStateSchema, Type.Null()]),
  remainingTokens: Type.Union([Type.Number(), Type.Null()]),
  completionBudgetReport: Type.Union([Type.String(), Type.Null()]),
  activity: Type.Optional(GoalActivitySchema),
})

type GoalToolDetails = Static<typeof GoalToolDetailsSchema>

function decodeGoalToolDetails<Input>(value: Input): GoalToolDetails | null {
  try {
    return Value.Decode(GoalToolDetailsSchema, value)
  } catch {
    return null
  }
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

function formatTokens(value: number): string {
  return value.toLocaleString('en-US')
}

function addTokenUsage(left: GoalTokenUsage, right: GoalTokenUsage): GoalTokenUsage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
  }
}

function describeTool(details: GoalToolDetails): string {
  const goal = details.goal
  if (goal === null) return 'No active goal.'
  const phase =
    goal.status === 'active' || goal.status === 'budget-limited'
      ? (details.activity?.phase ?? details.loop?.phase ?? goal.status)
      : goal.status
  let text = `Goal: ${goal.objective}\nStatus: ${phase}\nTokens: ${goal.tokensUsed} used`
  if (goal.tokenBudget !== undefined) text += ` / ${goal.tokenBudget} budget`
  const remaining = remainingTokens(goal)
  if (remaining !== null) text += `\nRemaining tokens: ${remaining}`
  if (details.loop !== null) {
    text += `\nReviews: ${details.loop.iteration}/${details.loop.maxIterations}`
    const verdict = details.loop.verdictHistory.at(-1)
    if (verdict !== undefined) text += `\nLast verdict: ${verdict.status}: ${verdict.reason}`
    if (details.op === 'complete') {
      text += '\nIndependent completion review requested for the end of this turn.'
    }
  }
  if (details.activity !== undefined) {
    text += `\nActivity: ${details.activity.detail}`
    for (const check of details.activity.checks) text += `\n${check.label}: ${check.status}`
    if (details.activity.model !== undefined) text += `\nReviewer: ${details.activity.model}`
    if (details.activity.tool !== undefined) text += `\nReviewer tool: ${details.activity.tool}`
  }
  if (details.completionBudgetReport !== null) {
    text += `\n\n${details.completionBudgetReport}`
  }
  return text
}

function goalDetails(state: GoalModeState, activity?: GoalActivity): string {
  const goal = state.goal
  const used = formatTokens(goal.tokensUsed)
  const budgetLine =
    goal.tokenBudget !== undefined
      ? `${used} / ${formatTokens(goal.tokenBudget)} (${formatTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed))} left)`
      : `${used} (no budget)`
  const lines = [
    `Objective: ${goal.objective}`,
    `Status: ${state.enabled ? (activity?.phase ?? state.loop.phase) : goal.status}`,
    `Reviews: ${state.loop.iteration} / ${state.loop.maxIterations}`,
    `Tokens: ${budgetLine}`,
    `Time spent: ${formatDuration(goal.timeUsedSeconds * 1000)}`,
    `Reviewer: ${state.loop.reviewModel ?? 'inherit'}`,
    `Runtime probe: ${state.loop.runtimeProbe ? 'on' : 'off'}`,
  ]
  if (state.loop.verdictHistory.length > 0) {
    lines.push('Review history:')
    for (const [index, verdict] of state.loop.verdictHistory.entries()) {
      lines.push(`  ${index + 1}. ${verdict.status}: ${verdict.reason}`)
      if (verdict.checks.length > 0) {
        lines.push(
          `     Checks: ${verdict.checks.map((check) => `${check.label}=${check.status}`).join(', ')}`,
        )
      }
      for (const evidence of verdict.evidence.slice(0, 3)) lines.push(`     Evidence: ${evidence}`)
    }
  }
  if (state.loop.stopReason !== undefined) lines.push(`Stop reason: ${state.loop.stopReason}`)
  return lines.join('\n')
}

function describeOp(op: GoalToolDetails['op'] | undefined): string {
  switch (op) {
    case 'create':
      return 'set'
    case 'complete':
      return 'review'
    case 'get':
      return 'check'
    case 'resume':
      return 'resume'
    case 'drop':
      return 'drop'
    default:
      return '?'
  }
}

function goalBadgeColor(status: Goal['status']): ThemeColor {
  switch (status) {
    case 'complete':
      return 'success'
    case 'budget-limited':
    case 'stuck':
      return 'warning'
    case 'paused':
    case 'dropped':
      return 'muted'
    default:
      return 'accent'
  }
}

function truncate(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text
}

const GOAL_ICON = '◎'

interface GoalRenderState {
  hasResult?: boolean
}

function pendingLine(state: GoalRenderState, line: string): Component {
  return {
    invalidate: () => undefined,
    render: (): string[] => (state.hasResult === true ? [] : [line]),
  }
}

function goalStatusLine(
  options: { badge?: string; description?: string; icon: string; meta?: readonly string[] },
  theme: Theme,
): string {
  let line = `${options.icon} ${theme.fg('accent', 'Goal')}`
  if (options.description !== undefined) line += `: ${theme.fg('muted', options.description)}`
  if (options.badge !== undefined) line += ` ${options.badge}`
  const meta = (options.meta ?? []).filter((part) => part.length > 0)
  if (meta.length > 0) line += ` ${theme.fg('dim', meta.join(' · '))}`
  return line
}

function renderGoalResult(details: GoalToolDetails, theme: Theme): string {
  const description = describeOp(details.op)
  const goalRecord = details.goal
  if (goalRecord === null) {
    return goalStatusLine(
      {
        description,
        icon: theme.fg('warning', '⚠'),
        meta: [theme.fg('warning', 'no active goal')],
      },
      theme,
    )
  }
  const badge = theme.fg(goalBadgeColor(goalRecord.status), `⟦${goalRecord.status}⟧`)
  const lines = [goalStatusLine({ badge, description, icon: theme.fg('accent', GOAL_ICON) }, theme)]
  lines.push(
    `  ${theme.italic(theme.fg('muted', `"${truncate(goalRecord.objective.trim(), 120)}"`))}`,
  )
  const used = formatTokens(goalRecord.tokensUsed)
  const tokensLine =
    goalRecord.tokenBudget !== undefined
      ? `${used} / ${formatTokens(goalRecord.tokenBudget)} tokens (${formatTokens(Math.max(0, goalRecord.tokenBudget - goalRecord.tokensUsed))} left)`
      : `${used} tokens`
  const meta = [tokensLine]
  if (details.loop !== null) {
    meta.push(`review ${details.loop.iteration}/${details.loop.maxIterations}`)
  }
  if (goalRecord.timeUsedSeconds > 0) {
    meta.push(`${formatDuration(goalRecord.timeUsedSeconds * 1000)} elapsed`)
  }
  lines.push(`  ${theme.fg('dim', meta.join(' · '))}`)
  if (details.completionBudgetReport !== null) {
    lines.push(`  ${theme.fg('dim', 'Report')}`)
    for (const line of details.completionBudgetReport.split('\n')) {
      lines.push(`    ${theme.fg('muted', line)}`)
    }
  }
  return lines.join('\n')
}

function lastAssistantAborted(messages: readonly { role: string; stopReason?: string }[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === 'assistant') {
      return message.stopReason === 'aborted'
    }
  }
  return false
}

export interface GoalExtensionDependencies {
  checkRunner?: GoalCheckRunner
  reviewer?: GoalReviewer
}

export function createGoalExtension(
  dependencies: GoalExtensionDependencies = {},
): (pi: ExtensionAPI) => void {
  return (pi) => registerGoalExtension(pi, dependencies)
}

export default function goal(pi: ExtensionAPI): void {
  registerGoalExtension(pi, {})
}

function registerGoalExtension(pi: ExtensionAPI, dependencies: GoalExtensionDependencies): void {
  let state: GoalModeState | undefined
  let usage: GoalTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let context: ExtensionContext | undefined
  let continuationTimer: ReturnType<typeof setTimeout> | undefined
  let reviewAbort: AbortController | undefined
  let reviewPromise: Promise<void> | undefined
  let reviewInputState: GoalModeState | undefined
  let reviewImages: ImageContent[] = []
  let reviewRestartRequested = false
  let reviewSteeringTail: Promise<void> = Promise.resolve()
  let reviewGeneration = 0
  let turnCounter = 0
  const coderTools = new Map<string, string>()
  const checkRunner = dependencies.checkRunner ?? new ProjectGoalCheckRunner()
  const reviewer = dependencies.reviewer ?? new FreshGoalReviewer()
  const activity = new GoalActivityTracker(() => {
    refreshStatus()
    pi.events.emit(GOAL_ACTIVITY_EVENT, {
      version: 1,
      goalId: state?.goal.id,
      status: state?.goal.status ?? 'none',
      activity: activity.get(),
    })
  })
  const overlay = new GoalOverlay(
    () => state,
    () => ({ activity: activity.get(), usage: runtime.liveUsage() }),
  )

  const runtime = new GoalRuntime({
    getState: () => state,
    setState: (next) => {
      state = next
    },
    getCurrentUsage: () => ({ ...usage }),
    emit: (event) => {
      if (event.type === 'goal_updated') {
        handleGoalUpdated(event.state)
      }
    },
    persist: (mode: GoalPersistMode, persisted?: GoalModeState) => {
      const entry = encodeGoalModeEntry(mode, persisted)
      if (entry !== null) pi.appendEntry(modeEntryType, entry)
    },
    sendHiddenMessage: async (message) => {
      pi.sendMessage(
        { customType: message.customType, content: message.content, display: false },
        message.deliverAs === undefined
          ? { triggerTurn: false }
          : { triggerTurn: false, deliverAs: message.deliverAs },
      )
    },
    nextId: () => randomUUID(),
  })

  const isEnabled = () => state?.enabled === true
  const isPaused = () =>
    state !== undefined &&
    !state.enabled &&
    (state.goal.status === 'paused' || state.goal.status === 'stuck')

  const refreshStatus = () => {
    if (context === undefined) return
    context.ui.setStatus(statusKey, undefined)
    if (context.mode !== 'tui') return
    overlay.setUI(context.ui)
    overlay.update()
  }

  const syncToolExposure = (exposed: boolean) => {
    const active = pi.getActiveTools()
    const has = active.includes(toolName)
    if (exposed && !has) {
      pi.setActiveTools([...active, toolName])
    } else if (!exposed && has) {
      pi.setActiveTools(active.filter((name) => name !== toolName))
    }
  }

  const cancelContinuation = () => {
    if (continuationTimer === undefined) return
    clearTimeout(continuationTimer)
    continuationTimer = undefined
  }

  const cancelReview = async (reason: string, wait = true) => {
    const operation = reviewPromise
    reviewGeneration += 1
    reviewAbort?.abort(reason)
    reviewAbort = undefined
    reviewInputState = undefined
    reviewImages = []
    reviewRestartRequested = false
    activity.clear()
    await reviewer.cancel(reason).catch(() => {})
    if (wait) await operation?.catch(() => {})
    if (reviewPromise === operation) reviewPromise = undefined
  }

  const continuationBlocker = (ctx: ExtensionContext): string | undefined => {
    if (isLoopActive(ctx.sessionManager.getBranch()))
      return 'Waiting for the other loop · resumes automatically'
    if (!ctx.isIdle()) return 'Waiting for the parent agent · resumes automatically'
    if (ctx.hasPendingMessages()) return 'Waiting for queued messages · resumes automatically'
    if (ctx.hasUI && ctx.ui.getEditorText().trim().length > 0)
      return 'Waiting for the editor draft · resumes when cleared or submitted'
    return undefined
  }

  const scheduleContinuation = (ctx: ExtensionContext) => {
    cancelContinuation()
    const goalId = state?.goal.id
    const generation = reviewGeneration
    const eligible = () =>
      generation === reviewGeneration &&
      goalId !== undefined &&
      state?.goal.id === goalId &&
      state.enabled &&
      state.goal.status === 'active' &&
      state.loop.phase === 'between'
    if (!eligible() || goalId === undefined) return
    const retry = () => {
      continuationTimer = undefined
      if (!eligible()) return
      const blocker = continuationBlocker(ctx)
      if (blocker !== undefined) {
        activity.transition(goalId, 'waiting', blocker)
        continuationTimer = setTimeout(retry, continuationDelayMs)
        continuationTimer.unref?.()
        return
      }
      const prompt = runtime.buildContinuationPrompt()
      if (prompt === undefined) {
        activity.transition(goalId, 'waiting', 'No continuation available · /goal resume')
        return
      }
      activity.transition(goalId, 'queued', 'Continuation queued · no action needed')
      try {
        pi.sendMessage(
          { customType: 'goal-continuation', content: prompt, display: false },
          { triggerTurn: true, deliverAs: 'followUp' },
        )
      } catch (error) {
        runtime
          .pauseGoal({ goalId, phase: 'between' })
          .then((paused) => {
            if (paused !== undefined)
              ctx.ui.notify('Continuation delivery failed. Goal paused · /goal resume', 'error')
          })
          .catch((pauseError) =>
            ctx.ui.notify(
              pauseError instanceof Error ? pauseError.message : String(pauseError),
              'error',
            ),
          )
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      }
    }
    activity.transition(
      goalId,
      'waiting',
      continuationBlocker(ctx) ?? 'Continuing automatically · no action needed',
    )
    continuationTimer = setTimeout(retry, continuationDelayMs)
    continuationTimer.unref?.()
  }

  const exitGoalMode = (options: {
    reason: 'completed' | 'paused' | 'dropped'
    silent?: boolean
  }) => {
    const current = state
    if (options.reason === 'completed') {
      state = undefined
      pi.appendEntry(modeEntryType, { version: 3, mode: 'none' })
      if (current !== undefined) {
        const completed: {
          version: 2
          objective: string
          iterations: number
          maxIterations: number
          tokensUsed: number
          timeUsedSeconds: number
          tokenBudget?: number
          finalVerdict?: GoalModeState['loop']['verdictHistory'][number]
        } = {
          version: 2,
          objective: current.goal.objective,
          iterations: current.loop.iteration,
          maxIterations: current.loop.maxIterations,
          tokensUsed: current.goal.tokensUsed,
          timeUsedSeconds: current.goal.timeUsedSeconds,
        }
        if (current.goal.tokenBudget !== undefined) completed.tokenBudget = current.goal.tokenBudget
        const finalVerdict = current.loop.verdictHistory.at(-1)
        if (finalVerdict !== undefined) completed.finalVerdict = structuredClone(finalVerdict)
        pi.appendEntry(completedEntryType, completed)
      }
    }
    cancelContinuation()
    cancelReview(`Goal ${options.reason}.`, false).catch(() => {})
    syncToolExposure(options.reason === 'paused')
    if (options.reason === 'dropped' && context !== undefined) {
      context.ui.setStatus(statusKey, undefined)
    } else {
      refreshStatus()
    }
    if (options.silent === true || context === undefined) return
    if (options.reason === 'completed') {
      context.ui.notify('Goal completed after independent review.')
    } else if (options.reason === 'dropped') {
      context.ui.notify('Goal dropped.')
    } else {
      context.ui.notify('Goal mode paused.')
    }
  }

  function handleGoalUpdated(next: GoalModeState | undefined): void {
    if (next?.goal.status === 'dropped') {
      exitGoalMode({ reason: 'dropped', silent: true })
      return
    }
    if (next?.enabled !== true) {
      cancelContinuation()
      activity.clear()
    } else if (
      next.loop.phase === 'between' &&
      activity.get()?.phase !== 'waiting' &&
      activity.get()?.phase !== 'queued'
    ) {
      activity.transition(
        next.goal.id,
        'waiting',
        'Preparing automatic continuation · no action needed',
      )
    } else if (activity.get()?.goalId !== next.goal.id) {
      activity.transition(
        next.goal.id,
        context?.isIdle() === false ? 'coding' : 'queued',
        'Goal open · waiting for coder to start',
        true,
      )
    }
    syncToolExposure(state !== undefined)
    refreshStatus()
  }

  const executeReview = async (
    ctx: ExtensionContext,
    generation: number,
    controller: AbortController,
  ) => {
    const started = await runtime.beginReview()
    if (started === undefined || generation !== reviewGeneration) return
    activity.transition(
      started.goal.id,
      'checks',
      'Running automated checks · no action needed',
      true,
    )
    pi.events.emit(GOAL_REVIEW_START_EVENT, {
      version: 1,
      goalId: started.goal.id,
      iteration: started.loop.iteration + 1,
      maxIterations: started.loop.maxIterations,
    })
    let outcome: GoalReviewOutcome
    let checks: Awaited<ReturnType<GoalCheckRunner['run']>> = []
    let reviewUsage: GoalTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    let applied = false
    const onProgress = (event: GoalProgressEvent) => {
      if (
        generation !== reviewGeneration ||
        controller.signal.aborted ||
        state?.enabled !== true ||
        state.goal.id !== started.goal.id ||
        state.loop.phase !== 'reviewing'
      )
        return
      if (event.type === 'reviewer' && event.tokens !== undefined) {
        activity.progress({
          ...event,
          tokens: event.tokens + reviewUsage.input + reviewUsage.output + reviewUsage.cacheWrite,
        })
      } else activity.progress(event)
    }
    try {
      try {
        checks = await checkRunner.run({
          cwd: ctx.cwd,
          runtimeProbe: started.loop.runtimeProbe,
          signal: controller.signal,
          trusted: ctx.isProjectTrusted(),
          onProgress,
        })
        for (const check of checks) onProgress({ type: 'check-end', check })
        while (true) {
          if (generation !== reviewGeneration || controller.signal.aborted) return
          const current = state
          if (current === undefined || current.goal.id !== started.goal.id) return
          reviewInputState = cloneGoalState(current)
          const images = [...reviewImages]
          reviewRestartRequested = false
          onProgress({ type: 'reviewer', phase: 'starting-reviewer', tokens: 0 })
          try {
            const reviewed = enforceAutomatedChecks(
              await reviewer.review({
                checks,
                ctx,
                images,
                signal: controller.signal,
                state: reviewInputState,
                onProgress,
              }),
              checks,
            )
            reviewUsage = addTokenUsage(reviewUsage, reviewed.usage)
            await reviewSteeringTail
            if (reviewRestartRequested) continue
            outcome = { ...reviewed, usage: reviewUsage }
            break
          } catch (error) {
            if (error instanceof GoalReviewAbortedError) {
              reviewUsage = addTokenUsage(reviewUsage, error.usage)
              await reviewSteeringTail
              if (
                (reviewRestartRequested || error instanceof GoalReviewSteeringPendingError) &&
                generation === reviewGeneration &&
                !controller.signal.aborted
              ) {
                continue
              }
              return
            }
            throw error
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return
        const reason = error instanceof Error ? error.message : String(error)
        outcome = enforceAutomatedChecks(
          {
            status: 'PARTIAL',
            reason: `Independent review failed: ${reason}`,
            evidence: [],
            checks,
            reviewerModel: started.loop.reviewModel ?? 'inherit',
            report: '',
            usage: reviewUsage,
          },
          checks,
        )
      }
      if (generation !== reviewGeneration || controller.signal.aborted) return
      const application = await runtime.applyReview(outcome, {
        goalId: started.goal.id,
        iteration: started.loop.iteration,
      })
      applied = application !== undefined
      if (application === undefined || generation !== reviewGeneration) return
      const verdict = application.state.loop.verdictHistory.at(-1)
      if (verdict === undefined) return
      pi.appendEntry(reviewEntryType, {
        version: 1,
        goalId: application.state.goal.id,
        iteration: application.state.loop.iteration,
        maxIterations: application.state.loop.maxIterations,
        verdict,
      })
      pi.events.emit(GOAL_REVIEW_VERDICT_EVENT, {
        version: 1,
        goalId: application.state.goal.id,
        iteration: application.state.loop.iteration,
        verdict,
        decision: application.decision.action,
      })
      if (application.decision.action === 'pass') {
        pi.sendMessage(
          {
            customType: 'goal-result',
            content:
              `Goal completed after independent review. ${verdict.reason}\n${completionBudgetReport(application.state.goal) ?? ''}`.trim(),
            display: true,
          },
          { triggerTurn: false },
        )
        pi.events.emit(GOAL_REVIEW_STOP_EVENT, {
          version: 1,
          goalId: application.state.goal.id,
          reason: 'completed',
        })
        exitGoalMode({ reason: 'completed' })
        return
      }
      if (application.decision.action === 'stuck') {
        pi.events.emit(GOAL_REVIEW_STOP_EVENT, {
          version: 1,
          goalId: application.state.goal.id,
          reason: application.decision.reason,
        })
        ctx.ui.notify(`Goal stopped: ${application.decision.reason}`, 'warning')
        return
      }
      ctx.ui.notify(
        `Goal review ${verdict.status}. Continuing with reviewer findings.`,
        verdict.status === 'FAIL' ? 'warning' : 'info',
      )
      scheduleContinuation(ctx)
    } finally {
      if (!applied) await runtime.accountCancelledReview(started.goal.id, reviewUsage)
    }
  }

  const launchReview = (ctx: ExtensionContext) => {
    if (reviewPromise !== undefined || !isEnabled() || !ctx.isIdle() || ctx.hasPendingMessages())
      return
    cancelContinuation()
    reviewGeneration += 1
    const generation = reviewGeneration
    const controller = new AbortController()
    reviewAbort = controller
    reviewInputState = undefined
    reviewImages = []
    reviewRestartRequested = false
    const operation = executeReview(ctx, generation, controller)
    reviewPromise = operation
    operation
      .then(
        () => {
          if (reviewPromise === operation) reviewPromise = undefined
          if (reviewAbort === controller) reviewAbort = undefined
          if (generation === reviewGeneration) {
            reviewInputState = undefined
            reviewImages = []
            reviewRestartRequested = false
          }
        },
        (error) => {
          if (reviewPromise === operation) reviewPromise = undefined
          if (reviewAbort === controller) reviewAbort = undefined
          if (generation === reviewGeneration) {
            reviewInputState = undefined
            reviewImages = []
            reviewRestartRequested = false
            ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
          }
        },
      )
      .catch(() => {})
  }

  const buildGoalModeContext = (ctx: ExtensionContext): string | undefined => {
    const content = runtime.buildActivePrompt()
    if (content === undefined) return undefined
    if (!pi.getActiveTools().includes(todoWriteToolName)) return content
    const todoContext = renderTodoContext(readTodosFromBranch(ctx.sessionManager.getBranch()))
    return todoContext === undefined ? content : `${content}\n${todoContext}`
  }

  const sendGoalModeContext = (deliverAs: 'steer' | 'followUp', ctx: ExtensionContext) => {
    const content = buildGoalModeContext(ctx)
    if (content === undefined) return
    pi.sendMessage(
      { customType: 'goal-mode-context', content, display: false },
      { triggerTurn: false, deliverAs },
    )
  }

  const submitObjective = (objective: string, ctx: ExtensionCommandContext) => {
    if (!ctx.isIdle()) {
      sendGoalModeContext('steer', ctx)
      pi.sendUserMessage(objective, { deliverAs: 'steer' })
      return
    }
    pi.sendUserMessage(objective)
  }

  const createInput = (raw: string, ctx: ExtensionCommandContext): GoalCreateInput | undefined => {
    const parsed = parseGoalStartOptions(raw)
    if (parsed.kind === 'invalid') {
      ctx.ui.notify(parsed.error, 'error')
      return undefined
    }
    if (parsed.objective.length === 0) {
      ctx.ui.notify('Goal objective is required.', 'error')
      return undefined
    }
    const input: GoalCreateInput = { objective: parsed.objective }
    if (parsed.options.maxIterations !== undefined) {
      input.maxIterations = parsed.options.maxIterations
    }
    if (parsed.options.reviewModel !== undefined) input.reviewModel = parsed.options.reviewModel
    if (parsed.options.reviewFallbackModel !== undefined) {
      input.reviewFallbackModel = parsed.options.reviewFallbackModel
    }
    if (parsed.options.runtimeProbe !== undefined) {
      input.runtimeProbe = parsed.options.runtimeProbe
    }
    return input
  }

  const startGoal = async (raw: string, ctx: ExtensionCommandContext) => {
    const input = createInput(raw, ctx)
    if (input === undefined) return
    try {
      await runtime.createGoal(input)
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      return
    }
    submitObjective(input.objective, ctx)
  }

  const replaceGoal = async (raw: string, ctx: ExtensionCommandContext) => {
    const input = createInput(raw, ctx)
    if (input === undefined) return
    try {
      await cancelReview('Goal replaced by the user.')
      await runtime.replaceGoal(input)
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      return
    }
    submitObjective(input.objective, ctx)
  }

  const pauseGoal = async (ctx: ExtensionCommandContext) => {
    if (!isEnabled()) {
      ctx.ui.notify('No active goal to pause.', 'warning')
      return
    }
    await cancelReview('Goal paused by the user.')
    const paused = await runtime.pauseGoal()
    if (paused?.goal.status === 'complete') {
      exitGoalMode({ reason: 'completed' })
      return
    }
    exitGoalMode({ reason: 'paused' })
  }

  const resumeGoal = async (ctx: ExtensionCommandContext) => {
    if (!isPaused()) {
      ctx.ui.notify('No paused or stopped goal to resume.', 'warning')
      return
    }
    try {
      await runtime.resumeGoal()
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      return
    }
    ctx.ui.notify('Goal mode resumed.')
    scheduleContinuation(ctx)
  }

  const dropGoal = async (ctx: ExtensionCommandContext) => {
    if (state === undefined) {
      ctx.ui.notify('No goal to drop.', 'warning')
      return
    }
    const confirmed = await ctx.ui.confirm(
      'Drop goal?',
      'This removes the goal record. Accumulated usage stays in the session log.',
    )
    if (!confirmed) return
    await cancelReview('Goal dropped by the user.')
    await runtime.dropGoal()
    exitGoalMode({ reason: 'dropped' })
  }

  const applyBudget = async (raw: string, ctx: ExtensionCommandContext) => {
    if (state === undefined) {
      ctx.ui.notify('No goal is set.', 'warning')
      return
    }
    if (state.goal.status === 'complete') {
      ctx.ui.notify('Goal is already complete.')
      return
    }
    const parsed = parseBudgetInput(raw)
    if (parsed.kind === 'invalid') {
      ctx.ui.notify('Goal budget must be a positive integer or `off`.', 'error')
      return
    }
    const nextBudget = parsed.kind === 'off' ? undefined : parsed.value
    const updated = await runtime.onBudgetMutated(nextBudget)
    if (updated?.enabled === true) {
      if (updated.goal.status === 'budget-limited' && ctx.isIdle()) launchReview(ctx)
      else scheduleContinuation(ctx)
    }
    ctx.ui.notify(
      nextBudget === undefined ? 'Goal budget cleared.' : `Goal budget set to ${nextBudget}.`,
    )
  }

  const applyMaxIterations = async (raw: string, ctx: ExtensionCommandContext) => {
    const value = Number(raw.trim())
    if (!Number.isInteger(value) || value < 1 || value > MAX_GOAL_ITERATIONS) {
      ctx.ui.notify(`Goal max must be an integer from 1 to ${MAX_GOAL_ITERATIONS}.`, 'error')
      return
    }
    try {
      await runtime.setMaxIterations(value)
      ctx.ui.notify(`Goal iteration cap set to ${value}.`)
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const applyReviewer = async (raw: string, ctx: ExtensionCommandContext) => {
    const value = raw.trim()
    if (value.length === 0) {
      ctx.ui.notify('Use /goal reviewer <provider/model-id|inherit>.', 'error')
      return
    }
    try {
      await runtime.setReviewModel(value === 'inherit' ? undefined : value)
      ctx.ui.notify(
        value === 'inherit'
          ? 'Goal reviewer now inherits the parent model.'
          : `Goal reviewer set to ${value}.`,
      )
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const applyProbe = async (raw: string, ctx: ExtensionCommandContext) => {
    const enabled = parseToggle(raw)
    if (enabled === undefined) {
      ctx.ui.notify('Use /goal probe <on|off>.', 'error')
      return
    }
    try {
      await runtime.setRuntimeProbe(enabled)
      ctx.ui.notify(`Goal runtime probe ${enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const promptBudget = async (ctx: ExtensionCommandContext) => {
    const prefill = state?.goal.tokenBudget !== undefined ? String(state.goal.tokenBudget) : ''
    const input = (
      await ctx.ui.editor('Goal budget (number, `off`, or empty to cancel)', prefill)
    )?.trim()
    if (input === undefined || input.length === 0) return
    await applyBudget(input, ctx)
  }

  const showDetails = (ctx: ExtensionCommandContext) => {
    if (state === undefined) {
      ctx.ui.notify('No goal set.')
      return
    }
    ctx.ui.notify(goalDetails(state, activity.get()))
  }

  const openMenu = async (kind: 'active' | 'paused', ctx: ExtensionCommandContext) => {
    if (state === undefined) return
    const objective = state.goal.objective
    const summary = objective.length > 48 ? `${objective.slice(0, 47)}…` : objective
    const status = state.enabled ? state.loop.phase : state.goal.status
    const title =
      kind === 'active' ? `Goal: ${summary} (${status})` : `Goal: ${summary} (${status})`
    const items =
      kind === 'active'
        ? ['Show details', 'Adjust budget…', 'Pause', 'Drop']
        : ['Resume', 'Show details', 'Adjust budget…', 'Drop']
    const choice = await ctx.ui.select(title, items)
    switch (choice) {
      case 'Show details':
        showDetails(ctx)
        return
      case 'Adjust budget…':
        await promptBudget(ctx)
        return
      case 'Pause':
        await pauseGoal(ctx)
        return
      case 'Resume':
        await resumeGoal(ctx)
        return
      case 'Drop':
        await dropGoal(ctx)
        return
      default:
        return
    }
  }

  const setObjective = async (rest: string, ctx: ExtensionCommandContext) => {
    if (isPaused()) {
      ctx.ui.notify(
        'Resume the current goal first, or drop it before setting a new objective.',
        'warning',
      )
      return
    }
    const objective = rest.length > 0 ? rest : (await ctx.ui.editor('Goal objective'))?.trim()
    if (objective === undefined || objective.length === 0) return
    if (isEnabled()) {
      await replaceGoal(objective, ctx)
      return
    }
    await startGoal(objective, ctx)
  }

  const restore = async (ctx: ExtensionContext) => {
    context = ctx
    cancelContinuation()
    await cancelReview('The goal session changed.')
    runtime.clearAccounting()
    state = undefined
    let latest: ReturnType<typeof decodeGoalModeEntry> = null
    let invalidEntryFound = false
    const branch = ctx.sessionManager.getBranch()
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index]
      if (entry === undefined) continue
      if (entry.type !== 'custom' || entry.customType !== modeEntryType) continue
      const decoded = decodeGoalModeEntry(entry.data)
      if (decoded === null) invalidEntryFound = true
      else {
        latest = decoded
        break
      }
    }
    if (invalidEntryFound) {
      ctx.ui.notify('Ignored an invalid persisted goal state.', 'warning')
    }
    if (latest === null || latest.mode === 'none') {
      syncToolExposure(false)
      refreshStatus()
      return
    }
    state = restoreGoalModeState(latest)
    if (state === undefined) {
      syncToolExposure(false)
      refreshStatus()
      return
    }
    if (state.mode === 'exiting' && state.goal.status === 'complete') {
      exitGoalMode({ reason: 'completed', silent: true })
      return
    }
    const wasActive = state.enabled && isAccountingStatus(state.goal)
    await runtime.onThreadResumed()
    syncToolExposure(true)
    refreshStatus()
    if (wasActive) {
      ctx.ui.notify('Goal paused on session resume. Use /goal resume to continue.', 'info')
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    await restore(ctx)
  })

  pi.on('session_before_switch', async () => {
    cancelContinuation()
    await cancelReview('The parent session switched.')
    await runtime.onTaskAborted({ reason: 'internal' })
  })

  pi.on('session_before_fork', async () => {
    cancelContinuation()
    await cancelReview('The parent session forked.')
    await runtime.onTaskAborted({ reason: 'internal' })
  })

  pi.on('session_before_tree', async () => {
    cancelContinuation()
    await cancelReview('The parent session tree changed.')
    await runtime.onTaskAborted({ reason: 'internal' })
  })

  pi.on('session_tree', async (_event, ctx) => {
    await restore(ctx)
  })

  pi.on('session_shutdown', async () => {
    coderTools.clear()
    cancelContinuation()
    await cancelReview('The parent session shut down.')
    await runtime.onTaskAborted({ reason: 'internal' })
    context = undefined
    overlay.dispose()
  })

  pi.on('before_agent_start', (_event, ctx) => {
    const content = buildGoalModeContext(ctx)
    if (content === undefined) return
    return { message: { customType: 'goal-mode-context', content, display: false } }
  })

  pi.on('agent_start', async (_event, ctx) => {
    coderTools.clear()
    context = ctx
    cancelContinuation()
    if (reviewPromise !== undefined)
      await cancelReview('The parent agent started another coding turn.')
    await runtime.beginCodingTurn()
    if (state?.enabled === true)
      activity.transition(state.goal.id, 'coding', 'Coder working · type to steer', true)
  })

  pi.on('turn_start', () => {
    turnCounter += 1
    runtime.onTurnStart(`turn-${turnCounter}`, usage)
  })

  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') return
    const messageUsage = event.message.usage
    usage = {
      input: usage.input + messageUsage.input,
      output: usage.output + messageUsage.output,
      cacheRead: usage.cacheRead + messageUsage.cacheRead,
      cacheWrite: usage.cacheWrite + messageUsage.cacheWrite,
    }
  })

  const observeCoder = () => {
    if (state?.enabled !== true || state.loop.phase !== 'coding') return
    const tool = coderTools.values().next().value
    activity.transition(state.goal.id, 'coding', `Coder working · ${tool ?? 'awaiting response'}`)
    activity.touch()
  }

  pi.on('message_update', () => {
    if (Date.now() - (activity.get()?.updatedAt ?? 0) >= 250) observeCoder()
  })

  pi.on('tool_execution_update', () => {
    if (Date.now() - (activity.get()?.updatedAt ?? 0) >= 250) observeCoder()
  })

  pi.on('tool_execution_start', (event) => {
    if (state?.enabled !== true || state.loop.phase !== 'coding') return
    coderTools.set(event.toolCallId, event.toolName)
    observeCoder()
  })

  pi.on('tool_execution_end', async (event) => {
    coderTools.delete(event.toolCallId)
    observeCoder()
    if (event.toolName === toolName) {
      await runtime.onGoalToolCompleted()
      return
    }
    await runtime.onToolCompleted(event.toolName)
  })

  pi.on('agent_end', async (event, ctx) => {
    coderTools.clear()
    context = ctx
    await runtime.onAgentEnd({ currentUsage: usage })
    if (!lastAssistantAborted(event.messages)) return
    await runtime.onTaskAborted({ reason: 'interrupted' })
    if (isPaused()) ctx.ui.notify('Goal paused. Use /goal resume to continue.', 'info')
  })

  pi.on('agent_settled', (_event, ctx) => {
    context = ctx
    if (state?.enabled === true && isAccountingStatus(state.goal)) launchReview(ctx)
  })

  pi.on('input', async (event, ctx) => {
    if (
      state?.enabled !== true ||
      state.loop.phase !== 'reviewing' ||
      event.source === 'extension' ||
      event.text.trimStart().startsWith('/')
    ) {
      return { action: 'continue' }
    }
    const images = event.images ?? []
    if (event.text.trim().length === 0 && images.length === 0) return { action: 'handled' }
    const text =
      event.text.trim().length === 0 && images.length > 0
        ? 'Inspect the user-provided review image.'
        : event.text
    const generation = reviewGeneration
    const deliver = async () => {
      try {
        await runtime.queueReviewSteering(text)
      } catch (error) {
        ctx.ui.setEditorText(event.text)
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'warning')
        return
      }
      if (generation !== reviewGeneration) return
      reviewImages.push(...images)
      const delivered = await reviewer.steer(text, images)
      if (!delivered && reviewInputState !== undefined) {
        reviewRestartRequested = true
        await reviewer.cancel('Restarting the review with undelivered steering.').catch(() => {})
      }
      ctx.ui.notify('Steering queued for the active goal review.')
    }
    reviewSteeringTail = reviewSteeringTail.then(deliver)
    await reviewSteeringTail
    return { action: 'handled' }
  })

  pi.registerCommand('goal', {
    description: 'Run a persistent coder-reviewer goal loop.',
    getArgumentCompletions(prefix) {
      const trimmed = prefix.trim()
      return goalSubcommands
        .filter((value) => value.startsWith(trimmed))
        .map((value) => ({ value, label: value }))
    },
    async handler(args, ctx) {
      context = ctx
      const { sub, rest } = parseGoalSubcommand(args)
      switch (sub) {
        case 'set':
          await setObjective(rest, ctx)
          return
        case 'show':
          showDetails(ctx)
          return
        case 'pause':
          await pauseGoal(ctx)
          return
        case 'resume':
          await resumeGoal(ctx)
          return
        case 'drop':
          await dropGoal(ctx)
          return
        case 'budget':
          if (rest.length === 0) {
            await promptBudget(ctx)
            return
          }
          await applyBudget(rest, ctx)
          return
        case 'max':
          await applyMaxIterations(rest, ctx)
          return
        case 'reviewer':
          await applyReviewer(rest, ctx)
          return
        case 'probe':
          await applyProbe(rest, ctx)
          return
        default:
          break
      }
      if (isEnabled()) {
        if (rest.length > 0) {
          ctx.ui.notify(
            'Goal mode is already active. Use /goal to manage it, or /goal drop to start over.',
          )
          return
        }
        await openMenu('active', ctx)
        return
      }
      if (isPaused()) {
        if (rest.length > 0) {
          ctx.ui.notify(
            'Resume the current goal first, or drop it before setting a new objective.',
            'warning',
          )
          return
        }
        await openMenu('paused', ctx)
        return
      }
      if (rest.length > 0) {
        await startGoal(rest, ctx)
        return
      }
      const objective = (await ctx.ui.editor('Goal objective'))?.trim()
      if (objective === undefined || objective.length === 0) {
        return
      }
      await startGoal(objective, ctx)
    },
  })

  pi.registerCommand('guided-goal', {
    description:
      'Prepare a verifiable goal from context. Use --interview for one question per reply.',
    async handler(args, ctx) {
      context = ctx
      if (isEnabled()) {
        ctx.ui.notify(
          'Goal mode is already active. Use /goal to manage it, or /goal drop to start over.',
        )
        return
      }
      if (isPaused()) {
        ctx.ui.notify(
          'Resume the current goal first, or drop it before setting a new objective.',
          'warning',
        )
        return
      }
      syncToolExposure(true)
      const trimmed = args.trim()
      const interview = /^--interview(?:\s|$)/.test(trimmed)
      const initial = interview ? trimmed.slice('--interview'.length).trim() : trimmed
      const kickoff = renderGuidedGoalInterview(
        initial.length === 0 ? undefined : initial,
        interview ? 'interview' : 'contextual',
      )
      pi.sendMessage(
        { customType: 'guided-goal-interview', content: kickoff, display: false },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    },
  })

  pi.registerTool<typeof goalToolParameters, GoalToolDetails, GoalRenderState>({
    name: toolName,
    label: 'Goal',
    description: goalToolDescription,
    promptSnippet: 'Manage the active goal-mode objective',
    parameters: goalToolParameters,
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      context = ctx
      let resultGoal: Goal | null = null
      let resultLoop: GoalModeState['loop'] | null = null
      try {
        if (params.op === 'create') {
          const objective = params.objective?.trim() ?? ''
          if (objective.length === 0) {
            throw new GoalRuntimeError('objective is required when op=create')
          }
          const input: GoalCreateInput = { objective }
          if (params.token_budget !== undefined) input.tokenBudget = params.token_budget
          if (params.max_iterations !== undefined) input.maxIterations = params.max_iterations
          if (params.review_model !== undefined) input.reviewModel = params.review_model
          if (params.review_fallback_model !== undefined) {
            input.reviewFallbackModel = params.review_fallback_model
          }
          if (params.runtime_probe !== undefined) input.runtimeProbe = params.runtime_probe
          const created = await runtime.createGoal(input)
          resultGoal = created.goal
          resultLoop = created.loop
        } else if (params.op === 'get') {
          resultGoal = state?.goal ?? null
          resultLoop = state?.loop ?? null
        } else if (params.op === 'resume') {
          const resumed = await runtime.resumeGoal()
          resultGoal = resumed.goal
          resultLoop = resumed.loop
        } else if (params.op === 'drop') {
          resultLoop = state?.loop ?? null
          resultGoal = (await runtime.dropGoal()) ?? null
        } else {
          const requested = await runtime.requestReviewFromTool()
          resultGoal = requested.goal
          resultLoop = requested.loop
        }
      } catch (error) {
        if (error instanceof GoalRuntimeError) throw new Error(error.message)
        throw error
      }
      const details: GoalToolDetails = {
        op: params.op,
        goal: resultGoal,
        loop: resultLoop,
        remainingTokens: remainingTokens(resultGoal),
        completionBudgetReport: null,
      }
      const live = activity.get()
      if (live !== undefined && live.goalId === resultGoal?.id)
        details.activity = structuredClone(live)
      return {
        content: [{ type: 'text', text: describeTool(details) }],
        details,
      }
    },
    renderCall(args, theme, context) {
      const meta: string[] = []
      const objective = args.objective?.trim()
      if (args.op === 'create' && objective !== undefined && objective.length > 0) {
        meta.push(theme.italic(theme.fg('muted', `"${truncate(objective, 80)}"`)))
      }
      if (args.op === 'create' && args.token_budget !== undefined) {
        meta.push(`budget ${formatTokens(args.token_budget)}`)
      }
      if (args.op === 'create' && args.max_iterations !== undefined) {
        meta.push(`max ${args.max_iterations}`)
      }
      if (args.op === 'create' && args.review_model !== undefined) {
        meta.push(`reviewer ${args.review_model}`)
      }
      return pendingLine(
        context.state,
        goalStatusLine(
          { description: describeOp(args.op), icon: theme.fg('muted', '⏳'), meta },
          theme,
        ),
      )
    },
    renderResult(result, _options, theme, context) {
      context.state.hasResult = true
      const details = decodeGoalToolDetails(result.details)
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Goal tool failed'
        return new Text(
          `${goalStatusLine({ icon: theme.fg('error', '✘') }, theme)}\n  ${theme.fg('error', message)}`,
          0,
          0,
        )
      }
      return new Text(renderGoalResult(details, theme), 0, 0)
    },
  })
}
