import type { Theme } from '@earendil-works/pi-coding-agent'

import { animationTickMs } from './animation-clock.ts'
import { ansiForeground, ansiReset, mixOklab, parseTrueColor } from './colors.ts'

export type ShimmerTheme = Pick<Theme, 'getFgAnsi'>

export type ShimmerColors = {
  baseAnsi: string
  tintAnsi: string
}

export const shimmerTickMs = animationTickMs

const waveSpeed = 0.12
const bandHalfWidth = 2.5
const blendFloor = 0.22
const blendRange = 0.62

export const shimmerPeriodMs = ((2 * Math.PI) / waveSpeed) * shimmerTickMs

export function shimmerHighlights(length: number, tick: number): number[] {
  if (length <= 0) return []
  const centre = (Math.sin(tick * waveSpeed) * 0.5 + 0.5) * (length - 1)
  return Array.from({ length }, (_value, index) =>
    Math.max(0, 1 - Math.abs(index - centre) / bandHalfWidth),
  )
}

export function shimmerTextAtTick(text: string, colors: ShimmerColors, tick: number): string {
  const characters = Array.from(text)
  if (characters.length === 0) return ''
  const { baseAnsi, tintAnsi } = colors
  const base = parseTrueColor(baseAnsi)
  const tint = parseTrueColor(tintAnsi)
  const highlights = shimmerHighlights(text.length, tick)

  let output = ''
  let openAnsi: string | undefined
  characters.forEach((character, index) => {
    const highlight = highlights[index] ?? 0
    const wanted =
      base === undefined || tint === undefined
        ? highlight > 0
          ? tintAnsi
          : baseAnsi
        : highlight <= 0
          ? baseAnsi
          : ansiForeground(mixOklab(base, tint, blendFloor + blendRange * highlight))
    if (wanted !== openAnsi) {
      if (openAnsi !== undefined) output += ansiReset
      output += wanted
      openAnsi = wanted
    }
    output += character
  })
  return openAnsi === undefined ? output : `${output}${ansiReset}`
}

export function shimmerText(text: string, theme: ShimmerTheme, time = Date.now()): string {
  return shimmerTextAtTick(
    text,
    { baseAnsi: theme.getFgAnsi('dim'), tintAnsi: theme.getFgAnsi('accent') },
    Math.floor(time / shimmerTickMs),
  )
}
