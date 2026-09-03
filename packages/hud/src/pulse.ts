export const pulsePeriodMs = 2600

const firstPeak = 0.1
const firstSpread = 0.0016
const secondPeak = 0.3
const secondSpread = 0.0024
const secondWeight = 0.55
const solidThreshold = 0.45

export const pulseSolid = '\u25CF'
export const pulseFaint = '\u00B7'

export function pulseIntensity(time: number): number {
  const phase = (((time % pulsePeriodMs) + pulsePeriodMs) % pulsePeriodMs) / pulsePeriodMs
  const first = Math.exp(-((phase - firstPeak) ** 2) / firstSpread)
  const second = secondWeight * Math.exp(-((phase - secondPeak) ** 2) / secondSpread)
  return Math.min(1, first + second)
}

export function pulseGlyph(time: number): string {
  return pulseIntensity(time) > solidThreshold ? pulseSolid : pulseFaint
}
