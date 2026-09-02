import { randomUUID } from 'node:crypto'

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
  ThemeColor,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import { goalSubcommands, parseBudgetInput, parseGoalSubcommand } from './commands.ts'
import { isLoopActive } from './loop-activity.ts'
import {
  completionBudgetReport,
  goalToolDescription,
  renderGuidedGoalInterview,
} from './prompts.ts'
import { GoalRuntime, GoalRuntimeError } from './runtime.ts'
import {
  decodeGoalModeEntry,
  encodeGoalModeEntry,
  type Goal,
  type GoalModeState,
  type GoalPersistMode,
  GoalSchema,
  type GoalTokenUsage,
  remainingTokens,
} from './state.ts'
import { readTodosFromBranch, renderTodoContext, todoWriteToolName } from './todo-context.ts'

const modeEntryType = 'pi-goal-mode'
const completedEntryType = 'pi-goal-completed'
const statusKey = 'pi-goal'
const toolName = 'goal'
const continuationDelayMs = 800

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
  remainingTokens: Type.Union([Type.Number(), Type.Null()]),
  completionBudgetReport: Type.Union([Type.String(), Type.Null()]),
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

function describeTool(goal: Goal | null, report: string | null): string {
  if (goal === null) {
    return 'No active goal.'
  }
  let text = `Goal: ${goal.objective}\nStatus: ${goal.status}\nTokens: ${goal.tokensUsed} used`
  if (goal.tokenBudget !== undefined) {
    text += ` / ${goal.tokenBudget} budget`
  }
  const remaining = remainingTokens(goal)
  if (remaining !== null) {
    text += `\nRemaining tokens: ${remaining}`
  }
  if (report !== null) {
    text += `\n\n${report}`
  }
  return text
}

function goalDetails(state: GoalModeState): string {
  const goal = state.goal
  const used = formatTokens(goal.tokensUsed)
  const budgetLine =
    goal.tokenBudget !== undefined
      ? `${used} / ${formatTokens(goal.tokenBudget)} (${formatTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed))} left)`
      : `${used} (no budget)`
  return [
    `Objective: ${goal.objective}`,
    `Status: ${goal.status}${state.enabled ? '' : ' (paused)'}`,
    `Tokens: ${budgetLine}`,
    `Time spent: ${formatDuration(goal.timeUsedSeconds * 1000)}`,
  ].join('\n')
}

