import { describe, expect, test } from 'vite-plus/test'

import {
  formatClock,
  formatRelative,
  formatTimestampLine,
  isToolCallMessage,
} from '../src/timestamp.ts'

describe('message timestamps', () => {
  test('formats a zero-padded local clock', () => {
    const timestamp = new Date(2026, 0, 15, 9, 5, 3).getTime()
    expect(formatClock(timestamp)).toBe('09:05:03')
  })

  test('formats relative time', () => {
    const now = Date.now()
    expect(formatRelative(now - 4_000, now)).toBe('now')
    expect(formatRelative(now - 42_000, now)).toBe('42s ago')
    expect(formatRelative(now - 120_000, now)).toBe('2m ago')
    expect(formatRelative(now - 7_200_000, now)).toBe('2h ago')
    expect(formatRelative(now + 60_000, now)).toBe('now')
  })

  test('formats a timestamp line with its message role', () => {
    const timestamp = new Date(2026, 0, 15, 14, 32, 5).getTime()
    expect(
      formatTimestampLine({ kind: 'user', role: 'user', timestamp }, timestamp + 130_000),
    ).toBe('⏱ 14:32:05 (2m ago) · user message')
    expect(
      formatTimestampLine({ kind: 'assistant', role: 'assistant', timestamp }, timestamp),
    ).toBe('⏱ 14:32:05 (now) · ai response')
  })

  test('identifies assistant tool calls', () => {
    expect(isToolCallMessage({ stopReason: 'toolUse' })).toBe(true)
    expect(isToolCallMessage({ content: [{ type: 'text' }, { type: 'toolCall' }] })).toBe(true)
    expect(isToolCallMessage({ content: [{ type: 'text' }], stopReason: 'stop' })).toBe(false)
  })
})
