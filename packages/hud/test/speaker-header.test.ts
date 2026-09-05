import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import {
  ansiForeground,
  hudBrand,
  hudBrandAlt,
  hudBrandDim,
  hudTextFaint,
  hudTextMuted,
  hudTextPrimary,
} from '../src/colors.ts'
import {
  formatSpeakerClock,
  SpeakerHeaderComponent,
  speakerHeaderLine,
  speakerMotionEnabled,
  speakerWaitingLine,
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
  label: 'Assistant',
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
  test('tolerates invalid timestamps in restored history', () => {
    for (const timestamp of [Number.NaN, Number.POSITIVE_INFINITY, 1e20]) {
      expect(formatSpeakerClock(timestamp)).toBe(new Date(timestamp).toLocaleTimeString())
    }
  })

  test('reuses settled headers but refreshes after invalidation and resizing', () => {
    const component = new SpeakerHeaderComponent(assistant, theme)
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    expect(component.render(40)).not.toBe(first)
    const narrow = component.render(40)
    component.invalidate()
    expect(component.render(40)).not.toBe(narrow)
  })

  test('formats the clock with the system two-digit locale', () => {
    expect(formatSpeakerClock(timestamp)).toBe(
      new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    )
  })

  test('renders the settled assistant header', () => {
    const line = speakerHeaderLine(assistant, theme, undefined, 0)
    expect(plain(line)).toBe(`● Assistant · ${formatSpeakerClock(timestamp)}`)
    expect(line).toContain(`${ansiForeground(hudBrand)}●`)
    expect(line).toContain(`\x1b[1m${ansiForeground(hudTextPrimary)} Assistant`)
    expect(line).toContain(`${ansiForeground(hudTextFaint)} · `)
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
    expect(plain(line)).toBe(`· Assistant · ${formatSpeakerClock(timestamp)}`)
    expect(line).toContain(`${ansiForeground(hudBrandDim)}·`)
    expect(line).toContain(`\x1b[1m${ansiForeground(hudTextPrimary)} Assistant`)
    expect(line).not.toContain(ansiForeground(hudBrandAlt))
  })

  test('animates the glyph color and name after one tick', () => {
    const line = speakerHeaderLine(assistant, theme, frame({ tick: 1 }), 0)
    expect(plain(line)).toBe(`· Assistant · ${formatSpeakerClock(timestamp)}`)
    expect(line).not.toContain(`${ansiForeground(hudBrandDim)}·`)
    expect(line).not.toContain(`${ansiForeground(hudBrand)}·`)
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
    expect(plain(bold)).toBe(' Assistant')
  })

  test('uses the live message timestamp when supplied', () => {
    const later = timestamp + 3_600_000
    const line = speakerHeaderLine(assistant, theme, frame({ timestamp: later }), 0)
    expect(plain(line)).toContain(formatSpeakerClock(later))
  })

  test('uses the static fallback when motion is disabled', () => {
    const line = speakerHeaderLine(assistant, theme, frame({ motion: false, tick: 4 }), 0)
    expect(plain(line).startsWith('● Assistant')).toBe(true)
    expect(line).toContain(`${ansiForeground(hudBrand)}●`)
    expect(line.split('\x1b[38;2;')).toHaveLength(4)
  })

  test('styles the waiting spinner as transcript metadata', () => {
    const line = speakerWaitingLine({
      elapsed: '30s',
      message: 'waiting for the model',
      spinner: '⠏',
    })
    expect(plain(line)).toBe('⠏ waiting for the model · 30s')
    expect(line).toContain(`${ansiForeground(hudBrandDim)}⠏`)
    expect(line).toContain(`${ansiForeground(hudTextMuted)} waiting for the model`)
    expect(line).toContain(`${ansiForeground(hudTextFaint)} · 30s`)
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

    expect(plain(initial).trimStart().startsWith('· Assistant')).toBe(true)
    expect(animated).not.toBe(initial)
    expect(plain(settled).trimStart().startsWith('● Assistant')).toBe(true)
    expect(settled.split('\x1b[38;2;')).toHaveLength(4)
    expect(visibleWidth(settled)).toBe(40)
  })

  test('keeps the header at the transcript edge', () => {
    const component = new SpeakerHeaderComponent(assistant, theme)
    const line = plain(component.render(40)[0] ?? '')
    expect(line.startsWith('● Assistant')).toBe(true)
    expect(visibleWidth(line)).toBe(40)
  })

  test('places waiting in the body slot until the response starts', () => {
    let current = frame({
      waiting: { elapsed: '30s', message: 'waiting for the model', spinner: '⠏' },
    })
    const component = new SpeakerHeaderComponent(assistant, theme, () => current)
    const waiting = component.render(40)
    expect(waiting).toHaveLength(3)
    expect(plain(waiting[1] ?? '').startsWith('   ⠏ waiting for the model · 30s')).toBe(true)
    expect(visibleWidth(waiting[1] ?? '')).toBe(40)
    expect(plain(waiting[2] ?? '').trim()).toBe('')

    current = frame({ tick: 1 })
    expect(component.render(40)).toHaveLength(1)
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
})
