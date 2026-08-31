import { describe, expect, test } from 'vite-plus/test'

import { formatDuration, parseLoopInput } from '../src/policy.ts'

describe('loop input', () => {
  test('parses a prompt without an interval as dynamic', () => {
    expect(parseLoopInput('until done. if stuck, stop and write why.')).toEqual({
      ok: true,
      prompt: 'until done. if stuck, stop and write why.',
      schedule: { mode: 'dynamic', intervalMs: null, watch: null },
    })
  })

  test('parses a leading compact interval', () => {
    expect(parseLoopInput('5m check CI')).toEqual({
      ok: true,
      prompt: 'check CI',
      schedule: { mode: 'fixed', intervalMs: 300_000, watch: null },
    })
  })

  test('parses a trailing word interval', () => {
    expect(parseLoopInput('check deployment every 10 minutes')).toEqual({
      ok: true,
      prompt: 'check deployment',
      schedule: { mode: 'fixed', intervalMs: 600_000, watch: null },
    })
  })

  test('rejects an empty prompt', () => {
    expect(parseLoopInput(' ')).toEqual({
      ok: false,
      error: 'Usage: /loop [interval] <prompt>',
    })
  })

  test('rejects intervals shorter than one second', () => {
    expect(parseLoopInput('0.5s check')).toEqual({
      ok: false,
      error: 'Use an interval of at least 1s and include a prompt.',
    })
  })

  test('formats exact durations with the largest exact unit', () => {
    expect(formatDuration(1_000)).toBe('1s')
    expect(formatDuration(300_000)).toBe('5m')
    expect(formatDuration(10_800_000)).toBe('3h')
    expect(formatDuration(86_400_000)).toBe('1d')
  })
})
