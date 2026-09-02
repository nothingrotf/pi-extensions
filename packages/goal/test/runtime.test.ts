import { describe, expect, test } from 'vite-plus/test'

import { escapeXmlText, renderGoalPrompt, renderTrustedObjective } from '../src/prompts.ts'
import { GoalRuntime, type GoalRuntimeHost, goalTokenDelta } from '../src/runtime.ts'
import type {
  Goal,
  GoalModeState,
  GoalPersistMode,
  GoalRuntimeEvent,
  GoalTokenUsage,
} from '../src/state.ts'

function createUsage(overrides: Partial<GoalTokenUsage> = {}): GoalTokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...overrides }
}

function createGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'goal-1',
    objective: 'Ship <fast> & safely',
    status: 'active',
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function cloneState(state: GoalModeState | undefined): GoalModeState | undefined {
  return state ? { ...state, goal: { ...state.goal } } : undefined
}

interface HiddenMessage {
  customType: string
  content: string
  deliverAs?: 'steer' | 'followUp' | 'nextTurn'
}

function createHarness(
  initial: { state?: GoalModeState; usage?: GoalTokenUsage; now?: number } = {},
) {
  let state = cloneState(initial.state)
  let usage = createUsage(initial.usage)
  let now = initial.now ?? 0
  let ids = 0
  const events: GoalRuntimeEvent[] = []
  const persists: { mode: GoalPersistMode; state?: GoalModeState }[] = []
  const hiddenMessages: HiddenMessage[] = []
  const host: GoalRuntimeHost = {
    getState: () => cloneState(state),
    setState: (next) => {
      state = cloneState(next)
    },
    getCurrentUsage: () => createUsage(usage),
    emit: (event) => {
      const cloned = cloneState(event.state)
      events.push(
        cloned === undefined
          ? { type: event.type, goal: event.goal ? { ...event.goal } : null }
          : { type: event.type, goal: event.goal ? { ...event.goal } : null, state: cloned },
      )
    },
    persist: (mode, persistedState) => {
      const cloned = cloneState(persistedState)
      persists.push(cloned === undefined ? { mode } : { mode, state: cloned })
    },
    sendHiddenMessage: async (message) => {
      hiddenMessages.push({ ...message })
    },
    nextId: () => {
      ids += 1
      return `generated-${ids}`
    },
    now: () => now,
  }
  return {
    runtime: new GoalRuntime(host),
    getState: () => cloneState(state),
    setState: (next: GoalModeState | undefined) => {
      state = cloneState(next)
    },
    setUsage: (next: Partial<GoalTokenUsage>) => {
      usage = createUsage(next)
    },
    advance: (ms: number) => {
      now += ms
    },
    events,
    persists,
    hiddenMessages,
  }
}

