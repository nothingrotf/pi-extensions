import { describe, expect, test } from 'vite-plus/test'

import {
  emptyRunTotals,
  formatUsageRow,
  hasUsage,
  toUsageEntry,
  type RunTotals,
} from '../src/timestamp.ts'

const escape = String.fromCharCode(27)
const ansiPattern = new RegExp(`${escape}\\[[0-9;]*m`, 'gu')
const plain = (line: string): string => line.replace(ansiPattern, '')

function totalsWith(overrides: Partial<RunTotals>): RunTotals {
  return { ...emptyRunTotals(), ...overrides }
}

describe('live usage row', () => {
  test('stays hidden before any tokens arrive', () => {
    const entry = toUsageEntry(emptyRunTotals(), 1000)
    expect(hasUsage(entry)).toBe(false)
  })

  test('appears as soon as the first tokens land', () => {
    const entry = toUsageEntry(totalsWith({ input: 120, startedAt: 0 }), 1000)
    expect(hasUsage(entry)).toBe(true)
    expect(formatUsageRow(entry)).toContain('120 in')
  })

  test('reports the elapsed span from the turn start', () => {
    const entry = toUsageEntry(totalsWith({ input: 1, startedAt: 0 }), 26_000)
    expect(plain(formatUsageRow(entry))).toContain('26s')
  })

  test('grows the elapsed span as the turn runs', () => {
    const totals = totalsWith({ input: 1, startedAt: 0 })
    const early = plain(formatUsageRow(toUsageEntry(totals, 5_000)))
    const later = plain(formatUsageRow(toUsageEntry(totals, 65_000)))
    expect(early).toContain('5s')
    expect(later).toContain('1m')
  })

  test('starts with the marker glyph', () => {
    const entry = toUsageEntry(totalsWith({ input: 10, startedAt: 0 }), 1000)
    expect(formatUsageRow(entry).startsWith('\u25AA')).toBe(true)
  })

  test('reports the cache share once a cache read lands', () => {
    const entry = toUsageEntry(totalsWith({ cacheRead: 99, input: 100, startedAt: 0 }), 1000)
    expect(formatUsageRow(entry)).toContain('99% cached')
  })

  test('reports a zero cache share when nothing was cached', () => {
    const entry = toUsageEntry(totalsWith({ input: 100, startedAt: 0 }), 1000)
    expect(formatUsageRow(entry)).toContain('0% cached')
  })

  test('separates every field with the same separator', () => {
    const entry = toUsageEntry(
      totalsWith({ cacheRead: 50, cost: 0.25, input: 100, output: 20, startedAt: 0 }),
      10_000,
    )
    const row = plain(formatUsageRow(entry))
    expect(row.split(' \u00B7 ').length).toBeGreaterThanOrEqual(5)
  })
})
