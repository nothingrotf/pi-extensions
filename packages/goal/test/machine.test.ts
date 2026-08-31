import { describe, expect, test } from 'vite-plus/test'

import {
  activeDurationMs,
  createGoal,
  decodeGoalState,
  dispatchContinuation,
  settleGoalTurn,
  updateGoalStatus,
} from '../src/machine.ts'

describe('goal machine', () => {
  test('accounts for active time across completion and reactivation', () => {
    const created = createGoal('ship release', 1_000, 'goal-1')
    const completed = updateGoalStatus(created, 'complete', 6_000)
    expect(completed).toMatchObject({
      status: 'complete',
      activeDurationMs: 5_000,
      lastAccruedAt: null,
    })
    expect(activeDurationMs(completed, 20_000)).toBe(5_000)

    const resumed = updateGoalStatus(completed, 'active', 20_000)
    expect(activeDurationMs(resumed, 23_000)).toBe(8_000)
    expect(updateGoalStatus(resumed, 'complete', 24_000).activeDurationMs).toBe(9_000)
  })

  test('counts idle continuation turns and resets the count after tool use', () => {
    const created = createGoal('verify deploy', 0, 'goal-1')
    const initial = settleGoalTurn(created, false, false, 1_000)
    expect(initial.idleContinuationsWithoutToolCalls).toBe(0)

    const firstContinuation = settleGoalTurn(initial, false, true, 2_000)
    expect(firstContinuation.idleContinuationsWithoutToolCalls).toBe(1)

    const withTool = settleGoalTurn(firstContinuation, true, true, 3_000)
    expect(withTool.idleContinuationsWithoutToolCalls).toBe(0)
    expect(dispatchContinuation(withTool).continuationCount).toBe(1)
  })

  test('rejects malformed persisted state', () => {
    expect(decodeGoalState({ version: 1, objective: 'missing fields' })).toBeNull()
  })
})
