import type { Theme } from '@earendil-works/pi-coding-agent'

import { ansiForeground, ansiReset, parseTrueColor, type Rgb } from './colors.ts'

export type ShimmerTheme = Pick<Theme, 'getFgAnsi'>

export const shimmerTickMs = 70

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

function mix(base: Rgb, tint: Rgb, amount: number): Rgb {
  const clamped = Math.max(0, Math.min(1, amount))
  return {
    b: Math.round(base.b + (tint.b - base.b) * clamped),
    g: Math.round(base.g + (tint.g - base.g) * clamped),
    r: Math.round(base.r + (tint.r - base.r) * clamped),
  }
}

export function shimmerText(text: string, theme: ShimmerTheme, time = Date.now()): string {
  const characters = Array.from(text)
  if (characters.length === 0) return ''
  const baseAnsi = theme.getFgAnsi('dim')
  const tintAnsi = theme.getFgAnsi('accent')
  const base = parseTrueColor(baseAnsi)
  const tint = parseTrueColor(tintAnsi)
  const tick = Math.floor(time / shimmerTickMs)
  const highlights = shimmerHighlights(characters.length, tick)

  if (base === undefined || tint === undefined) {
    let output = ''
    let openAnsi: string | undefined
    characters.forEach((character, index) => {
      const wanted = (highlights[index] ?? 0) > 0 ? tintAnsi : baseAnsi
      if (wanted !== openAnsi) {
        if (openAnsi !== undefined) output += ansiReset
        output += wanted
        openAnsi = wanted
      }
      output += character
    })
    return openAnsi === undefined ? output : `${output}${ansiReset}`
  }

  let output = ''
  let openAnsi: string | undefined
  characters.forEach((character, index) => {
    const highlight = highlights[index] ?? 0
    const wanted =
      highlight <= 0
        ? baseAnsi
        : ansiForeground(mix(base, tint, blendFloor + blendRange * highlight))
    if (wanted !== openAnsi) {
      if (openAnsi !== undefined) output += ansiReset
      output += wanted
      openAnsi = wanted
    }
    output += character
  })
  return openAnsi === undefined ? output : `${output}${ansiReset}`
}
