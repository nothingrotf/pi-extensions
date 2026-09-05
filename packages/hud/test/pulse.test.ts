import { describe, expect, test } from 'vite-plus/test'

import { hudBrand, hudBrandDim } from '../src/colors.ts'
import {
  pulseFaint,
  pulseFrame,
  pulseGlyph,
  pulseIntensity,
  pulsePeriodMs,
  pulseSolid,
} from '../src/pulse.ts'
import { shimmerPeriodMs, shimmerText } from '../src/shimmer.ts'

describe('pulse', () => {
  test('stays inside the unit range', () => {
    for (let time = 0; time < pulsePeriodMs * 2; time += 13) {
      const value = pulseIntensity(time)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  test('beats twice per period', () => {
    const peaks: number[] = []
    let rising = false
    let previous = pulseIntensity(0)
    for (let time = 1; time <= pulsePeriodMs; time += 1) {
      const value = pulseIntensity(time)
      if (value > previous) rising = true
      else if (rising) {
        peaks.push(time - 1)
        rising = false
      }
      previous = value
    }
    expect(peaks).toHaveLength(2)
  })

  test('matches the exact extracted curve samples', () => {
    expect(pulseIntensity(0)).toBeCloseTo(0.001930454136227736, 12)
    expect(pulseIntensity(260)).toBe(1)
    expect(pulseIntensity(780)).toBeCloseTo(0.5500000000138879, 12)
  })

  test('places the first beat near a tenth of the period', () => {
    expect(pulseIntensity(pulsePeriodMs * 0.1)).toBeCloseTo(1, 1)
  })

  test('makes the second beat weaker than the first', () => {
    const first = pulseIntensity(pulsePeriodMs * 0.1)
    const second = pulseIntensity(pulsePeriodMs * 0.3)
    expect(second).toBeLessThan(first)
    expect(second).toBeGreaterThan(0.5)
  })

  test('rests for most of the period', () => {
    expect(pulseIntensity(pulsePeriodMs * 0.6)).toBeLessThan(0.01)
    expect(pulseIntensity(pulsePeriodMs * 0.9)).toBeLessThan(0.01)
  })

  test('repeats every period', () => {
    for (const offset of [0, 200, 700, 1500]) {
      expect(pulseIntensity(offset)).toBeCloseTo(pulseIntensity(offset + pulsePeriodMs), 9)
    }
  })

  test('handles a negative time', () => {
    expect(pulseIntensity(-100)).toBeCloseTo(pulseIntensity(pulsePeriodMs - 100), 9)
  })

  test('shows the solid glyph on a beat', () => {
    expect(pulseGlyph(pulsePeriodMs * 0.1)).toBe(pulseSolid)
    expect(pulseGlyph(pulsePeriodMs * 0.3)).toBe(pulseSolid)
  })

  test('shows the faint glyph at rest', () => {
    expect(pulseGlyph(pulsePeriodMs * 0.6)).toBe(pulseFaint)
    expect(pulseGlyph(pulsePeriodMs * 0.9)).toBe(pulseFaint)
  })

  test('spends most of the period faint', () => {
    let solid = 0
    for (let time = 0; time < pulsePeriodMs; time += 10) {
      if (pulseGlyph(time) === pulseSolid) solid += 1
    }
    expect(solid / (pulsePeriodMs / 10)).toBeCloseTo(0.12, 1)
  })

  test('mixes the pulse color in Oklab', () => {
    expect(pulseFrame(1, hudBrandDim, hudBrand)).toMatchObject({
      color: { b: 72, g: 42, r: 49 },
      glyph: pulseFaint,
    })
  })
})

describe('live header composition', () => {
  const theme = {
    getFgAnsi: (color: string) =>
      color === 'accent' ? '\x1b[38;2;170;164;192m' : '\x1b[38;2;66;62;84m',
  }

  test('the pulsing glyph replaces the static one while active', () => {
    const glyphs = new Set<string>()
    for (let time = 0; time < pulsePeriodMs; time += 20) glyphs.add(pulseGlyph(time))
    expect(glyphs).toEqual(new Set([pulseSolid, pulseFaint]))
  })

  test('the name shimmers with more than one colour', () => {
    const painted = shimmerText('Agent', theme, 0)
    expect(painted.split('\x1b[38;2;').length).toBeGreaterThan(2)
  })

  test('the shimmered name keeps every character', () => {
    const painted = shimmerText('Agent', theme, 1234)
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu')
    expect(painted.replace(ansi, '')).toBe('Agent')
  })

  test('the glyph and the shimmer run on different periods', () => {
    expect(pulsePeriodMs).not.toBe(Math.round(shimmerPeriodMs))
  })
})
