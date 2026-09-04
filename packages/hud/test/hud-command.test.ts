import { describe, expect, test } from 'vite-plus/test'

import { hudCommandCompletions, parseHudCommand, resolveToggle } from '../src/hud-command.ts'

describe('parseHudCommand', () => {
  test('opens the settings picker without arguments', () => {
    expect(parseHudCommand('')).toEqual({ kind: 'pick' })
  })

  test('parses each HUD setting', () => {
    expect(parseHudCommand('rail')).toEqual({ kind: 'rail', mode: 'toggle' })
    expect(parseHudCommand('rail off')).toEqual({ kind: 'rail', mode: 'off' })
    expect(parseHudCommand('thinking rail')).toEqual({ kind: 'thinking', mode: 'rail' })
    expect(parseHudCommand('thinking inline')).toEqual({ kind: 'thinking', mode: 'inline' })
    expect(parseHudCommand('timestamps on')).toEqual({ kind: 'timestamps', mode: 'on' })
    expect(parseHudCommand('sound ask bell')).toEqual({ args: 'ask bell', kind: 'sound' })
  })

  test('rejects unknown settings and modes', () => {
    expect(parseHudCommand('unknown')).toEqual({ kind: 'invalid' })
    expect(parseHudCommand('rail maybe')).toEqual({ kind: 'invalid' })
    expect(parseHudCommand('thinking on')).toEqual({ kind: 'invalid' })
  })
})

describe('resolveToggle', () => {
  test('resolves explicit and relative modes', () => {
    expect(resolveToggle(false, 'on')).toBe(true)
    expect(resolveToggle(true, 'off')).toBe(false)
    expect(resolveToggle(true, 'toggle')).toBe(false)
  })
})

describe('hudCommandCompletions', () => {
  test('completes top-level settings', () => {
    expect(hudCommandCompletions('th')).toEqual([{ label: 'thinking', value: 'thinking' }])
  })

  test('completes setting modes', () => {
    expect(hudCommandCompletions('rail o')).toEqual([
      { label: 'on', value: 'rail on' },
      { label: 'off', value: 'rail off' },
    ])
  })

  test('keeps sound completion values under the HUD namespace', () => {
    expect(hudCommandCompletions('sound fo')).toContainEqual({
      label: 'focus',
      value: 'sound focus',
    })
  })
})
