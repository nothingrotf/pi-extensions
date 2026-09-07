import { describe, expect, test } from 'vite-plus/test'

import {
  ansiForeground,
  applyOpacity,
  assistantAnsi,
  buildRailPalette,
  categoryColors,
  defaultHudPalette,
  hudBrand,
  hudBrandAlt,
  hudBrandDim,
  hudTextDim,
  hudTextFaint,
  hudTextMuted,
  hudTextPrimary,
  hudTextSecondary,
  mixOklab,
  oklabLightness,
  paletteFromTheme,
  parseTrueColor,
  railPaletteFromAnsi,
  tint,
  userAnsi,
} from '../src/colors.ts'
import { blankPalette } from './helpers.ts'

describe('parseTrueColor', () => {
  test('reads a 24-bit foreground escape', () => {
    expect(parseTrueColor('\x1b[38;2;248;124;73m')).toEqual({ b: 73, g: 124, r: 248 })
  })

  test('returns undefined for 256-color escapes', () => {
    expect(parseTrueColor('\x1b[38;5;214m')).toBeUndefined()
  })
})

describe('buildRailPalette', () => {
  test('exposes every tone as a true color', () => {
    for (const ansi of Object.values(buildRailPalette())) {
      expect(parseTrueColor(ansi)).toBeDefined()
    }
  })

  test('uses the system-dark semantic tokens', () => {
    const palette = buildRailPalette()
    expect(parseTrueColor(palette.arg)).toEqual({ b: 192, g: 164, r: 170 })
    expect(parseTrueColor(palette.dim)).toEqual({ b: 114, g: 88, r: 93 })
    expect(parseTrueColor(palette.faint)).toEqual({ b: 84, g: 62, r: 66 })
    expect(parseTrueColor(palette.branch)).toEqual({ b: 84, g: 62, r: 66 })
    expect(parseTrueColor(palette.head)).toEqual({ b: 192, g: 164, r: 170 })
    expect(parseTrueColor(palette.text)).toEqual({ b: 242, g: 228, r: 232 })
  })

  test('derives the exact system-dark category colors', () => {
    const palette = buildRailPalette()
    expect(parseTrueColor(palette.ok)).toEqual({ b: 171, g: 216, r: 159 })
    expect(parseTrueColor(palette.fail)).toEqual({ b: 154, g: 140, r: 239 })
    expect(parseTrueColor(palette.read)).toEqual({ b: 104, g: 173, r: 115 })
    expect(parseTrueColor(palette.shell)).toEqual({ b: 155, g: 104, r: 173 })
    expect(parseTrueColor(palette.genome)).toEqual({ b: 104, g: 173, r: 155 })
    expect(parseTrueColor(palette.web)).toEqual({ b: 139, g: 173, r: 104 })
  })

  test('matches the settled HUD colors', () => {
    const palette = buildRailPalette(0.75)
    expect(parseTrueColor(palette.branch)).toEqual({ b: 63, g: 46, r: 49 })
    expect(parseTrueColor(palette.ok)).toEqual({ b: 128, g: 162, r: 119 })
    expect(parseTrueColor(palette.read)).toEqual({ b: 78, g: 130, r: 86 })
    expect(parseTrueColor(palette.shell)).toEqual({ b: 116, g: 78, r: 130 })
    expect(parseTrueColor(palette.arg)).toEqual({ b: 144, g: 123, r: 127 })
    expect(parseTrueColor(palette.dim)).toEqual({ b: 85, g: 66, r: 70 })
    expect(parseTrueColor(palette.groupCaret)).toEqual({ b: 111, g: 89, r: 94 })
  })

  test('separates the argument tone from the summary tone', () => {
    const palette = buildRailPalette()
    expect(palette.arg).not.toBe(palette.dim)
    expect(palette.read).not.toBe(palette.shell)
  })

  test('ignores the accent and stays fixed', () => {
    expect(railPaletteFromAnsi()).toEqual(buildRailPalette())
  })
})

describe('role accents', () => {
  test('matches accentAssistant and accentUser from system-dark', () => {
    expect(parseTrueColor(assistantAnsi())).toEqual({ b: 172, g: 105, r: 128 })
    expect(parseTrueColor(userAnsi())).toEqual({ b: 232, g: 203, r: 151 })
  })

  test('exposes the exact speaker animation colors', () => {
    expect(hudBrand).toEqual({ b: 172, g: 105, r: 128 })
    expect(hudBrandAlt).toEqual({ b: 240, g: 199, r: 167 })
    expect(hudBrandDim).toEqual({ b: 69, g: 40, r: 46 })
    expect(hudTextDim).toEqual({ b: 114, g: 88, r: 93 })
    expect(hudTextFaint).toEqual({ b: 84, g: 62, r: 66 })
    expect(hudTextMuted).toEqual({ b: 148, g: 119, r: 125 })
    expect(hudTextPrimary).toEqual({ b: 242, g: 228, r: 232 })
    expect(hudTextSecondary).toEqual({ b: 192, g: 164, r: 170 })
  })
})

