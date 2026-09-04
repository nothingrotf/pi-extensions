import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import {
  ansiForeground,
  empryoBrand,
  empryoBrandAlt,
  empryoBrandDim,
  empryoTextFaint,
  empryoTextPrimary,
} from '../src/colors.ts'
import {
  formatSpeakerClock,
  SpeakerHeaderComponent,
  speakerHeaderLine,
  speakerMotionEnabled,
  type SpeakerHeaderData,
  type SpeakerHeaderFrame,
} from '../src/speaker-header.ts'

const escape = String.fromCharCode(27)
const ansiPattern = new RegExp(`${escape}\\[[0-9;]*m`, 'gu')
const theme = { bold: (text: string) => `\x1b[1m${text}\x1b[22m` }
const timestamp = new Date(2026, 0, 15, 9, 5, 3).getTime()
const assistant: SpeakerHeaderData = {
  assistant: true,
  glyph: '●',
  label: 'Empryo',
  timestamp,
}

function plain(text: string): string {
  return text.replace(ansiPattern, '')
}

function frame(patch: Partial<SpeakerHeaderFrame> = {}): SpeakerHeaderFrame {
  return {
    active: true,
    motion: true,
    tick: 0,
    timestamp,
    ...patch,
  }
}

describe('speaker header', () => {
  test('formats the clock with the system two-digit locale', () => {
    expect(formatSpeakerClock(timestamp)).toBe(
      new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    )
  })

  test('renders the settled assistant header', () => {
    const line = speakerHeaderLine(assistant, theme, undefined, 0)
    expect(plain(line)).toBe(`● Empryo · ${formatSpeakerClock(timestamp)}`)
    expect(line).toContain(`${ansiForeground(empryoBrand)}●`)
    expect(line).toContain(`\x1b[1m${ansiForeground(empryoTextPrimary)} Empryo`)
    expect(line).toContain(`${ansiForeground(empryoTextFaint)} · `)
  })

  test('renders the static user header', () => {
    const line = speakerHeaderLine(
      { assistant: false, glyph: '◆', label: 'You', timestamp },
      theme,
      undefined,
      0,
    )
    expect(plain(line)).toBe(`◆ You · ${formatSpeakerClock(timestamp)}`)
    expect(line).toContain('\x1b[38;2;151;203;232m◆')
  })

  test('starts live output at the exact rest frame', () => {
    const line = speakerHeaderLine(assistant, theme, frame(), 0)
    expect(plain(line)).toBe(`· Empryo · ${formatSpeakerClock(timestamp)}`)
    expect(line).toContain(`${ansiForeground(empryoBrandDim)}·`)
    expect(line).toContain(`\x1b[1m${ansiForeground(empryoTextPrimary)} Empryo`)
    expect(line).not.toContain(ansiForeground(empryoBrandAlt))
  })

  test('animates the glyph color and name after one tick', () => {
    const line = speakerHeaderLine(assistant, theme, frame({ tick: 1 }), 0)
    expect(plain(line)).toBe(`· Empryo · ${formatSpeakerClock(timestamp)}`)
    expect(line).not.toContain(`${ansiForeground(empryoBrandDim)}·`)
    expect(line).not.toContain(`${ansiForeground(empryoBrand)}·`)
    expect(line.split('\x1b[38;2;').length).toBeGreaterThan(4)
  })

  test('uses the solid glyph above the exact threshold', () => {
    expect(plain(speakerHeaderLine(assistant, theme, frame({ tick: 4 }), 0)).startsWith('● ')).toBe(
      true,
    )
  })

  test('keeps the live name bold including its leading space', () => {
    const line = speakerHeaderLine(assistant, theme, frame({ tick: 4 }), 0)
    expect(line).toContain('\x1b[1m\x1b[38;2;')
    const bold = line.slice(line.indexOf('\x1b[1m'), line.indexOf('\x1b[22m'))
    expect(plain(bold)).toBe(' Empryo')
  })

  test('uses the live message timestamp when supplied', () => {
    const later = timestamp + 3_600_000
    const line = speakerHeaderLine(assistant, theme, frame({ timestamp: later }), 0)
    expect(plain(line)).toContain(formatSpeakerClock(later))
  })

  test('uses the static fallback when motion is disabled', () => {
    const line = speakerHeaderLine(assistant, theme, frame({ motion: false, tick: 4 }), 0)
    expect(plain(line).startsWith('● Empryo')).toBe(true)
    expect(line).toContain(`${ansiForeground(empryoBrand)}●`)
    expect(line.split('\x1b[38;2;')).toHaveLength(4)
  })
})

describe('SpeakerHeaderComponent', () => {
  test('repaints and settles without remounting', () => {
    let current = frame({ tick: 10 })
    const component = new SpeakerHeaderComponent(assistant, theme, () => current)
    const initial = component.render(40)[0] ?? ''
    current = frame({ tick: 11 })
    const animated = component.render(40)[0] ?? ''
    current = frame({ active: false, tick: 11 })
    const settled = component.render(40)[0] ?? ''

    expect(plain(initial).startsWith('· Empryo')).toBe(true)
    expect(animated).not.toBe(initial)
    expect(plain(settled).startsWith('● Empryo')).toBe(true)
    expect(settled.split('\x1b[38;2;')).toHaveLength(4)
    expect(visibleWidth(settled)).toBe(40)
  })

  test('does not add horizontal padding', () => {
    const component = new SpeakerHeaderComponent(assistant, theme)
    expect(plain(component.render(40)[0] ?? '').startsWith('● Empryo')).toBe(true)
  })

  test('can hide an existing header without remounting', () => {
    let visible = true
    const component = new SpeakerHeaderComponent(assistant, theme, undefined, () => visible)
    expect(component.render(40)).toHaveLength(1)
    visible = false
    expect(component.render(40)).toEqual([])
  })
})

describe('speaker motion gate', () => {
  test('enables motion by default', () => {
    expect(speakerMotionEnabled({})).toBe(true)
  })

  test('disables motion for any NO_MOTION value', () => {
    expect(speakerMotionEnabled({ NO_MOTION: '1' })).toBe(false)
    expect(speakerMotionEnabled({ NO_MOTION: '0' })).toBe(false)
  })

  test('disables motion for EMPRYO_NO_MOTION=1 only', () => {
    expect(speakerMotionEnabled({ EMPRYO_NO_MOTION: '1' })).toBe(false)
    expect(speakerMotionEnabled({ EMPRYO_NO_MOTION: 'true' })).toBe(true)
  })
})
