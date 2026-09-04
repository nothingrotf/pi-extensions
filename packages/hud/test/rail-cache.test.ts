import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { RailComponent } from '../src/rail-entry.ts'
import { RailStore } from '../src/rail.ts'

const theme = { fg: (_color: string, text: string) => text }

describe('rail rendering cache', () => {
  test('reuses settled output until content, width, or theme changes', () => {
    const store = new RailStore()
    store.report('read', { doneLabel: 'Read', status: 'ok' })
    const component = new RailComponent(() => store, theme, false)
    const first = component.render(80)
    expect(component.render(80)).toBe(first)
    store.report('read', { detail: 'updated.ts' })
    const updated = component.render(80)
    expect(updated).not.toBe(first)
    expect(updated.map(stripTerminalSequences).join('\n')).toContain('updated.ts')
    expect(component.render(80)).toBe(updated)
    expect(component.render(40)).not.toBe(updated)
    const narrow = component.render(40)
    component.invalidate()
    expect(component.render(40)).not.toBe(narrow)
  })

  test('refreshes after child changes, removal, reset, and store replacement', () => {
    let store = new RailStore()
    store.report('parent', { doneLabel: 'Task', status: 'ok' })
    const component = new RailComponent(() => store, theme, true)
    const first = component.render(100)
    store.reportChild('parent', 'child', { doneLabel: 'Child', status: 'ok' })
    const child = component.render(100)
    expect(child).not.toBe(first)
    expect(child.map(stripTerminalSequences).join('\n')).toContain('Child')
    store.remove('parent')
    expect(component.render(100)).toEqual([])
    store.report('next', { doneLabel: 'Next', status: 'ok' })
    expect(component.render(100)).not.toEqual([])
    store.reset()
    expect(component.render(100)).toEqual([])
    store = new RailStore()
    store.report('replacement', { doneLabel: 'Replacement', status: 'ok' })
    expect(component.render(100).map(stripTerminalSequences).join('\n')).toContain('Replacement')
  })

  test('keeps pending rows animated and settled history stable across ticks', () => {
    const store = new RailStore()
    store.report('tool', { doneLabel: 'Read', status: 'pending' })
    let tick = 0
    const component = new RailComponent(
      () => store,
      theme,
      false,
      undefined,
      () => ({ row: undefined, shimmer: false, tick }),
    )
    const first = component.render(80)
    tick = 5
    expect(component.render(80)).not.toEqual(first)
    store.report('tool', { status: 'ok' })
    const settled = component.render(80)
    tick = 10
    expect(component.render(80)).toBe(settled)
  })

  test('retains grouped state for repeated reports and unchanged ordering', () => {
    const store = new RailStore(() => 0)
    store.report('read', { argGlyphs: ['ts'], doneLabel: 'Read', status: 'ok' })
    store.report('read', { argGlyphs: ['ts'], doneLabel: 'Read', status: 'ok' })
    const grouped = store.groups()
    const version = store.version()
    store.report('read', { argGlyphs: ['ts'], doneLabel: 'Read', status: 'ok' })
    store.reorder(['read'])
    expect(store.groups()).toBe(grouped)
    expect(store.version()).toBe(version)
    store.reportChild('read', 'child', { status: 'ok' })
    const withChild = store.groups()
    store.reportChild('read', 'child', { status: 'ok' })
    expect(store.groups()).toBe(withChild)
  })
})