describe('applyOpacity', () => {
  test('uses the same eight-bit opacity quantization as OpenTUI', () => {
    expect(applyOpacity({ b: 84, g: 62, r: 66 }, 0.75)).toEqual({ b: 63, g: 46, r: 49 })
  })
})

describe('mixOklab', () => {
  test('matches the Oklab interpolation', () => {
    expect(mixOklab(hudTextDim, hudBrandAlt, 0.22)).toEqual({ b: 140, g: 111, r: 109 })
    expect(mixOklab(hudTextPrimary, hudBrandAlt, 0.55)).toEqual({
      b: 241,
      g: 212,
      r: 196,
    })
    expect(mixOklab(hudBrandDim, hudBrand, 0.45)).toEqual({ b: 113, g: 68, r: 81 })
  })

  test('clamps both ends', () => {
    expect(mixOklab(hudBrandDim, hudBrand, -1)).toEqual(hudBrandDim)
    expect(mixOklab(hudBrandDim, hudBrand, 2)).toEqual(hudBrand)
  })
})

describe('tint', () => {
  test('wraps text with the tone and a reset', () => {
    const palette = railPaletteFromAnsi()
    const value = tint(palette, 'agent', 'Task')
    expect(value.startsWith(palette.agent)).toBe(true)
    expect(value.endsWith('\x1b[39m')).toBe(true)
  })

  test('leaves text untouched for an empty tone', () => {
    expect(tint(blankPalette(), 'agent', 'Read')).toBe('Read')
  })

  test('formats a foreground escape', () => {
    expect(ansiForeground({ b: 3, g: 2, r: 1 })).toBe('\x1b[38;2;1;2;3m')
  })
})

describe('paletteFromTheme', () => {
  const empryoDark = new Map<string, string>([
    ['accent', '#8069ac'],
    ['borderMuted', '#2e2845'],
    ['dim', '#5d5872'],
    ['error', '#ef8c9a'],
    ['mdLink', '#a7c7f0'],
    ['mdQuoteBorder', '#423e54'],
    ['muted', '#7d7794'],
    ['success', '#9fd8ab'],
    ['syntaxType', '#97cbe8'],
    ['text', '#e8e4f2'],
    ['toolOutput', '#aaa4c0'],
    ['warning', '#f0c48f'],
  ])
  const hexAnsi = (hex: string) =>
    `\x1b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`
  const themeLike = (colors: Map<string, string>) => ({
    getFgAnsi: (token: string) => {
      const hex = colors.get(token)
      return hex === undefined ? '' : hexAnsi(hex)
    },
  })

  test('reproduces the built-in palette from the empryo-dark theme tokens', () => {
    const palette = paletteFromTheme(themeLike(empryoDark))
    const { background: _background, ...tokens } = palette
    const { background: _defaultBackground, ...expected } = defaultHudPalette
    expect(tokens).toEqual(expected)
  })

  test('falls back to the built-in colors for terminal default tokens', () => {
    expect(paletteFromTheme(themeLike(new Map()))).toEqual(defaultHudPalette)
    expect(paletteFromTheme(undefined)).toBe(defaultHudPalette)
  })

  test('follows a theme change through the same theme object', () => {
    const colors = new Map(empryoDark)
    const theme = themeLike(colors)
    const first = paletteFromTheme(theme)
    expect(paletteFromTheme(theme)).toBe(first)
    colors.set('accent', '#ff0000')
    const second = paletteFromTheme(theme)
    expect(second).not.toBe(first)
    expect(second.brand).toEqual({ b: 0, g: 0, r: 255 })
    expect(second.file).not.toEqual(first.file)
  })

  test('derives category colors with the reference hue offsets', () => {
    expect(categoryColors(hudBrand, { b: 154, g: 140, r: 239 })).toEqual({
      file: { b: 104, g: 173, r: 115 },
      genome: { b: 104, g: 173, r: 155 },
      shell: { b: 155, g: 104, r: 173 },
      web: { b: 139, g: 173, r: 104 },
    })
  })
})

describe('paletteFromTheme text tiers', () => {
  test('derives readable tiers when a theme reuses one quiet color', () => {
    const quiet = '\x1b[38;2;74;79;87m'
    const palette = paletteFromTheme({
      getFgAnsi: (token: string) =>
        token === 'accent' ? '\x1b[38;2;165;180;252m' : token === 'text' ? '' : quiet,
    })
    expect(palette.textPrimary).toEqual(hudTextPrimary)
    expect(palette.textDim).toEqual({ b: 87, g: 79, r: 74 })
    expect(oklabLightness(palette.textSecondary)).toBeGreaterThan(oklabLightness(palette.textMuted))
    expect(oklabLightness(palette.textMuted)).toBeGreaterThan(oklabLightness(palette.textDim))
    expect(oklabLightness(palette.textDim)).toBeGreaterThan(oklabLightness(palette.textFaint))
  })
})
