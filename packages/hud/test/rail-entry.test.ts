import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
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
    expect(lines[0]?.trimEnd()).toBe('      1 action ▾')
    expect(lines[1]?.trimEnd()).toBe('      ╰─ ✓ □ Read        a.ts')
    expect(lines.every((line) => visibleWidth(line) === 80)).toBe(true)
  })

  test('hides and restores the rail through its visibility source', () => {
    const store = new RailStore()
    store.report('a', { doneLabel: 'Read', status: 'ok' })
    let visible = false
    const component = new RailComponent(
      () => store,
      theme,
      false,
      undefined,
      undefined,
      undefined,
      () => visible,
    )
    expect(component.render(80)).toEqual([])
    visible = true
    expect(plain(component.render(80))[0]?.trimEnd()).toBe('      1 action ▾')
  })

  test('switches between settled and live body colors', () => {
    const store = new RailStore()
    store.report('a', {
      category: 'read',
      doneLabel: 'Read',
      iconKey: 'read',
      status: 'ok',
    })
    let active = false
    const component = new RailComponent(
      () => store,
      theme,
      false,
      () => false,
      undefined,
      undefined,
      () => true,
      () => active,
    )
    expect(component.render(40).join('\n')).toContain('\x1b[38;2;86;130;78m')
    active = true
    expect(component.render(40).join('\n')).toContain('\x1b[38;2;115;173;104m')
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
    expect(lines[1]?.trimEnd().endsWith('1.5s')).toBe(true)
    expect(lines[1]?.length).toBe(width)
    expect(lines[1]?.endsWith(' ')).toBe(true)
    expect(lines[1]?.indexOf('1.5s')).toBe(32)
    expect(plain(component.render(120))[1]?.indexOf('1.5s')).toBe(103)
  })
})

describe('RailComponent pending row', () => {
  function storeWithOneDoneCall(): RailStore {
    const store = new RailStore()
    store.report('a', { detail: 'a.ts', doneLabel: 'Read', status: 'ok' })
    return store
  }

  test('omits the pending row by default', () => {
    const component = new RailComponent(storeWithOneDoneCall, theme, false)
    expect(plain(component.render(60)).some((line) => line.includes('Thinking'))).toBe(false)
  })

  test('appends the pending row when the turn waits', () => {
    const component = new RailComponent(storeWithOneDoneCall, theme, false, () => true)
    expect(plain(component.render(60)).at(-1)).toContain('Thinking')
  })

  test('drops the pending row again once the flag clears', () => {
    let waiting = true
    const component = new RailComponent(storeWithOneDoneCall, theme, false, () => waiting)
    expect(plain(component.render(60)).at(-1)).toContain('Thinking')
    waiting = false
    expect(plain(component.render(60)).some((line) => line.includes('Thinking'))).toBe(false)
  })

  test('keeps every rendered line inside the width', () => {
    const component = new RailComponent(storeWithOneDoneCall, theme, false, () => true)
    for (const line of plain(component.render(30))) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(30)
    }
  })
})

describe('RailComponent usage row', () => {
  const themeWithAnsi: RailThemeSource = {
    fg: (_color, text) => text,
    getFgAnsi: (color) =>
      color === 'customMessageLabel'
        ? '\x1b[38;2;167;199;240m'
        : color === 'accent'
          ? '\x1b[38;2;128;105;172m'
          : '\x1b[38;2;93;88;114m',
  }

  function store(): RailStore {
    const created = new RailStore()
    created.report('a', { detail: 'a.ts', doneLabel: 'Read', status: 'ok' })
    return created
  }

  const bar = '\u25AA 26s \u00B7 $0.26 \u00B7 85.7k in'

  test('omits the row when nothing is reported', () => {
    const component = new RailComponent(store, themeWithAnsi, false)
    expect(plain(component.render(60)).some((line) => line.includes('26s'))).toBe(false)
  })

  test('renders the row as the last line', () => {
    const component = new RailComponent(
      store,
      themeWithAnsi,
      false,
      () => false,
      () => ({
        row: bar,
        shimmer: false,
      }),
    )
    expect(plain(component.render(60)).at(-1)).toContain('26s')
  })

  test('leaves a blank line above the row', () => {
    const component = new RailComponent(
      store,
      themeWithAnsi,
      false,
      () => false,
      () => ({
        row: bar,
        shimmer: false,
      }),
    )
    const lines = plain(component.render(60))
    expect(lines.at(-2)).toBe('')
  })

  test('shimmers the row while the turn runs', () => {
    let tick = 5
    const component = new RailComponent(
      store,
      themeWithAnsi,
      false,
      () => false,
      () => ({
        row: bar,
        shimmer: true,
        tick,
      }),
    )
    const initial = component.render(60).at(-1) ?? ''
    tick += 1
    const animated = component.render(60).at(-1) ?? ''
    expect(initial.split('\x1b[38;2;')).toHaveLength(2)
    expect(animated.split('\x1b[38;2;').length).toBeGreaterThan(3)
  })

  test('keeps the theme receiver while the row shimmers', () => {
    class StatefulTheme {
      private readonly colors = new Map<ThemeColor, string>([
        ['accent', '\x1b[38;2;128;105;172m'],
        ['customMessageLabel', '\x1b[38;2;167;199;240m'],
        ['dim', '\x1b[38;2;93;88;114m'],
      ])

      fg(_color: ThemeColor, text: string): string {
        return text
      }

      getFgAnsi(color: ThemeColor): string {
        return this.colors.get(color) ?? ''
      }
    }

    const component = new RailComponent(
      store,
      new StatefulTheme(),
      false,
      () => false,
      () => ({ row: bar, shimmer: true }),
    )
    expect(plain(component.render(60)).at(-1)).toContain('26s')
  })

  test('stops shimmering once the turn settles', () => {
    const component = new RailComponent(
      store,
      themeWithAnsi,
      false,
      () => false,
      () => ({
        row: bar,
        shimmer: false,
      }),
    )
    const raw = component.render(60).at(-1) ?? ''
    expect(raw.split('\x1b[38;2;').length).toBeLessThanOrEqual(2)
  })

  test('keeps the row below the pending narration row', () => {
    const component = new RailComponent(
      store,
      themeWithAnsi,
      false,
      () => true,
      () => ({
        row: bar,
        shimmer: true,
      }),
    )
    const lines = plain(component.render(60))
    const thinking = lines.findIndex((line) => line.includes('Thinking'))
    const usage = lines.findIndex((line) => line.includes('26s'))
    expect(thinking).toBeGreaterThan(0)
    expect(usage).toBeGreaterThan(thinking)
  })
})
