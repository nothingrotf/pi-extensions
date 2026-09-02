import { describe, expect, test } from 'vite-plus/test'

import {
  formatClock,
  formatNumber,
  formatRelative,
  formatUsageRow,
  toUsageEntry,
} from '../src/timestamp.ts'

describe('usage rows', () => {
  test('formats a zero-padded local clock', () => {
    expect(formatClock(new Date(2026, 0, 15, 9, 5, 3).getTime())).toBe('09:05:03')
  })

  test('formats relative time', () => {
    const now = Date.now()
    expect(formatRelative(now - 4_000, now)).toBe('now')
    expect(formatRelative(now - 42_000, now)).toBe('42s ago')
    expect(formatRelative(now - 120_000, now)).toBe('2m ago')
    expect(formatRelative(now - 7_200_000, now)).toBe('2h ago')
    expect(formatRelative(now + 60_000, now)).toBe('now')
  })

  test('formats compact numbers', () => {
    expect(formatNumber(999)).toBe('999')
    expect(formatNumber(2_400)).toBe('2.4K')
    expect(formatNumber(254_000)).toBe('254K')
    expect(formatNumber(1_500_000)).toBe('1.5M')
  })

  test('formats the usage row like the reference', () => {
    const timestamp = new Date(2026, 8, 1, 11, 43, 23).getTime()
    expect(
      formatUsageRow(
        { cacheRead: 254_000, durationMs: 21_430, input: 2_400, output: 30, timestamp },
        timestamp + 130_000,
      ),
    ).toBe('11:43:23 (2m ago) · ⤵ 2.4K · ⤴ 30 · 💾 254K · ⚡ 1.4/s')
    expect(
      formatUsageRow({ cacheRead: 0, durationMs: 50, input: 10, output: 5, timestamp }, timestamp),
    ).toBe('11:43:23 (now) · ⤵ 10 · ⤴ 5')
  })

  test('maps assistant messages to usage entries', () => {
    expect(
      toUsageEntry(
        {
          role: 'assistant',
          timestamp: 500,
          usage: { cacheRead: 7, cacheWrite: 3, input: 2, output: 4 },
        },
        100,
        1_100,
      ),
    ).toEqual({ cacheRead: 7, durationMs: 1_000, input: 5, output: 4, timestamp: 500 })
    expect(toUsageEntry({ role: 'assistant' }, undefined, 9)).toEqual({
      cacheRead: 0,
      durationMs: undefined,
      input: 0,
      output: 0,
      timestamp: 9,
    })
  })
})
