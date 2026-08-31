import { describe, expect, test } from 'vite-plus/test'

import {
  createLoop,
  decodeLoopState,
  dispatchLoopIteration,
  type NewLoop,
  recordDynamicWake,
  recordFixedWake,
  recoverLoop,
  scheduleDynamicLoop,
  settleLoopIteration,
  stopLoop,
} from '../src/machine.ts'

const dynamicInput: NewLoop = {
  prompt: 'finish the task',
  schedule: { mode: 'dynamic', intervalMs: null, watch: null },
}

const fixedInput: NewLoop = {
  prompt: 'check CI',
  schedule: { mode: 'fixed', intervalMs: 300_000, watch: null },
}

describe('loop machine', () => {
  test('creates a dynamic loop with an immediate iteration', () => {
    expect(createLoop(dynamicInput, 100, 'loop-1')).toEqual({
      version: 1,
      id: 'loop-1',
      mode: 'dynamic',
      status: 'active',
      prompt: 'finish the task',
      intervalMs: null,
      watch: null,
      startedAt: 100,
      lastRunAt: 100,
      nextRunAt: null,
      iterations: 1,
      inFlight: true,
      pendingWake: false,
      stopReason: null,
    })
  })

  test('creates a fixed loop with an absolute first deadline', () => {
    const state = createLoop(fixedInput, 100, 'loop-2')
    expect(state).toMatchObject({
      iterations: 1,
      inFlight: true,
      nextRunAt: 300_100,
    })
  })

  test('advances fixed cadence from the prior deadline', () => {
    const state = createLoop(fixedInput, 100, 'loop-2')
    if (state.mode !== 'fixed') {
      throw new Error('Expected a fixed loop')
    }
    const firstWake = recordFixedWake(state, 300_150)
    expect(firstWake.nextRunAt).toBe(600_100)
    expect(firstWake.pendingWake).toBe(true)
    const lateWake = recordFixedWake(firstWake, 1_250_000)
    expect(lateWake.nextRunAt).toBe(1_500_100)
  })

  test('coalesces a dynamic wake until the current iteration settles', () => {
    const state = createLoop(dynamicInput, 100, 'loop-1')
    if (state.mode !== 'dynamic') {
      throw new Error('Expected a dynamic loop')
    }
    const scheduled = scheduleDynamicLoop(
      state,
      { delayMs: 30_000, prompt: null, watch: null },
      500,
    )
    const woke = recordDynamicWake(scheduled)
    expect(woke).toMatchObject({
      nextRunAt: null,
      pendingWake: true,
      inFlight: true,
    })
    const settled = settleLoopIteration(woke)
    const dispatched = dispatchLoopIteration(settled, 31_000)
    expect(dispatched).toMatchObject({
      iterations: 2,
      pendingWake: false,
      inFlight: true,
      lastRunAt: 31_000,
    })
  })

  test('changes the dynamic delay, prompt, and watcher', () => {
    const state = createLoop(dynamicInput, 100, 'loop-1')
    if (state.mode !== 'dynamic') {
      throw new Error('Expected a dynamic loop')
    }
    const scheduled = scheduleDynamicLoop(
      state,
      {
        delayMs: 30_000,
        prompt: 'check the new status',
        watch: { command: 'wait-for-ci', pattern: '^ready$' },
      },
      500,
    )
    expect(scheduled.nextRunAt).toBe(30_500)
    expect(scheduled.prompt).toBe('check the new status')
    expect(scheduled.watch).toEqual({ command: 'wait-for-ci', pattern: '^ready$' })
  })

  test('recovers without redispatching an uncertain in-flight iteration', () => {
    const state = createLoop(dynamicInput, 100, 'loop-1')
    expect(recoverLoop(state)).toMatchObject({
      iterations: 1,
      inFlight: false,
      pendingWake: false,
    })
  })

  test('stops an active loop', () => {
    const state = createLoop(dynamicInput, 100, 'loop-1')
    expect(stopLoop(state, 'work complete')).toMatchObject({
      status: 'stopped',
      nextRunAt: null,
      inFlight: false,
      pendingWake: false,
      stopReason: 'work complete',
      watch: null,
    })
  })

  test('decodes valid persisted state and rejects invalid state', () => {
    const state = createLoop(dynamicInput, 100, 'loop-1')
    expect(decodeLoopState(state)).toEqual(state)
    expect(decodeLoopState({ ...state, prompt: '' })).toBeNull()
    expect(
      decodeLoopState({
        ...state,
        mode: 'fixed',
        intervalMs: null,
      }),
    ).toBeNull()
  })
})
