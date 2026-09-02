import { describe, expect, test } from 'vite-plus/test'

import {
  consumeRepeatIteration,
  createRepeatLimit,
  describeRepeatLimit,
  describeRepeatLimitConfig,
  enableRepeat,
  isRepeatExpired,
  parseRepeatArgs,
} from '../src/repeat.ts'

describe('repeat argument parsing', () => {
  test('parses counts, durations, compound durations, and prompts', () => {
    expect(parseRepeatArgs('')).toEqual({ ok: true, args: { between: 'prompt' } })
    expect(parseRepeatArgs('10')).toEqual({
      ok: true,
      args: { between: 'prompt', limit: { kind: 'iterations', iterations: 10 } },
    })
    expect(parseRepeatArgs('10 minutes fix it')).toEqual({
      ok: true,
      args: {
        between: 'prompt',
        limit: { kind: 'duration', durationMs: 600_000 },
        prompt: 'fix it',
      },
    })
    expect(parseRepeatArgs('1h30m')).toEqual({
      ok: true,
      args: { between: 'prompt', limit: { kind: 'duration', durationMs: 5_400_000 } },
    })
    expect(parseRepeatArgs('keep going')).toEqual({
      ok: true,
      args: { between: 'prompt', prompt: 'keep going' },
    })
    expect(parseRepeatArgs('compact 3 retry')).toEqual({
      ok: true,
      args: { between: 'compact', limit: { kind: 'iterations', iterations: 3 }, prompt: 'retry' },
    })
    expect(parseRepeatArgs('COMPACT')).toEqual({ ok: true, args: { between: 'compact' } })
  })

  test('rejects limit-shaped tokens that do not parse', () => {
    expect(parseRepeatArgs('-1')).toMatchObject({ ok: false })
    expect(parseRepeatArgs('0')).toEqual({
      ok: false,
      error: 'Loop count must be a positive integer.',
    })
    expect(parseRepeatArgs('10x')).toEqual({
      ok: false,
      error: 'Loop duration unit must be seconds, minutes, or hours.',
    })
    expect(parseRepeatArgs('0 minutes')).toEqual({
      ok: false,
      error: 'Loop duration must be positive.',
    })
    expect(parseRepeatArgs('1.5h')).toMatchObject({ ok: false })
  })
})

describe('repeat limits', () => {
  test('consumes iterations and reports exhaustion', () => {
    let state = enableRepeat({ between: 'prompt', limit: { kind: 'iterations', iterations: 2 } }, 0)
    const first = consumeRepeatIteration(state, 0)
    expect(first.ok).toBe(true)
    if (first.ok) {
      state = first.state
    }
    const second = consumeRepeatIteration(state, 0)
    expect(second.ok).toBe(true)
    if (second.ok) {
      state = second.state
    }
    expect(state.iterations).toBe(2)
    expect(consumeRepeatIteration(state, 0)).toEqual({ ok: false, reason: 'Loop limit reached.' })
  })

  test('expires durations at the deadline', () => {
    const state = enableRepeat(
      { between: 'prompt', limit: { kind: 'duration', durationMs: 1_000 } },
      100,
    )
    expect(isRepeatExpired(state, 1_099)).toBe(false)
    expect(isRepeatExpired(state, 1_100)).toBe(true)
    expect(consumeRepeatIteration(state, 1_100)).toEqual({
      ok: false,
      reason: 'Loop time limit reached.',
    })
    expect(createRepeatLimit(undefined, 0)).toBeNull()
  })

  test('describes limits', () => {
    expect(describeRepeatLimitConfig({ kind: 'iterations', iterations: 1 })).toBe('1 iteration')
    expect(describeRepeatLimitConfig({ kind: 'duration', durationMs: 3_600_000 })).toBe('1 hour')
    expect(describeRepeatLimitConfig({ kind: 'duration', durationMs: 90_000 })).toBe('90 seconds')
    expect(describeRepeatLimit({ kind: 'iterations', initial: 5, remaining: 2 })).toBe(
      '2 of 5 iterations remaining',
    )
    expect(describeRepeatLimit({ kind: 'duration', durationMs: 120_000, deadlineMs: 0 })).toBe(
      '2 minutes limit',
    )
  })
})
