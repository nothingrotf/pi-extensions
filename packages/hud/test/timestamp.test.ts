import { describe, expect, test } from 'vite-plus/test'

import {
  formatClock,
  formatRelative,
  formatSpan,
  formatTokens,
  formatUsageRow,
  hasUsage,
  roleGlyph,
  roleLabel,
  toUsageEntry,
} from '../src/timestamp.ts'

describe('transcript rows', () => {
  test('formats a twelve hour clock', () => {
    expect(formatClock(new Date(2026, 0, 15, 9, 5, 3).getTime())).toBe('9:05 AM')
    expect(formatClock(new Date(2026, 0, 15, 22, 11, 0).getTime())).toBe('10:11 PM')
    expect(formatClock(new Date(2026, 0, 15, 0, 4, 0).getTime())).toBe('12:04 AM')
  })

  test('labels the two transcript roles', () => {
    expect(`${roleGlyph('user')} ${roleLabel('user')}`).toBe('◆ You')
    expect(`${roleGlyph('assistant')} ${roleLabel('assistant')}`).toBe('● Agent')
  })

  test('formats relative time', () => {
    const now = Date.now()
    expect(formatRelative(now - 4_000, now)).toBe('now')
    expect(formatRelative(now - 42_000, now)).toBe('42s ago')
    expect(formatRelative(now - 120_000, now)).toBe('2m ago')
    expect(formatRelative(now - 7_200_000, now)).toBe('2h ago')
    expect(formatRelative(now + 60_000, now)).toBe('now')
  })

  test('formats compact tokens and spans', () => {
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(2_400)).toBe('2.4k')
    expect(formatTokens(43_400)).toBe('43.4k')
    expect(formatTokens(1_500_000)).toBe('1.5m')
    expect(formatSpan(400)).toBe('400ms')
    expect(formatSpan(8_200)).toBe('8s')
    expect(formatSpan(62_000)).toBe('1m2s')
    expect(formatSpan(120_000)).toBe('2m')
  })

  test('formats the usage row like the reference', () => {
    const timestamp = new Date(2026, 8, 1, 11, 43, 23).getTime()
    expect(
      formatUsageRow({
        cacheRead: 40_400,
        durationMs: 8_200,
        input: 43_400,
        output: 165,
        timestamp,
      }),
    ).toBe('▪ 8s · 43.4k · 165 out · ⛁ 93% cached · ⚡20.1/s')
    expect(formatUsageRow({ cacheRead: 0, durationMs: 50, input: 10, output: 5, timestamp })).toBe(
      '▪ 50ms · 10 · 5 out',
    )
    expect(hasUsage({ cacheRead: 0, durationMs: 720, input: 0, output: 0, timestamp })).toBe(false)
    expect(hasUsage({ cacheRead: 0, durationMs: 720, input: 1, output: 0, timestamp })).toBe(true)
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
    ).toEqual({ cacheRead: 7, durationMs: 1_000, input: 12, output: 4, timestamp: 500 })
    expect(toUsageEntry({ role: 'assistant' }, undefined, 9)).toEqual({
      cacheRead: 0,
      durationMs: undefined,
      input: 0,
      output: 0,
      timestamp: 9,
    })
  })
})
