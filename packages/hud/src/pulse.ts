import { animationTickMs } from './animation-clock.ts'
import { mixOklab, type Rgb } from './colors.ts'

export const pulsePeriodMs = 2_600
export const pulseStrongPeakMs = 260
export const pulseWeakPeakMs = 780
export const pulseFaint = '·'
export const pulseSolid = '●'

export type PulseFrame = {
  color: Rgb
  glyph: '·' | '●'
  intensity: number
}

export function pulseIntensity(time: number): number {
  const phase = (((time % pulsePeriodMs) + pulsePeriodMs) % pulsePeriodMs) / pulsePeriodMs
  const strong = Math.exp(-((phase - 0.1) ** 2) / 0.0016)
  const weak = 0.55 * Math.exp(-((phase - 0.3) ** 2) / 0.0024)
  return Math.min(1, strong + weak)
}

export function pulseIntensityAtTick(tick: number): number {
  return pulseIntensity(tick * animationTickMs)
}

export function pulseGlyph(time: number): '·' | '●' {
  return pulseIntensity(time) > 0.45 ? pulseSolid : pulseFaint
}

export function pulseFrame(tick: number, rest: Rgb, tint: Rgb): PulseFrame {
  const intensity = pulseIntensityAtTick(tick)
  return {
    color: mixOklab(rest, tint, intensity),
    glyph: intensity > 0.45 ? pulseSolid : pulseFaint,
    intensity,
  }
}
