import { beforeAll, describe, expect, test } from 'vite-plus/test'

import { setIconMode } from '../src/icons.ts'
import { decodeRailEntry, RailComponent, type RailThemeSource } from '../src/rail-entry.ts'
import { RailStore } from '../src/rail.ts'

const theme: RailThemeSource = {
  fg: (_color, text) => text,
}

const escape = String.fromCharCode(27)
const ansiPattern = new RegExp(`${escape}\\[[0-9;]*m`, 'gu')

function plain(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(ansiPattern, ''))
}

beforeAll(() => {
  setIconMode('ascii')
})

describe('decodeRailEntry', () => {
  test('reads the turn from a valid entry', () => {
    expect(decodeRailEntry({ turn: 3 })).toBe(3)
  })

  test('rejects malformed data', () => {
    expect(decodeRailEntry({})).toBeUndefined()
    expect(decodeRailEntry({ turn: -1 })).toBeUndefined()
    expect(decodeRailEntry('3')).toBeUndefined()
  })
})

describe('RailComponent', () => {
  test('renders nothing while the store is not resolvable yet', () => {
    const component = new RailComponent(() => undefined, theme, false)
    expect(component.render(80)).toEqual([])
  })

  test('renders the rail once the same component can resolve its store', () => {
    const stores = new Map<number, RailStore>()
    const component = new RailComponent(() => stores.get(1), theme, false)
    expect(component.render(80)).toEqual([])
    const store = new RailStore()
    store.report('a', {
      category: 'read',
      detail: 'a.ts',
      doneLabel: 'Read',
      iconKey: 'read',
      status: 'ok',
    })
    stores.set(1, store)
    const lines = plain(component.render(80))
    expect(lines[0]).toBe(' 1 action ▾')
    expect(lines[1]).toBe(' ╰─ ✓ □ Read a.ts')
  })

  test('keeps a right gutter so durations clear the scrollbar', () => {
    const store = new RailStore()
    store.report('a', {
      category: 'read',
      detail: 'a.ts',
      doneLabel: 'Read',
      durationMs: 1500,
      iconKey: 'read',
      status: 'ok',
    })
    const component = new RailComponent(() => store, theme, false)
    const width = 40
    const lines = plain(component.render(width))
    expect(lines[1]?.endsWith('1.5s')).toBe(true)
    expect(lines[1]?.length).toBe(width - 2)
  })
})
