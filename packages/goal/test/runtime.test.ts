import { describe, expect, test } from 'vite-plus/test'

import { escapeXmlText, renderGoalPrompt, renderTrustedObjective } from '../src/prompts.ts'
import {
  GoalRuntime,
  type GoalReviewOutcome,
  type GoalRuntimeHost,
  goalTokenDelta,
} from '../src/runtime.ts'
import {
  cloneGoalState,
  createGoalLoop,
  type Goal,
  type GoalModeState,
  type GoalPersistMode,
  type GoalRuntimeEvent,
  type GoalTokenUsage,
  MAX_VERDICT_HISTORY,
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

function createState(
  goalOverrides: Partial<Goal> = {},
  stateOverrides: Partial<Pick<GoalModeState, 'enabled' | 'mode' | 'reason'>> = {},
): GoalModeState {
  return {
    enabled: true,
    mode: 'active',
    goal: createGoal(goalOverrides),
    loop: createGoalLoop(),
    ...stateOverrides,
  }
}

function reviewOutcome(overrides: Partial<GoalReviewOutcome> = {}): GoalReviewOutcome {
  return {
    status: 'FAIL',
    reason: 'A requirement is missing.',
    evidence: ['src/main.ts:10'],
    checks: [],
    reviewerModel: 'test/reviewer',
    report: '{"status":"FAIL"}',
    usage: createUsage(),
    ...overrides,
  }
}

interface HiddenMessage {
  customType: string
  content: string
  deliverAs?: 'steer' | 'followUp' | 'nextTurn'
}

function createHarness(
  initial: { state?: GoalModeState; usage?: GoalTokenUsage; now?: number } = {},
) {
  let state = initial.state === undefined ? undefined : cloneGoalState(initial.state)
  let usage = createUsage(initial.usage)
  let now = initial.now ?? 0
  let ids = 0
  const events: GoalRuntimeEvent[] = []
  const persists: { mode: GoalPersistMode; state?: GoalModeState }[] = []
  const hiddenMessages: HiddenMessage[] = []
  const host: GoalRuntimeHost = {
    getState: () => (state === undefined ? undefined : cloneGoalState(state)),
    setState: (next) => {
      state = next === undefined ? undefined : cloneGoalState(next)
    },
    getCurrentUsage: () => createUsage(usage),
    emit: (event) => {
      const cloned = event.state === undefined ? undefined : cloneGoalState(event.state)
      events.push(
        cloned === undefined
          ? { type: event.type, goal: event.goal ? { ...event.goal } : null }
          : { type: event.type, goal: event.goal ? { ...event.goal } : null, state: cloned },
      )
    },
    persist: (mode, persistedState) => {
      const cloned = persistedState === undefined ? undefined : cloneGoalState(persistedState)
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
    getState: () => (state === undefined ? undefined : cloneGoalState(state)),
    setState: (next: GoalModeState | undefined) => {
      state = next === undefined ? undefined : cloneGoalState(next)
    },
    setUsage: (next: Partial<GoalTokenUsage>) => {
      usage = createUsage(next)
    },
    advance: (milliseconds: number) => {
      now += milliseconds
    },
    events,
    persists,
    hiddenMessages,
  }
}

async function review(harness: ReturnType<typeof createHarness>, outcome: GoalReviewOutcome) {
  await harness.runtime.beginReview()
  return await harness.runtime.applyReview(outcome)
}

describe('goal runtime accounting', () => {
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
        createUsage({ input: 10, output: 5, cacheWrite: 2 }),
        createUsage({ input: 100, output: 50, cacheRead: 500, cacheWrite: 20 }),
      ),
    ).toBe(0)
  })

  test('accounts whole wall seconds and serializes token flushes', async () => {
    const harness = createHarness({ state: createState() })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(2_500)
    harness.setUsage({ input: 2, output: 3 })
    await Promise.all([
      harness.runtime.flushUsage('suppressed'),
      harness.runtime.flushUsage('suppressed'),
      harness.runtime.onAgentEnd({ currentUsage: createUsage({ input: 2, output: 3 }) }),
    ])
    expect(harness.getState()?.goal.tokensUsed).toBe(5)
    expect(harness.getState()?.goal.timeUsedSeconds).toBe(2)
    expect(harness.runtime.snapshot.wallClock.lastAccountedAt).toBe(2_000)
  })

  test('projects live usage without persistence or double counting after a flush', async () => {
    const harness = createHarness({ state: createState() })
    harness.runtime.onTurnStart('turn-live', createUsage())
    harness.advance(2500)
    harness.setUsage({ input: 2, output: 3, cacheRead: 900, cacheWrite: 1 })
    const writes = harness.persists.length
    expect(harness.runtime.liveUsage()).toEqual({ tokensUsed: 6, timeUsedSeconds: 2 })
    expect(harness.runtime.liveUsage()).toEqual({ tokensUsed: 6, timeUsedSeconds: 2 })
    expect(harness.persists).toHaveLength(writes)
    expect(harness.getState()?.goal.tokensUsed).toBe(0)
    await harness.runtime.flushUsage('suppressed')
    expect(harness.runtime.liveUsage()).toEqual({ tokensUsed: 6, timeUsedSeconds: 2 })
    await harness.runtime.onTaskAborted({ reason: 'interrupted' })
    harness.advance(10000)
    expect(harness.runtime.liveUsage()).toEqual({ tokensUsed: 6, timeUsedSeconds: 2 })
  })

  test('steers once when the token budget is reached', async () => {
    const harness = createHarness({
      state: createState({ tokenBudget: 10, tokensUsed: 8 }),
    })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.setUsage({ input: 2 })
    await harness.runtime.flushUsage('allowed')
    harness.setUsage({ input: 5 })
    await harness.runtime.flushUsage('allowed')
    expect(harness.getState()?.goal.status).toBe('budget-limited')
    expect(harness.hiddenMessages).toHaveLength(1)
    expect(harness.hiddenMessages[0]?.customType).toBe('goal-budget-limit')
  })

  test('pauses on interruption and preserves usage', async () => {
    const harness = createHarness({ state: createState() })
    harness.runtime.onTurnStart('turn-1', createUsage())
    harness.advance(1_000)
    harness.setUsage({ output: 4 })
    await harness.runtime.onTaskAborted({ reason: 'interrupted' })
    expect(harness.getState()).toMatchObject({
      enabled: false,
      goal: { status: 'paused', tokensUsed: 4, timeUsedSeconds: 1 },
      loop: { phase: 'between' },
    })
    expect(harness.persists.at(-1)?.mode).toBe('goal_paused')
  })
})

