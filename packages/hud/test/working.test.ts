import { describe, expect, test } from 'vite-plus/test'

import {
  emptyRunTotals,
  formatUsageRow,
  hasUsage,
  toUsageEntry,
  type RunTotals,
} from '../src/timestamp.ts'
import { defaultWorkingMessage, formatWorkingFrame, WorkingStatus } from '../src/working.ts'

const escape = String.fromCharCode(27)
const ansiPattern = new RegExp(`${escape}\\[[0-9;]*m`, 'gu')
const plain = (line: string): string => line.replace(ansiPattern, '')

function totalsWith(overrides: Partial<RunTotals>): RunTotals {
  return { ...emptyRunTotals(), ...overrides }
}

describe('working row', () => {
  test('uses the model wait message before the elapsed delay', () => {
    const status = new WorkingStatus()
    const frame = status.frame(1_000, 2_999)
    expect(frame.message).toBe(defaultWorkingMessage)
    expect(frame.elapsed).toBeUndefined()
    expect(formatWorkingFrame(frame)).toMatch(/^⠧ waiting for the model$/u)
  })

  test('adds elapsed time after three seconds', () => {
    const status = new WorkingStatus()
    const frame = status.frame(1_000, 4_000)
    expect(frame.elapsed).toBe('3s')
    expect(formatWorkingFrame(frame)).toMatch(/^⠋ waiting for the model · 3s$/u)
  })

  test('accepts and clears an extension message', () => {
    const status = new WorkingStatus()
    status.setMessage('Waiting on 2 jobs')
    expect(status.overridden()).toBe(true)
    expect(formatWorkingFrame(status.frame(0, 3_000))).toContain('Waiting on 2 jobs')
    status.setMessage(undefined)
    expect(status.overridden()).toBe(false)
    expect(status.frame(0, 3_000).message).toBe(defaultWorkingMessage)
  })
})

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
