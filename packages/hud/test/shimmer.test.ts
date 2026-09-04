import { describe, expect, test } from 'vite-plus/test'

import { ansiForeground, empryoBrandAlt, empryoTextPrimary } from '../src/colors.ts'
import {
  shimmerHighlights,
  shimmerPeriodMs,
  shimmerTextAtTick,
  shimmerTickMs,
} from '../src/shimmer.ts'

describe('shimmer wave', () => {
  test('returns one value per character', () => {
    expect(shimmerHighlights(10, 0)).toHaveLength(10)
  })

  test('returns nothing for an empty string', () => {
    expect(shimmerHighlights(0, 0)).toEqual([])
  })

  test('keeps every value inside the unit range', () => {
    for (let tick = 0; tick < 120; tick += 1) {
      for (const value of shimmerHighlights(40, tick)) {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    }
  })

  test('lights a narrow band, not the whole line', () => {
    const lit = shimmerHighlights(60, 0).filter((value) => value > 0).length
    expect(lit).toBeGreaterThan(0)
    expect(lit).toBeLessThanOrEqual(6)
  })

  test('starts the sweep at the middle of the line', () => {
    const values = shimmerHighlights(21, 0)
    const peak = values.indexOf(Math.max(...values))
    expect(peak).toBe(10)
  })

  test('sweeps back and forth instead of wrapping', () => {
    const peaks: number[] = []
    for (let tick = 0; tick < 60; tick += 1) {
      const values = shimmerHighlights(41, tick)
      peaks.push(values.indexOf(Math.max(...values)))
    }
    const rises = peaks.filter((value, index) => index > 0 && value > (peaks[index - 1] ?? 0))
    const falls = peaks.filter((value, index) => index > 0 && value < (peaks[index - 1] ?? 0))
    expect(rises.length).toBeGreaterThan(0)
    expect(falls.length).toBeGreaterThan(0)
  })

  test('never jumps from one end straight back to the other', () => {
    let previous = shimmerHighlights(41, 0).indexOf(1)
    for (let tick = 1; tick < 200; tick += 1) {
      const values = shimmerHighlights(41, tick)
      const peak = values.indexOf(Math.max(...values))
      expect(Math.abs(peak - previous)).toBeLessThan(20)
      previous = peak
    }
  })

  test('falls off linearly from the centre', () => {
    const values = shimmerHighlights(21, 0)
    const centre = values[10] ?? 0
    const oneAway = values[11] ?? 0
    const twoAway = values[12] ?? 0
    expect(centre).toBeGreaterThan(oneAway)
    expect(oneAway).toBeGreaterThan(twoAway)
    expect(centre - oneAway).toBeCloseTo(oneAway - twoAway, 5)
  })

  test('returns near its start after one period', () => {
    const first = shimmerHighlights(41, 0)
    const later = shimmerHighlights(41, Math.round(shimmerPeriodMs / shimmerTickMs))
    const drift = Math.abs(later.indexOf(Math.max(...later)) - first.indexOf(Math.max(...first)))
    expect(drift).toBeLessThanOrEqual(1)
  })

  test('the period is not a whole number of ticks', () => {
    expect(shimmerPeriodMs / shimmerTickMs).toBeCloseTo(52.36, 1)
  })

  test('advances every tick interval', () => {
    expect(shimmerTickMs).toBe(70)
  })

  test('uses one highlight position for a supplementary glyph', () => {
    const colors = {
      baseAnsi: ansiForeground(empryoTextPrimary),
      tintAnsi: ansiForeground(empryoBrandAlt),
    }
    expect(shimmerTextAtTick('\u{F031B}', colors, 0)).toBe(
      shimmerTextAtTick('\u{F031B}', colors, 13),
    )
  })

  test('matches the exact Oklab colors for the speaker name', () => {
    const painted = shimmerTextAtTick(
      ' 5.6 Sol',
      {
        baseAnsi: ansiForeground(empryoTextPrimary),
        tintAnsi: ansiForeground(empryoBrandAlt),
      },
      1,
    )
    const colorPattern = new RegExp(`${String.fromCharCode(27)}\\[38;2;(\\d+;\\d+;\\d+)m`, 'gu')
    const colors = Array.from(painted.matchAll(colorPattern), (match) => match[1])
    expect(colors).toEqual([
      '232;228;242',
      '208;218;242',
      '192;210;241',
      '179;204;241',
      '195;212;241',
      '211;219;242',
      '232;228;242',
    ])
  })
})
