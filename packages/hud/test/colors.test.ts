import { describe, expect, test } from 'vite-plus/test'

import {
  ansiForeground,
  assistantAnsi,
  buildRailPalette,
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

  test('uses the empryo-dark roles for the tones the theme defines', () => {
    const palette = buildRailPalette()
    expect(parseTrueColor(palette.arg)).toEqual({ b: 148, g: 119, r: 125 })
    expect(parseTrueColor(palette.dim)).toEqual({ b: 84, g: 62, r: 66 })
    expect(parseTrueColor(palette.branch)).toEqual({ b: 68, g: 43, r: 48 })
    expect(parseTrueColor(palette.head)).toEqual({ b: 192, g: 164, r: 170 })
    expect(parseTrueColor(palette.text)).toEqual({ b: 242, g: 228, r: 232 })
  })

  test('keeps the strand tones measured from the reference', () => {
    const palette = buildRailPalette()
    expect(parseTrueColor(palette.ok)).toEqual({ b: 131, g: 161, r: 128 })
    expect(parseTrueColor(palette.fail)).toEqual({ b: 116, g: 109, r: 169 })
    expect(parseTrueColor(palette.read)).toEqual({ b: 83, g: 129, r: 96 })
    expect(parseTrueColor(palette.shell)).toEqual({ b: 114, g: 80, r: 123 })
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
  test('matches accentAssistant and accentUser from empryo-dark', () => {
    expect(parseTrueColor(assistantAnsi())).toEqual({ b: 172, g: 105, r: 128 })
    expect(parseTrueColor(userAnsi())).toEqual({ b: 232, g: 203, r: 151 })
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