describe('goal review loop', () => {
  test('creates configured loop state with five reviews by default', async () => {
    const harness = createHarness()
    const standard = await harness.runtime.createGoal({ objective: 'Ship it' })
    expect(standard.loop).toMatchObject({
      iteration: 0,
      maxIterations: 5,
      phase: 'coding',
      runtimeProbe: false,
    })

    await harness.runtime.dropGoal()
    const configured = await harness.runtime.createGoal({
      objective: 'Ship it again',
      maxIterations: 9,
      reviewModel: 'provider/reviewer',
      reviewFallbackModel: 'provider/fallback',
      runtimeProbe: true,
    })
    expect(configured.loop).toMatchObject({
      maxIterations: 9,
      reviewModel: 'provider/reviewer',
      reviewFallbackModel: 'provider/fallback',
      runtimeProbe: true,
    })
  })

  test('treats complete as a review request', async () => {
    const harness = createHarness({ state: createState() })
    const requested = await harness.runtime.requestReviewFromTool()
    expect(requested.goal.status).toBe('active')
    expect(requested.loop.reviewRequested).toBe(true)
    expect(requested.mode).toBe('active')
  })

  test('only a PASS verdict completes the goal', async () => {
    const harness = createHarness({ state: createState({ tokenBudget: 10, tokensUsed: 9 }) })
    const application = await review(
      harness,
      reviewOutcome({
        status: 'PASS',
        reason: 'All requirements are verified.',
        usage: createUsage({ input: 2, output: 1 }),
      }),
    )
    expect(application?.decision.action).toBe('pass')
    expect(application?.state).toMatchObject({
      enabled: false,
      mode: 'exiting',
      reason: 'completed',
      goal: { status: 'complete', tokensUsed: 12 },
      loop: { iteration: 1, phase: 'between' },
    })
  })

  test('continues from reviewer findings and queued steering', async () => {
    const harness = createHarness({ state: createState() })
    await harness.runtime.beginReview()
    await harness.runtime.queueReviewSteering('Preserve the CLI output format.')
    const application = await harness.runtime.applyReview(reviewOutcome())
    expect(application?.decision.action).toBe('continue')
    expect(application?.state.loop.nextPrompt).toContain('A requirement is missing.')
    expect(application?.state.loop.nextPrompt).toContain('Preserve the CLI output format.')
    expect(application?.state.loop.pendingSteering).toEqual([])
    expect(application?.state.goal.status).toBe('active')
  })

  test('stops when the token budget expires without PASS', async () => {
    const harness = createHarness({ state: createState({ tokenBudget: 10, tokensUsed: 8 }) })
    const application = await review(harness, reviewOutcome({ usage: createUsage({ input: 3 }) }))
    expect(application?.decision.action).toBe('stuck')
    expect(application?.state.goal.status).toBe('stuck')
    expect(application?.state.loop.stopReason).toContain('Token budget exhausted')
  })

  test('requires three matching reviews and resets the audit on resume', async () => {
    const harness = createHarness({ state: createState() })
    const first = await review(
      harness,
      reviewOutcome({ reason: 'Missing behavior at src/a.ts:10.' }),
    )
    expect(first?.decision.action).toBe('continue')
    await harness.runtime.beginCodingTurn()
    const second = await review(
      harness,
      reviewOutcome({ reason: 'Missing behavior at src/a.ts:25.' }),
    )
    expect(second?.decision.action).toBe('continue')
    await harness.runtime.beginCodingTurn()
    const third = await review(
      harness,
      reviewOutcome({ reason: 'Missing behavior at src/a.ts:30.' }),
    )
    expect(third?.decision.action).toBe('stuck')
    expect(third?.state.loop.stopReason).toContain('same review failure')
    await harness.runtime.resumeGoal()
    await harness.runtime.beginCodingTurn()
    const resumed = await review(
      harness,
      reviewOutcome({ reason: 'Missing behavior at src/a.ts:30.' }),
    )
    expect(resumed?.decision.action).toBe('continue')
  })

  test('stops at the iteration cap and requires a larger cap before resume', async () => {
    const harness = createHarness()
    await harness.runtime.createGoal({ objective: 'Finish', maxIterations: 1 })
    const application = await review(harness, reviewOutcome())
    expect(application?.decision.action).toBe('stuck')
    await expect(harness.runtime.resumeGoal()).rejects.toThrow('Increase the iteration cap')
    await harness.runtime.setMaxIterations(2)
    const resumed = await harness.runtime.resumeGoal()
    expect(resumed.goal.status).toBe('active')
  })

  test('bounds persisted verdict history', async () => {
    const harness = createHarness()
    await harness.runtime.createGoal({ objective: 'Finish', maxIterations: 12 })
    for (let index = 0; index < MAX_VERDICT_HISTORY + 2; index += 1) {
      const application = await review(
        harness,
        reviewOutcome({ reason: `Distinct failure ${index}.` }),
      )
      expect(application?.decision.action).toBe('continue')
      await harness.runtime.beginCodingTurn()
    }
    expect(harness.getState()?.loop.iteration).toBe(MAX_VERDICT_HISTORY + 2)
    expect(harness.getState()?.loop.verdictHistory).toHaveLength(MAX_VERDICT_HISTORY)
    expect(harness.getState()?.loop.verdictHistory[0]?.reason).toBe('Distinct failure 2.')
  })

  test('drops state and emits the dropped goal', async () => {
    const harness = createHarness({ state: createState({ id: 'g-99' }) })
    const dropped = await harness.runtime.dropGoal()
    expect(dropped?.status).toBe('dropped')
    expect(harness.getState()).toBeUndefined()
    expect(harness.events.at(-1)?.goal?.status).toBe('dropped')
    expect(harness.persists.at(-1)?.mode).toBe('none')
  })
})

describe('goal prompt safety', () => {
  test('escapes XML-significant objective text', () => {
    const objective = 'Fix <root>&keep>safe'
    const prompt = renderGoalPrompt('active', createGoal({ objective }))
    expect(renderTrustedObjective(objective)).toBe(
      '<objective>\nFix &lt;root&gt;&amp;keep&gt;safe\n</objective>',
    )
    expect(prompt).toContain('Fix &lt;root&gt;&amp;keep&gt;safe')
    expect(prompt).not.toContain(objective)
    expect(escapeXmlText('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  test('renders review and budget values', () => {
    const prompt = renderGoalPrompt(
      'continuation',
      createGoal({ tokenBudget: 50, tokensUsed: 20 }),
      createGoalLoop({ maxIterations: 8 }),
    )
    expect(prompt).toContain('Token budget: 50')
    expect(prompt).toContain('Tokens remaining: 30')
    expect(prompt).toContain('Completed reviews: 0/8')
  })
})