function describeOp(op: GoalToolDetails['op'] | undefined): string {
  switch (op) {
    case 'create':
      return 'set'
    case 'complete':
      return 'complete'
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

function renderGoalResult(details: GoalToolDetails, theme: Theme): string {
  const title = theme.fg('toolTitle', theme.bold('Goal'))
  const op = theme.fg('dim', describeOp(details.op))
  const goalRecord = details.goal
  if (goalRecord === null) {
    return `${title} ${op} ${theme.fg('warning', 'no active goal')}`
  }
  const badge = theme.fg(goalBadgeColor(goalRecord.status), `[${goalRecord.status}]`)
  const lines = [`${title} ${op} ${badge}`]
  lines.push(theme.italic(theme.fg('muted', `"${truncate(goalRecord.objective.trim(), 120)}"`)))
  const used = formatTokens(goalRecord.tokensUsed)
  const tokensLine =
    goalRecord.tokenBudget !== undefined
      ? `${used} / ${formatTokens(goalRecord.tokenBudget)} tokens (${formatTokens(Math.max(0, goalRecord.tokenBudget - goalRecord.tokensUsed))} left)`
      : `${used} tokens`
  const meta = [tokensLine]
  if (goalRecord.timeUsedSeconds > 0) {
    meta.push(`${formatDuration(goalRecord.timeUsedSeconds * 1000)} elapsed`)
  }
  lines.push(theme.fg('dim', meta.join(' · ')))
  if (details.completionBudgetReport !== null) {
    lines.push(theme.fg('muted', details.completionBudgetReport))
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

export default function goal(pi: ExtensionAPI): void {
  let state: GoalModeState | undefined
  let usage: GoalTokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let context: ExtensionContext | undefined
  let continuationTimer: ReturnType<typeof setTimeout> | undefined
  let turnHadToolCalls = false
  let continuationTurnInFlight = false
  let suppressNextContinuation = false
  let turnCounter = 0

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
      const entry = encodeGoalModeEntry(mode, persisted?.goal)
      if (entry !== null) {
        pi.appendEntry(modeEntryType, entry)
      }
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
  const isPaused = () => state !== undefined && !state.enabled && state.goal.status === 'paused'

  const refreshStatus = () => {
    if (context === undefined) {
      return
    }
    if (state === undefined) {
      context.ui.setStatus(statusKey, undefined)
      return
    }
    const goalState = state.goal
    const tokens =
      goalState.tokenBudget === undefined
        ? formatTokens(goalState.tokensUsed)
        : `${formatTokens(goalState.tokensUsed)}/${formatTokens(goalState.tokenBudget)}`
    const label = state.enabled ? goalState.status : 'paused'
    context.ui.setStatus(statusKey, `goal ${label} ${tokens}`)
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
    if (continuationTimer !== undefined) {
      clearTimeout(continuationTimer)
      continuationTimer = undefined
    }
  }

  const resetContinuationSuppression = () => {
    suppressNextContinuation = false
  }

  const continuationBlocked = (ctx: ExtensionContext): boolean => {
    if (!isEnabled() || suppressNextContinuation) {
      return true
    }
    if (isLoopActive(ctx.sessionManager.getBranch())) {
      return true
    }
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      return true
    }
    if (ctx.hasUI && ctx.ui.getEditorText().trim().length > 0) {
      return true
    }
    return state?.goal.status !== 'active'
  }

  const scheduleContinuation = (ctx: ExtensionContext) => {
    cancelContinuation()
    if (continuationBlocked(ctx)) {
      return
    }
    const prompt = runtime.buildContinuationPrompt()
    if (prompt === undefined) {
      return
    }
    continuationTimer = setTimeout(() => {
      continuationTimer = undefined
      if (continuationBlocked(ctx)) {
        return
      }
      continuationTurnInFlight = true
      pi.sendMessage(
        { customType: 'goal-continuation', content: prompt, display: false },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    }, continuationDelayMs)
  }

  const exitGoalMode = (options: {
    reason: 'completed' | 'paused' | 'dropped'
    silent?: boolean
  }) => {
    const current = state
    if (options.reason === 'completed') {
      state = undefined
      pi.appendEntry(modeEntryType, { version: 2, mode: 'none' })
      if (current !== undefined) {
        const completed: {
          objective: string
          tokensUsed: number
          timeUsedSeconds: number
          tokenBudget?: number
        } = {
          objective: current.goal.objective,
          tokensUsed: current.goal.tokensUsed,
          timeUsedSeconds: current.goal.timeUsedSeconds,
        }
        if (current.goal.tokenBudget !== undefined) {
          completed.tokenBudget = current.goal.tokenBudget
        }
        pi.appendEntry(completedEntryType, completed)
      }
    }
    continuationTurnInFlight = false
    cancelContinuation()
    syncToolExposure(options.reason === 'paused')
    if (options.reason === 'dropped' && context !== undefined) {
      context.ui.setStatus(statusKey, undefined)
    } else {
      refreshStatus()
    }
    if (options.silent === true || context === undefined) {
      return
    }
    if (options.reason === 'completed') {
      context.ui.notify('Goal mode completed.')
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
    }
    syncToolExposure(state !== undefined)
    refreshStatus()
  }

  const buildGoalModeContext = (ctx: ExtensionContext): string | undefined => {
    const content = runtime.buildActivePrompt()
    if (content === undefined) {
      return undefined
    }
    if (!pi.getActiveTools().includes(todoWriteToolName)) {
      return content
    }
    const todoContext = renderTodoContext(readTodosFromBranch(ctx.sessionManager.getBranch()))
    return todoContext === undefined ? content : `${content}\n${todoContext}`
  }

  const sendGoalModeContext = (deliverAs: 'steer' | 'followUp', ctx: ExtensionContext) => {
    const content = buildGoalModeContext(ctx)
    if (content === undefined) {
      return
    }
    pi.sendMessage(
      { customType: 'goal-mode-context', content, display: false },
      { triggerTurn: false, deliverAs },
    )
  }

  const submitObjective = (objective: string, ctx: ExtensionCommandContext) => {
    resetContinuationSuppression()
    if (!ctx.isIdle()) {
      sendGoalModeContext('steer', ctx)
      pi.sendUserMessage(objective, { deliverAs: 'steer' })
      return
    }
    pi.sendUserMessage(objective)
  }

  const startGoal = async (objective: string, ctx: ExtensionCommandContext) => {
    try {
      await runtime.createGoal({ objective })
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      return
    }
    submitObjective(objective, ctx)
  }

  const replaceGoal = async (objective: string, ctx: ExtensionCommandContext) => {
    try {
      await runtime.replaceGoal({ objective })
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      return
    }
    submitObjective(objective, ctx)
  }

  const pauseGoal = async (ctx: ExtensionCommandContext) => {
    if (!isEnabled()) {
      ctx.ui.notify('No active goal to pause.', 'warning')
      return
    }
    await runtime.pauseGoal()
    exitGoalMode({ reason: 'paused' })
  }

  const resumeGoal = async (ctx: ExtensionCommandContext) => {
    if (!isPaused()) {
      ctx.ui.notify('No paused goal to resume.', 'warning')
      return
    }
    await runtime.resumeGoal()
    resetContinuationSuppression()
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
    if (!confirmed) {
      return
    }
    await runtime.dropGoal()
    exitGoalMode({ reason: 'dropped' })
  }

  const applyBudget = async (raw: string, ctx: ExtensionCommandContext) => {
    if (!isEnabled()) {
      ctx.ui.notify('No active goal.', 'warning')
      return
    }
    if (state?.goal.status === 'complete') {
      ctx.ui.notify('Goal is already complete.')
      return
    }
    const parsed = parseBudgetInput(raw)
    if (parsed.kind === 'invalid') {
      ctx.ui.notify('Goal budget must be a positive integer or `off`.', 'error')
      return
    }
    const nextBudget = parsed.kind === 'off' ? undefined : parsed.value
    await runtime.onBudgetMutated(nextBudget)
    resetContinuationSuppression()
    scheduleContinuation(ctx)
    ctx.ui.notify(
      nextBudget === undefined ? 'Goal budget cleared.' : `Goal budget set to ${nextBudget}.`,
    )
  }

  const promptBudget = async (ctx: ExtensionCommandContext) => {
    const prefill = state?.goal.tokenBudget !== undefined ? String(state.goal.tokenBudget) : ''
    const input = (
      await ctx.ui.editor('Goal budget (number, `off`, or empty to cancel)', prefill)
    )?.trim()
    if (input === undefined || input.length === 0) {
      return
    }
    await applyBudget(input, ctx)
  }

  const showDetails = (ctx: ExtensionCommandContext) => {
    if (state === undefined) {
      ctx.ui.notify('No goal set.')
      return
    }
    ctx.ui.notify(goalDetails(state))
  }

  const openMenu = async (kind: 'active' | 'paused', ctx: ExtensionCommandContext) => {
    if (state === undefined) {
      return
    }
    const objective = state.goal.objective
    const summary = objective.length > 48 ? `${objective.slice(0, 47)}…` : objective
    const title =
      kind === 'active' ? `Goal: ${summary} (${state.goal.status})` : `Goal paused: ${summary}`
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
    if (objective === undefined || objective.length === 0) {
      return
    }
    if (isEnabled()) {
      await replaceGoal(objective, ctx)
      return
    }
    await startGoal(objective, ctx)
  }

  const restore = async (ctx: ExtensionContext) => {
    context = ctx
    cancelContinuation()
    continuationTurnInFlight = false
    suppressNextContinuation = false
    turnHadToolCalls = false
    runtime.clearAccounting()
    state = undefined
    let latest: ReturnType<typeof decodeGoalModeEntry> = null
    let invalidEntryFound = false
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === modeEntryType) {
        const decoded = decodeGoalModeEntry(entry.data)
        if (decoded === null) {
          invalidEntryFound = true
        } else {
          latest = decoded
          invalidEntryFound = false
        }
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
    const wasActive = latest.mode === 'goal' && latest.goal.status === 'active'
    state = { enabled: latest.mode === 'goal', mode: 'active', goal: { ...latest.goal } }
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

  pi.on('session_tree', async (_event, ctx) => {
    await restore(ctx)
  })

  pi.on('session_shutdown', async () => {
    cancelContinuation()
    await runtime.onTaskAborted({ reason: 'internal' })
  })

  pi.on('before_agent_start', (_event, ctx) => {
    const content = buildGoalModeContext(ctx)
    if (content === undefined) {
      return
    }
    return { message: { customType: 'goal-mode-context', content, display: false } }
  })

  pi.on('agent_start', (_event, ctx) => {
    context = ctx
    turnHadToolCalls = false
    cancelContinuation()
  })

  pi.on('turn_start', () => {
    turnCounter += 1
    runtime.onTurnStart(`turn-${turnCounter}`, usage)
  })

  pi.on('message_start', (event) => {
    if (event.message.role === 'user') {
      resetContinuationSuppression()
    }
  })

  pi.on('message_end', (event) => {
    if (event.message.role !== 'assistant') {
      return
    }
    const messageUsage = event.message.usage
    usage = {
      input: usage.input + messageUsage.input,
      output: usage.output + messageUsage.output,
      cacheRead: usage.cacheRead + messageUsage.cacheRead,
      cacheWrite: usage.cacheWrite + messageUsage.cacheWrite,
    }
  })

  pi.on('tool_execution_start', () => {
    turnHadToolCalls = true
    if (!continuationTurnInFlight) {
      resetContinuationSuppression()
    }
  })

  pi.on('tool_execution_end', async (event) => {
    if (event.toolName === toolName) {
      await runtime.onGoalToolCompleted()
      return
    }
    await runtime.onToolCompleted(event.toolName)
  })

  pi.on('agent_end', async (event, ctx) => {
    context = ctx
    await runtime.onAgentEnd({ currentUsage: usage })
    if (lastAssistantAborted(event.messages)) {
      continuationTurnInFlight = false
      await runtime.onTaskAborted({ reason: 'interrupted' })
      if (isPaused()) {
        ctx.ui.notify('Goal paused. Use /goal resume to continue.', 'info')
      }
    }
  })

  pi.on('agent_settled', (_event, ctx) => {
    context = ctx
    if (continuationTurnInFlight) {
      suppressNextContinuation = !turnHadToolCalls
      continuationTurnInFlight = false
    }
    if (state?.mode === 'exiting') {
      exitGoalMode({ reason: 'completed' })
      return
    }
    scheduleContinuation(ctx)
  })

  pi.registerCommand('goal', {
    description: 'Set, show, pause, resume, drop, or budget a long-running goal.',
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
          if (!isEnabled()) {
            ctx.ui.notify(
              isPaused() ? 'Resume the goal before adjusting the budget.' : 'No active goal.',
              'warning',
            )
            return
          }
          if (rest.length === 0) {
            await promptBudget(ctx)
            return
          }
          await applyBudget(rest, ctx)
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
    description: 'Interview the user, then create a goal with verifiable success criteria.',
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
      const kickoff = renderGuidedGoalInterview(trimmed.length === 0 ? undefined : trimmed)
      pi.sendMessage(
        { customType: 'guided-goal-interview', content: kickoff, display: false },
        { triggerTurn: true, deliverAs: 'followUp' },
      )
    },
  })

  pi.registerTool({
    name: toolName,
    label: 'Goal',
    description: goalToolDescription,
    promptSnippet: 'Manage the active goal-mode objective',
    parameters: goalToolParameters,
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      context = ctx
      let resultGoal: Goal | null = null
      let report: string | null = null
      try {
        if (params.op === 'create') {
          const objective = params.objective?.trim() ?? ''
          if (objective.length === 0) {
            throw new GoalRuntimeError('objective is required when op=create')
          }
          const created = await runtime.createGoal(
            params.token_budget === undefined
              ? { objective }
              : { objective, tokenBudget: params.token_budget },
          )
          resetContinuationSuppression()
          resultGoal = created.goal
        } else if (params.op === 'get') {
          resultGoal = state?.goal ?? null
        } else if (params.op === 'resume') {
          const resumed = await runtime.resumeGoal()
          resetContinuationSuppression()
          resultGoal = resumed.goal
        } else if (params.op === 'drop') {
          resultGoal = (await runtime.dropGoal()) ?? null
        } else {
          resultGoal = await runtime.completeGoalFromTool()
          report = completionBudgetReport(resultGoal)
        }
      } catch (error) {
        if (error instanceof GoalRuntimeError) {
          throw new Error(error.message)
        }
        throw error
      }
      const details: GoalToolDetails = {
        op: params.op,
        goal: resultGoal,
        remainingTokens: remainingTokens(resultGoal),
        completionBudgetReport: report,
      }
      return {
        content: [{ type: 'text', text: describeTool(resultGoal, report) }],
        details,
      }
    },
    renderCall(args, theme) {
      const parts = [
        theme.fg('toolTitle', theme.bold('Goal')),
        theme.fg('dim', describeOp(args.op)),
      ]
      const objective = args.objective?.trim()
      if (args.op === 'create' && objective !== undefined && objective.length > 0) {
        parts.push(theme.italic(theme.fg('muted', `"${truncate(objective, 80)}"`)))
      }
      if (args.op === 'create' && args.token_budget !== undefined) {
        parts.push(theme.fg('dim', `budget ${formatTokens(args.token_budget)}`))
      }
      return new Text(parts.join(' '), 0, 0)
    },
    renderResult(result, _options, theme) {
      const details = decodeGoalToolDetails(result.details)
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Goal tool failed'
        return new Text(theme.fg('error', message), 0, 0)
      }
      return new Text(renderGoalResult(details, theme), 0, 0)
    },
  })
}