describe('goal runtime', () => {
  test('counts cache writes but ignores cache reads in token deltas', () => {
    expect(
      goalTokenDelta(
        createUsage({ input: 13, output: 6, cacheRead: 999, cacheWrite: 8 }),
        createUsage({ input: 10, output: 4, cacheRead: 1, cacheWrite: 5 }),
      ),
    ).toBe(8)
  })

  test('clamps token deltas at zero across usage resets', () => {
    expect(
      goalTokenDelta(
        createUsage({ input: 10, output: 5, cacheRead: 0, cacheWrite: 2 }),
        createUsage({ input: 100, output: 50, cacheRead: 500, cacheWrite: 20 }),
      ),
    ).toBe(0)
  })

  test('advances wall-clock accounting only by persisted whole seconds', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })

    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(2_500)
    harness.setUsage({ input: 1 })
    await harness.runtime.flushUsage('suppressed')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(2)
    expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(2_000)
    expect(harness.persists).toHaveLength(1)

    harness.advance(400)
    await harness.runtime.flushUsage('suppressed')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(2)
    expect(harness.persists).toHaveLength(1)

    harness.advance(700)
    harness.setUsage({ input: 2 })
    await harness.runtime.flushUsage('suppressed')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(3)
    expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(3_000)
    expect(harness.persists).toHaveLength(2)
  })

  test('does not persist snapshots on wall-clock-only flushes', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(2_500)
    await harness.runtime.flushUsage('suppressed')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(2)
    expect(harness.persists).toHaveLength(0)
  })

  test('persists wall-clock-only usage before internal aborts', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(2_500)
    await harness.runtime.onTaskAborted({ reason: 'internal' })
    expect(harness.getState()?.enabled).toBe(true)
    expect(harness.getState()?.goal.status).toBe('active')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(2)
    expect(harness.persists).toHaveLength(1)
    expect(harness.persists[0]).toMatchObject({
      mode: 'goal',
      state: { goal: { timeUsedSeconds: 2 } },
    })
  })

  test('resets the wall-clock baseline when preserving an active goal after a no-goal switch', async () => {
    const goal = createGoal()
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setState(undefined)
    harness.advance(10_000)
    harness.setState({ enabled: true, mode: 'active', goal })

    const resumed = await harness.runtime.onThreadResumed({ preserveActiveGoal: true })
    harness.advance(1_000)
    await harness.runtime.flushUsage('suppressed')

    expect(resumed?.goal.status).toBe('active')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(1)
    expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(11_000)
  })

  test('clears stale accounting when reconciling to a no-goal session', async () => {
    const goal = createGoal()
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setState(undefined)
    harness.runtime.clearAccounting()
    harness.advance(10_000)
    harness.setState({ enabled: true, mode: 'active', goal })

    await harness.runtime.onThreadResumed({ preserveActiveGoal: true })
    harness.advance(1_000)
    await harness.runtime.flushUsage('suppressed')
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(1)
    expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(11_000)
  })

  test('steers only once until a budget mutation resets the cycle', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ tokenBudget: 10, tokensUsed: 8 }),
      },
    })

    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setUsage({ input: 2 })
    await harness.runtime.flushUsage('allowed')
    expect(harness.getState()?.goal.status).toBe('budget-limited')
    expect(harness.hiddenMessages).toHaveLength(1)
    expect(harness.hiddenMessages[0]).toMatchObject({
      customType: 'goal-budget-limit',
      deliverAs: 'steer',
    })

    harness.setUsage({ input: 5 })
    await harness.runtime.flushUsage('allowed')
    expect(harness.hiddenMessages).toHaveLength(1)

    await harness.runtime.onBudgetMutated(20)
    expect(harness.getState()?.enabled).toBe(true)
    expect(harness.getState()?.goal.status).toBe('active')
    expect(harness.getState()?.goal.tokenBudget).toBe(20)
    expect(harness.hiddenMessages).toHaveLength(1)

    harness.setUsage({ input: 15 })
    await harness.runtime.flushUsage('allowed')
    expect(harness.getState()?.goal.status).toBe('budget-limited')
    expect(harness.hiddenMessages).toHaveLength(2)
  })

  test('pauses an active goal when an interruption aborts the task', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(1_000)
    harness.setUsage({ output: 4 })
    await harness.runtime.onTaskAborted({ reason: 'interrupted' })

    const state = harness.getState()
    expect(state?.enabled).toBe(false)
    expect(state?.goal.status).toBe('paused')
    expect(state?.goal.tokensUsed).toBe(4)
    expect(state?.goal.timeUsedSeconds).toBe(1)
    expect(harness.persists.at(-1)?.mode).toBe('goal_paused')
  })

  test('auto-pauses active goals when a thread resumes', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    const resumed = await harness.runtime.onThreadResumed()
    expect(resumed?.enabled).toBe(false)
    expect(resumed?.goal.status).toBe('paused')
    expect(harness.persists.at(-1)?.mode).toBe('goal_paused')
  })

  test('preserves an active goal during internal reconciliation', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    const resumed = await harness.runtime.onThreadResumed({ preserveActiveGoal: true })
    expect(resumed?.enabled).toBe(true)
    expect(resumed?.goal.status).toBe('active')
    expect(harness.persists).toHaveLength(0)
  })

  test('escapes XML in goal helpers and rendered prompts', () => {
    const objective = 'Fix <root>&keep>safe'
    const prompt = renderGoalPrompt('active', createGoal({ objective }))
    expect(renderTrustedObjective(objective)).toBe(
      '<objective>\nFix &lt;root&gt;&amp;keep&gt;safe\n</objective>',
    )
    expect(prompt).toContain('Fix &lt;root&gt;&amp;keep&gt;safe')
    expect(prompt).not.toContain(objective)
  })

  test('escapes only the XML-significant characters', () => {
    const plain = 'plain text with \'quotes\' and "double" plus unicode ✓'
    expect(escapeXmlText(plain)).toBe(plain)
    expect(escapeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  test('renders budget values for bounded and unbounded goals', () => {
    const bounded = renderGoalPrompt(
      'continuation',
      createGoal({ tokenBudget: 50, tokensUsed: 20 }),
    )
    expect(bounded).toContain('Token budget: 50')
    expect(bounded).toContain('Tokens remaining: 30')
    const unbounded = renderGoalPrompt('continuation', createGoal())
    expect(unbounded).toContain('Token budget: none')
    expect(unbounded).toContain('Tokens remaining: unbounded')
  })

  test('flips active to budget-limited and steers when the budget drops below usage', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ tokenBudget: 100, tokensUsed: 30 }),
      },
    })
    const next = await harness.runtime.onBudgetMutated(20)
    expect(next?.goal.status).toBe('budget-limited')
    expect(next?.goal.tokenBudget).toBe(20)
    expect(next?.goal.tokensUsed).toBe(30)
    expect(harness.hiddenMessages).toHaveLength(1)
    expect(harness.hiddenMessages[0]?.customType).toBe('goal-budget-limit')
  })

  test('removes the budget when mutated to off', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ tokenBudget: 100, tokensUsed: 30 }),
      },
    })
    const next = await harness.runtime.onBudgetMutated(undefined)
    expect(next?.goal.tokenBudget).toBeUndefined()
    expect(next?.goal.tokensUsed).toBe(30)
  })

  test('completes from the tool with mode exiting', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ tokenBudget: 100, tokensUsed: 42, timeUsedSeconds: 7 }),
      },
    })
    const completed = await harness.runtime.completeGoalFromTool()
    expect(completed.status).toBe('complete')
    const state = harness.getState()
    expect(state?.enabled).toBe(false)
    expect(state?.mode).toBe('exiting')
    expect(state?.reason).toBe('completed')
  })

  test('drops the goal, emits the dropped goal, and clears persisted state', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ id: 'g-99', objective: 'Ship soon' }),
      },
    })
    const dropped = await harness.runtime.dropGoal()
    expect(dropped?.status).toBe('dropped')
    expect(dropped?.id).toBe('g-99')
    expect(harness.getState()).toBeUndefined()
    const lastEvent = harness.events.at(-1)
    expect(lastEvent?.goal?.status).toBe('dropped')
    expect(lastEvent?.state?.enabled).toBe(false)
    expect(harness.persists.at(-1)?.mode).toBe('none')
  })

  test('rejects create when a non-dropped goal already exists', async () => {
    const harness = createHarness({
      state: { enabled: true, mode: 'active', goal: createGoal({ objective: 'Existing' }) },
    })
    await expect(harness.runtime.createGoal({ objective: 'Second' })).rejects.toThrow(
      'cannot create a new goal because this session already has a goal',
    )
  })

  test('rejects create with a blank objective or invalid budget', async () => {
    const harness = createHarness()
    await expect(harness.runtime.createGoal({ objective: '   ' })).rejects.toThrow(
      'objective is required when op=create',
    )
    await expect(harness.runtime.createGoal({ objective: 'x', tokenBudget: 0 })).rejects.toThrow(
      'token_budget must be a positive integer when provided',
    )
  })

  test('replaces an active goal with a fresh active goal', async () => {
    const harness = createHarness({
      state: {
        enabled: true,
        mode: 'active',
        goal: createGoal({ objective: 'Existing', tokenBudget: 100 }),
      },
    })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(1_000)
    harness.setUsage({ input: 12 })

    const next = await harness.runtime.replaceGoal({ objective: 'Second', tokenBudget: 25 })
    expect(next.enabled).toBe(true)
    expect(next.goal.objective).toBe('Second')
    expect(next.goal.status).toBe('active')
    expect(next.goal.tokenBudget).toBe(25)
    expect(next.goal.tokensUsed).toBe(0)
    expect(next.goal.timeUsedSeconds).toBe(0)
    expect(next.goal.id).not.toBe('goal-1')
    expect(harness.persists.at(-1)?.state?.goal.objective).toBe('Second')
  })

  test('rejects replace when no goal is active', async () => {
    const harness = createHarness({
      state: { enabled: false, mode: 'active', goal: createGoal({ status: 'paused' }) },
    })
    await expect(harness.runtime.replaceGoal({ objective: 'Second' })).rejects.toThrow(
      'cannot replace goal because no goal is active',
    )
  })

  test('allows a new goal after the previous one is complete', async () => {
    const harness = createHarness({
      state: {
        enabled: false,
        mode: 'exiting',
        reason: 'completed',
        goal: createGoal({ status: 'complete' }),
      },
    })
    const next = await harness.runtime.createGoal({ objective: 'Phase 4' })
    expect(next.goal.objective).toBe('Phase 4')
    expect(next.goal.status).toBe('active')
    expect(next.enabled).toBe(true)
  })

  test('completes a paused goal', async () => {
    const harness = createHarness({
      state: {
        enabled: false,
        mode: 'active',
        goal: createGoal({ status: 'paused', tokensUsed: 30 }),
      },
    })
    const completed = await harness.runtime.completeGoalFromTool()
    expect(completed.status).toBe('complete')
    expect(harness.getState()?.mode).toBe('exiting')
  })

  test('rejects resume of a complete goal and complete of a missing goal', async () => {
    const completeHarness = createHarness({
      state: {
        enabled: false,
        mode: 'exiting',
        reason: 'completed',
        goal: createGoal({ status: 'complete' }),
      },
    })
    await expect(completeHarness.runtime.resumeGoal()).rejects.toThrow('Goal is already complete.')
    const emptyHarness = createHarness()
    await expect(emptyHarness.runtime.completeGoalFromTool()).rejects.toThrow(
      'cannot complete goal because no goal is active',
    )
    await expect(emptyHarness.runtime.resumeGoal()).rejects.toThrow('No paused goal.')
  })

  test('ignores tool completions for the goal tool and paused goals', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setUsage({ output: 3 })
    await harness.runtime.onToolCompleted('goal')
    expect(harness.getState()?.goal.tokensUsed).toBe(0)
    await harness.runtime.onToolCompleted('read')
    expect(harness.getState()?.goal.tokensUsed).toBe(3)
  })

  test('serializes overlapping accounting calls', async () => {
    const harness = createHarness({ state: { enabled: true, mode: 'active', goal: createGoal() } })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setUsage({ output: 5 })
    await Promise.all([
      harness.runtime.flushUsage('suppressed'),
      harness.runtime.flushUsage('suppressed'),
      harness.runtime.onAgentEnd({ currentUsage: createUsage({ output: 5 }) }),
    ])
    expect(harness.getState()?.goal.tokensUsed).toBe(5)
  })
})
