import { randomUUID } from 'node:crypto'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import {
  activeDurationMs,
  createGoal,
  decodeGoalState,
  dispatchContinuation,
  type GoalState,
  settleGoalTurn,
  updateGoalStatus,
} from './machine.ts'
import { parseGoalCommand } from './policy.ts'

const entryType = 'pi-goal-state'
const statusKey = 'pi-goal'
const maximumIdleContinuations = 3

function isActive(state: GoalState | null): state is GoalState & { status: 'active' } {
  return state?.status === 'active'
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

function describeGoal(state: GoalState | null, now = Date.now()): string {
  if (state === null) {
    return 'No goal exists in this session.'
  }
  const runtime = formatDuration(activeDurationMs(state, now))
  return `Goal ${state.status}. Objective: ${state.objective}. Active runtime: ${runtime}. Continuations: ${state.continuationCount}.`
}

function goalInstructions(state: GoalState): string {
  return [
    'A long-running Pi goal is active in this session.',
    `Objective: ${JSON.stringify(state.objective)}`,
    'Continue concrete work toward the full objective.',
    'Use the current workspace and external state as authoritative evidence.',
    'Do not narrow the objective to work that fits in this turn.',
    'Before completion, verify every explicit requirement against authoritative evidence.',
    'Keep the goal active if any requirement is incomplete, uncertain, or unverified.',
    'Call update_goal with status complete only after no required work remains.',
  ].join('\n')
}

export default function goal(pi: ExtensionAPI): void {
  let state: GoalState | null = null
  let continuationTimer: ReturnType<typeof setTimeout> | undefined
  let continuationGeneration = 0
  let scheduledGoalId: string | null = null
  let pendingTurn: { goalId: string; isContinuation: boolean; usedTool: boolean } | null = null
  let currentTurn: { goalId: string | null; isContinuation: boolean; usedTool: boolean } | null =
    null

  const clearContinuation = () => {
    continuationGeneration += 1
    if (continuationTimer !== undefined) {
      clearTimeout(continuationTimer)
    }
    continuationTimer = undefined
    scheduledGoalId = null
    pendingTurn = null
  }

  const refreshStatus = (ctx: ExtensionContext) => {
    if (state === null || state.status === 'cleared') {
      ctx.ui.setStatus(statusKey, undefined)
      return
    }
    ctx.ui.setStatus(
      statusKey,
      `goal ${state.status} ${formatDuration(activeDurationMs(state, Date.now()))}`,
    )
  }

  const persist = (ctx: ExtensionContext) => {
    if (state === null) {
      return
    }
    pi.appendEntry(entryType, state)
    refreshStatus(ctx)
  }

  const sendGoalTurn = (goalState: GoalState, continuation: boolean, seededTool: boolean) => {
    const timestamp = new Date().toISOString()
    pendingTurn = { goalId: goalState.id, isContinuation: continuation, usedTool: seededTool }
    pi.sendMessage(
      {
        customType: entryType,
        content: `<timestamp>${timestamp}</timestamp>\n${goalInstructions(goalState)}`,
        display: false,
        details: {
          kind: continuation ? 'continuation' : 'start',
          goalId: goalState.id,
          timestamp,
        },
      },
      { triggerTurn: true, deliverAs: 'followUp' },
    )
  }

  const queueContinuation = (ctx: ExtensionContext) => {
    if (!isActive(state) || scheduledGoalId === state.id) {
      return
    }
    if (state.idleContinuationsWithoutToolCalls >= maximumIdleContinuations) {
      return
    }
    const goalId = state.id
    const generation = continuationGeneration
    scheduledGoalId = goalId
    const attempt = () => {
      continuationTimer = undefined
      if (generation !== continuationGeneration || !isActive(state) || state.id !== goalId) {
        return
      }
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        continuationTimer = setTimeout(attempt, 20)
        return
      }
      scheduledGoalId = null
      state = dispatchContinuation(state)
      persist(ctx)
      sendGoalTurn(state, true, false)
    }
    continuationTimer = setTimeout(attempt, 0)
  }

  const replaceGoal = (objective: string, ctx: ExtensionContext) => {
    clearContinuation()
    const created = createGoal(objective, Date.now(), randomUUID())
    state = created
    persist(ctx)
    return created
  }

  const restore = (ctx: ExtensionContext) => {
    clearContinuation()
    state = null
    let invalidStateFound = false
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom' && entry.customType === entryType) {
        const decoded = decodeGoalState(entry.data)
        if (decoded === null) {
          invalidStateFound = true
        } else {
          state = decoded
          invalidStateFound = false
        }
      }
    }
    if (invalidStateFound) {
      ctx.ui.notify('Ignored an invalid persisted goal state.', 'warning')
    }
    refreshStatus(ctx)
    if (isActive(state)) {
      queueContinuation(ctx)
    }
  }

  const updateStatus = (status: 'active' | 'complete', ctx: ExtensionContext): string => {
    if (state === null || state.status === 'cleared') {
      return 'No goal exists in this session.'
    }
    clearContinuation()
    state = updateGoalStatus(state, status, Date.now())
    persist(ctx)
    if (status === 'active') {
      return 'Goal is now active.'
    }
    return `Goal is now complete. Report total runtime to the user: ${formatDuration(state.activeDurationMs)}`
  }

  const controlGoal = (control: 'status' | 'pause' | 'resume' | 'clear', ctx: ExtensionContext) => {
    if (control === 'status') {
      ctx.ui.notify(describeGoal(state))
      return
    }
    if (state === null || state.status === 'cleared') {
      ctx.ui.notify('No goal exists in this session.', 'warning')
      return
    }
    clearContinuation()
    if (control === 'pause') {
      state = updateGoalStatus(state, 'paused', Date.now())
      persist(ctx)
      ctx.ui.notify('Goal is now paused.')
      return
    }
    if (control === 'clear') {
      state = updateGoalStatus(state, 'cleared', Date.now())
      persist(ctx)
      ctx.ui.notify('Goal cleared.')
      return
    }
    state = updateGoalStatus(state, 'active', Date.now())
    persist(ctx)
    ctx.ui.notify('Goal is now active.')
    sendGoalTurn(state, false, true)
  }

  pi.on('session_start', (_event, ctx) => {
    restore(ctx)
  })

  pi.on('session_tree', (_event, ctx) => {
    restore(ctx)
  })

  pi.on('session_shutdown', () => {
    clearContinuation()
  })

  pi.on('before_agent_start', (event) => {
    if (!isActive(state)) {
      return
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${goalInstructions(state)}` }
  })

  pi.on('agent_start', () => {
    if (currentTurn !== null) {
      return
    }
    currentTurn = pendingTurn ?? {
      goalId: isActive(state) ? state.id : null,
      isContinuation: false,
      usedTool: false,
    }
    pendingTurn = null
  })

  pi.on('tool_execution_end', () => {
    if (currentTurn !== null) {
      currentTurn.usedTool = true
    }
  })

  pi.on('agent_settled', (_event, ctx) => {
    const settledTurn = currentTurn
    currentTurn = null
    if (!isActive(state) || settledTurn?.goalId !== state.id) {
      return
    }
    state = settleGoalTurn(state, settledTurn.usedTool, settledTurn.isContinuation, Date.now())
    persist(ctx)
    queueContinuation(ctx)
  })

  pi.registerCommand('goal', {
    description: 'Create or control a long-running goal.',
    getArgumentCompletions(prefix) {
      return ['status', 'pause', 'resume', 'clear']
        .filter((value) => value.startsWith(prefix.trim()))
        .map((value) => ({ value, label: value }))
    },
    async handler(args, ctx) {
      const parsed = parseGoalCommand(args)
      if (parsed.kind === 'empty') {
        ctx.ui.notify('Usage: /goal <objective>', 'warning')
        return
      }
      if (parsed.kind === 'control') {
        if (parsed.control === 'resume' && !ctx.isIdle()) {
          ctx.abort()
          await ctx.waitForIdle()
        }
        controlGoal(parsed.control, ctx)
        if ((parsed.control === 'pause' || parsed.control === 'clear') && !ctx.isIdle()) {
          ctx.abort()
        }
        return
      }
      if (parsed.kind === 'recurring') {
        ctx.ui.notify('Recurring work belongs to /loop, not /goal.', 'warning')
        return
      }
      if (!ctx.isIdle()) {
        if (isActive(state)) {
          clearContinuation()
          state = updateGoalStatus(state, 'paused', Date.now())
          persist(ctx)
        }
        ctx.abort()
        await ctx.waitForIdle()
      }
      const created = replaceGoal(parsed.objective, ctx)
      if (parsed.removedTimeLimit) {
        ctx.ui.notify(
          'Time-limited goals are not supported yet. The goal omits the time limit.',
          'warning',
        )
      } else {
        ctx.ui.notify('Goal created.')
      }
      sendGoalTurn(created, false, true)
    },
  })

  pi.registerTool({
    name: 'get_goal',
    label: 'Get goal',
    description: 'Get the current long-running goal and its status.',
    promptSnippet: 'Inspect the current long-running goal',
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const now = Date.now()
      return {
        content: [{ type: 'text', text: describeGoal(state, now) }],
        details:
          state === null
            ? { exists: false }
            : {
                exists: true,
                objective: state.objective,
                status: state.status,
                activeDurationMs: activeDurationMs(state, now),
                continuationCount: state.continuationCount,
                idleContinuationsWithoutToolCalls: state.idleContinuationsWithoutToolCalls,
              },
      }
    },
  })

  pi.registerTool({
    name: 'create_goal',
    label: 'Create goal',
    description:
      'Create a long-running goal. Use this tool only when the user explicitly requests a goal.',
    promptSnippet: 'Create an explicitly requested long-running goal',
    parameters: Type.Object(
      { objective: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const objective = params.objective.trim()
      if (objective.length === 0) {
        return {
          content: [{ type: 'text', text: 'A goal objective cannot be blank.' }],
          details: { created: false },
        }
      }
      const replacesCurrentTurn = currentTurn?.goalId !== null && currentTurn?.goalId !== undefined
      const created = replaceGoal(objective, ctx)
      if (replacesCurrentTurn) {
        sendGoalTurn(created, false, true)
        ctx.abort()
      } else {
        currentTurn = { goalId: created.id, isContinuation: false, usedTool: true }
      }
      return {
        content: [{ type: 'text', text: 'Goal created.' }],
        details: { created: true, objective },
      }
    },
  })

  pi.registerTool({
    name: 'update_goal',
    label: 'Update goal',
    description:
      'Update the existing goal status. Complete it only after the objective is achieved. Only the user can pause it.',
    promptSnippet: 'Mark a goal active or complete',
    parameters: Type.Object(
      {
        status: Type.Union([Type.Literal('active'), Type.Literal('complete')]),
      },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const text = updateStatus(params.status, ctx)
      return {
        content: [{ type: 'text', text }],
        details: { updated: !text.startsWith('No goal'), status: state?.status ?? null },
      }
    },
  })
}
