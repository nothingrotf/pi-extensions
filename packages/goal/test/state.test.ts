import { describe, expect, test } from 'vite-plus/test'

import {
  createGoalLoop,
  decodeGoalModeEntry,
  encodeGoalModeEntry,
  type GoalModeState,
  restoreGoalModeState,
} from '../src/state.ts'

function activeState(): GoalModeState {
  return {
    enabled: true,
    mode: 'active',
    goal: {
      id: 'goal-1',
      objective: 'Ship release',
      status: 'active',
      tokensUsed: 12,
      timeUsedSeconds: 4,
      createdAt: 1,
      updatedAt: 2,
    },
    loop: createGoalLoop({ maxIterations: 9, reviewModel: 'test/reviewer' }),
  }
}

describe('goal persistence', () => {
  test('round trips version 3 state without shared references', () => {
    const source = activeState()
    const encoded = encodeGoalModeEntry('goal', source)
    expect(encoded).toMatchObject({
      version: 3,
      mode: 'goal',
      state: { loop: { maxIterations: 9, reviewModel: 'test/reviewer' } },
    })
    source.goal.objective = 'Changed later'
    const decoded = decodeGoalModeEntry(encoded)
    expect(decoded).not.toBeNull()
    if (decoded === null) return
    const restored = restoreGoalModeState(decoded)
    expect(restored?.goal.objective).toBe('Ship release')
  })

  test('migrates active version 2 entries into default loop state', () => {
    const decoded = decodeGoalModeEntry({
      version: 2,
      mode: 'goal',
      goal: {
        id: 'legacy',
        objective: 'Legacy goal',
        status: 'active',
        tokensUsed: 5,
        timeUsedSeconds: 2,
        createdAt: 1,
        updatedAt: 1,
      },
    })
    expect(decoded).not.toBeNull()
    if (decoded === null) return
    expect(restoreGoalModeState(decoded)).toMatchObject({
      enabled: true,
      goal: { status: 'active' },
      loop: { iteration: 0, maxIterations: 5, phase: 'coding' },
    })
  })

  test('normalizes interrupted review phase and paused mode', () => {
    const source = activeState()
    source.loop.phase = 'reviewing'
    const encoded = encodeGoalModeEntry('goal_paused', source)
    const decoded = decodeGoalModeEntry(encoded)
    expect(decoded).not.toBeNull()
    if (decoded === null) return
    expect(restoreGoalModeState(decoded)).toMatchObject({
      enabled: false,
      loop: { phase: 'between' },
    })
  })

  test('rejects unknown versions and extra state fields', () => {
    expect(decodeGoalModeEntry({ version: 99, mode: 'none' })).toBeNull()
    expect(decodeGoalModeEntry({ version: 3, mode: 'none', extra: true })).toBeNull()
  })
})
