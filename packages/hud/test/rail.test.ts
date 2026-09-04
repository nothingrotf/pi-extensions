import type { ToolCall } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
import { beforeAll, describe, expect, test } from 'vite-plus/test'

import {
  hasNerdFontFile,
  icon,
  setIconMode,
  terminalSuggestsNerdFont,
  type IconKey,
} from '../src/icons.ts'
import { railEntryType } from '../src/rail-entry.ts'
import { railStateEntryType } from '../src/rail-state-entry.ts'
import { mapSessionRails } from '../src/rail-tools.ts'
import {
  formatDuration,
  groupActions,
  groupCap,
  groupDetail,
  groupLabel,
  labelColumn,
  labelWidth,
  padLabel,
  railHeader,
  railLines,
  RailStore,
  separator,
  showsPendingNarration,
  summarizeOutput,
  treeBranch,
  treeLast,
  treeSpine,
  type RailAction,
  type RailTheme,
} from '../src/rail.ts'
import { blankPalette } from './helpers.ts'

const theme: RailTheme = {
  fg: (_color, text) => text,
  palette: blankPalette(),
}

beforeAll(() => {
  setIconMode('ascii')
})

function read(overrides: Partial<RailAction> = {}): RailAction {
  return {
    category: 'read',
    children: undefined,
    detail: '',
    doneLabel: 'Read',
    kind: undefined,
    durationMs: undefined,
    iconKey: 'read',
    output: '',
    runningLabel: 'Reading',
    startedAt: undefined,
    status: 'ok',
    summary: '',
    toolCallId: 'call-1',
    ...overrides,
  }
}

function bash(overrides: Partial<RailAction> = {}): RailAction {
  return read({
    category: 'other',
    doneLabel: 'Ran',
    iconKey: 'shell',
    runningLabel: 'Running',
    ...overrides,
  })
}

const iconKeys: IconKey[] = [
  'agent',
  'ask',
  'branch',
  'edit',
  'fail',
  'find',
  'ok',
  'pending',
  'read',
  'search',
  'shell',
  'todo',
  'tool',
  'web',
]

describe('icons', () => {
  test('every ascii glyph occupies a single terminal cell', () => {
    setIconMode('ascii')
    for (const key of iconKeys) expect(visibleWidth(icon(key))).toBe(1)
  })

  test('every nerd glyph occupies a single terminal cell', () => {
    setIconMode('nerd')
    for (const key of iconKeys) expect(visibleWidth(icon(key))).toBe(1)
    setIconMode('ascii')
  })

  test('the nerd set stays inside the safe private-use range', () => {
    setIconMode('nerd')
    for (const key of iconKeys) {
      for (const char of icon(key)) {
        const point = char.codePointAt(0) ?? 0
        const bmp = point <= 0xffff
        const nerdBmp = point >= 0xe000 && point <= 0xf8ff
        expect(bmp).toBe(true)
        if (point > 0x2fff) expect(nerdBmp).toBe(true)
      }
    }
    setIconMode('ascii')
  })

  test('recognizes nerd font capable terminals', () => {
    expect(terminalSuggestsNerdFont('ghostty')).toBe(true)
    expect(terminalSuggestsNerdFont('WezTerm')).toBe(true)
    expect(terminalSuggestsNerdFont('Apple_Terminal')).toBe(false)
    expect(terminalSuggestsNerdFont(undefined)).toBe(false)
  })

  test('ignores font directories that do not exist', () => {
    expect(hasNerdFontFile(['/definitely/not/a/font/dir'])).toBe(false)
  })
})

describe('groupActions', () => {
  test('batches consecutive calls of the same tool name', () => {
    const groups = groupActions([
      read({ toolCallId: 'a' }),
      read({ toolCallId: 'b' }),
      read({ toolCallId: 'c' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.count).toBe(3)
    expect(groups[0]?.actions).toHaveLength(3)
  })

  test('a different tool name breaks the batch', () => {
    const groups = groupActions([
      read({ toolCallId: 'a' }),
      bash({ toolCallId: 'b' }),
      read({ toolCallId: 'c' }),
    ])
    expect(groups.map((group) => groupLabel(group))).toEqual(['Read', 'Ran', 'Read'])
  })

  test('does not merge different tools that share a category', () => {
    const grep = read({ category: 'search', doneLabel: 'Searched', iconKey: 'search' })
    const find = read({ category: 'search', doneLabel: 'Found', iconKey: 'find' })
    const groups = groupActions([grep, find])
    expect(groups).toHaveLength(2)
  })

  test('keeps a failed call on its own row', () => {
    const groups = groupActions([
      bash({ detail: 'ls', toolCallId: 'a' }),
      bash({ detail: 'cat missing', status: 'error', toolCallId: 'b' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[1]?.status).toBe('error')
  })

  test('uses the running label while the call is pending', () => {
    const group = groupActions([read({ status: 'pending' })])[0]
    expect(group === undefined ? '' : groupLabel(group)).toBe('Reading')
  })
})

describe('RailStore.reportChild', () => {
  test('nests a child under its parent', () => {
    const store = new RailStore()
    store.report('p', { doneLabel: 'Dispatched', status: 'pending' })
    store.reportChild('p', 'c', { detail: 'a.ts', doneLabel: 'Read', status: 'ok' })
    const parent = store.groups()[0]?.actions[0]
    expect(parent?.children).toHaveLength(1)
    expect(parent?.children?.[0]?.detail).toBe('a.ts')
  })

  test('updates an existing child in place', () => {
    const store = new RailStore()
    store.report('p', { doneLabel: 'Dispatched', status: 'pending' })
    store.reportChild('p', 'c', { doneLabel: 'Read', status: 'pending' })
    store.reportChild('p', 'c', { output: 'one\ntwo', status: 'ok' })
    const child = store.groups()[0]?.actions[0]?.children?.[0]
    expect(child?.status).toBe('ok')
    expect(child?.summary).toBe('2 lines')
    expect(store.groups()[0]?.actions[0]?.children).toHaveLength(1)
  })

  test('keeps several children in report order', () => {
    const store = new RailStore()
    store.report('p', { doneLabel: 'Dispatched', status: 'pending' })
    store.reportChild('p', 'c1', { detail: 'a.ts', status: 'ok' })
    store.reportChild('p', 'c2', { detail: 'b.ts', status: 'ok' })
    expect(store.groups()[0]?.actions[0]?.children?.map((child) => child.detail)).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  test('falls back to a top level row when the parent is unknown', () => {
    const store = new RailStore()
    store.reportChild('missing', 'c', { detail: 'a.ts', doneLabel: 'Read', status: 'ok' })
    expect(store.size()).toBe(1)
    expect(store.groups()[0]?.actions[0]?.detail).toBe('a.ts')
  })

  test('a nested parent never joins a run', () => {
    const store = new RailStore()
    store.report('p1', { doneLabel: 'Dispatched', status: 'ok' })
    store.reportChild('p1', 'c', { detail: 'a.ts', status: 'ok' })
    store.report('p2', { doneLabel: 'Dispatched', status: 'ok' })
    expect(store.groups()).toHaveLength(2)
  })
})

describe('usage row', () => {
  const done = read({ detail: 'a.ts', toolCallId: 'a' })
  const usage = '\u25AA 26s \u00B7 $0.26 \u00B7 85.7k in'

  test('omits the row when there is no usage', () => {
    const lines = railLines(groupActions([done]), theme, { expanded: false, width: 60 })
    expect(lines.at(-1)).not.toContain('26s')
  })

  test('appends the row as the last line', () => {
    const lines = railLines(groupActions([done]), theme, { expanded: false, usage, width: 60 })
    expect(lines.at(-1)).toContain('26s')
  })

  test('separates the row from the tree with a blank line', () => {
    const lines = railLines(groupActions([done]), theme, { expanded: false, usage, width: 60 })
    expect(lines.at(-2)).toBe('')
  })

  test('keeps the row below the pending narration row', () => {
    const lines = railLines(groupActions([done]), theme, {
      expanded: false,
      pending: true,
      usage,
      width: 60,
    })
    const thinking = lines.findIndex((line) => line.includes('Thinking'))
    const bar = lines.findIndex((line) => line.includes('26s'))
    expect(thinking).toBeGreaterThan(0)
    expect(bar).toBeGreaterThan(thinking)
  })

  test('does not disturb the tree above it', () => {
    const without = railLines(groupActions([done]), theme, { expanded: false, width: 60 })
    const withBar = railLines(groupActions([done]), theme, { expanded: false, usage, width: 60 })
    expect(withBar.slice(0, without.length)).toEqual(without)
  })

  test('ignores an empty usage string', () => {
    const lines = railLines(groupActions([done]), theme, { expanded: false, usage: '', width: 60 })
    expect(lines.at(-1)).not.toBe('')
  })
})

describe('pending narration row', () => {
  const done = read({ detail: 'a.ts', toolCallId: 'a' })

  test('shows the row in the gap between the last tool and the answer', () => {
    expect(
      showsPendingNarration({
        actions: [done],
        hasFinalText: false,
        reasoningActive: false,
        streaming: true,
      }),
    ).toBe(true)
  })

  test('hides the row once the turn ends', () => {
    expect(
      showsPendingNarration({
        actions: [done],
        hasFinalText: false,
        reasoningActive: false,
        streaming: false,
      }),
    ).toBe(false)
  })

  test('hides the row while a tool is still running', () => {
    expect(
      showsPendingNarration({
        actions: [read({ status: 'pending' })],
        hasFinalText: false,
        reasoningActive: false,
        streaming: true,
      }),
    ).toBe(false)
  })

  test('hides the row once the answer starts', () => {
    expect(
      showsPendingNarration({
        actions: [done],
        hasFinalText: true,
        reasoningActive: false,
        streaming: true,
      }),
    ).toBe(false)
  })

  test('hides the row while the model reasons', () => {
    expect(
      showsPendingNarration({
        actions: [done],
        hasFinalText: false,
        reasoningActive: true,
        streaming: true,
      }),
    ).toBe(false)
  })

  test('hides the row when no tool ran at all', () => {
    expect(
      showsPendingNarration({
        actions: [],
        hasFinalText: false,
        reasoningActive: false,
        streaming: true,
      }),
    ).toBe(false)
  })

  test('hides the row when only a completed thought exists', () => {
    expect(
      showsPendingNarration({
        actions: [{ ...done, kind: 'thought', toolCallId: 'thought' }],
        hasFinalText: false,
        reasoningActive: false,
        streaming: true,
      }),
    ).toBe(false)
  })

  test('renders as the last row of the tree', () => {
    const lines = railLines(groupActions([done]), theme, {
      expanded: false,
      pending: true,
      width: 60,
    })
    expect(lines.at(-1)).toContain('Thinking')
    expect(lines.at(-1)?.startsWith(treeLast)).toBe(true)
    expect(lines[1]?.startsWith(treeBranch)).toBe(true)
  })

  test('the pending row carries no status glyph', () => {
    const last =
      railLines(groupActions([done]), theme, { expanded: false, pending: true, width: 60 }).at(
        -1,
      ) ?? ''
    expect(last).not.toContain('\u2713')
  })
})

describe('subtrees', () => {
  function parent(children: RailAction[]): RailAction {
    return read({ children, detail: 'explore the tree', doneLabel: 'Dispatched', iconKey: 'agent' })
  }

  test('renders a child under its parent', () => {
    const lines = railLines(
      groupActions([parent([read({ detail: 'a.ts', toolCallId: 'c1' })])]),
      theme,
      { expanded: false, width: 80 },
    )
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('a.ts')
  })

  test('the last child of a last parent drops the trunk', () => {
    const lines = railLines(
      groupActions([parent([read({ detail: 'a.ts', toolCallId: 'c1' })])]),
      theme,
      { expanded: false, width: 80 },
    )
    expect(lines[2]?.startsWith('   ')).toBe(true)
    expect(lines[2]).toContain(treeLast)
  })

  test('a parent that is not last keeps the trunk under its children', () => {
    const lines = railLines(
      groupActions([
        parent([read({ detail: 'a.ts', toolCallId: 'c1' })]),
        read({ detail: 'z.ts', toolCallId: 'z' }),
      ]),
      theme,
      { expanded: false, width: 80 },
    )
    expect(lines[2]?.startsWith(treeSpine)).toBe(true)
  })

  test('a parent with children is never grouped', () => {
    const groups = groupActions([
      parent([read({ detail: 'a.ts', toolCallId: 'c1' })]),
      parent([read({ detail: 'b.ts', toolCallId: 'c2' })]),
    ])
    expect(groups).toHaveLength(2)
  })

  test('nests a child of a child', () => {
    const inner = read({ detail: 'deep.ts', toolCallId: 'd' })
    const middle = read({ children: [inner], detail: 'mid', toolCallId: 'm' })
    const lines = railLines(groupActions([parent([middle])]), theme, {
      expanded: false,
      width: 80,
    })
    expect(lines).toHaveLength(4)
    expect(lines[3]).toContain('deep.ts')
    expect(visibleWidth(lines[3]?.slice(0, lines[3].indexOf(treeLast)) ?? '')).toBe(6)
  })
})

describe('pseudo rows', () => {
  function thought(overrides: Partial<RailAction> = {}): RailAction {
    return read({
      category: 'meta',
      detail: 'weighing the options',
      doneLabel: 'Thought',
      iconKey: 'thought',
      kind: 'thought',
      runningLabel: 'Thinking',
      ...overrides,
    })
  }

  test('renders a thought row without a status glyph', () => {
    const line =
      railLines(groupActions([thought()]), theme, { expanded: false, width: 80 })[1] ?? ''
    expect(line).not.toContain('✓')
    expect(line).toContain('Thought')
    expect(line).toContain('weighing the options')
  })

  test('keeps the body aligned with a tool row', () => {
    const pseudo =
      railLines(groupActions([thought()]), theme, { expanded: false, width: 80 })[1] ?? ''
    const tool =
      railLines(groupActions([read({ detail: 'a.ts' })]), theme, {
        expanded: false,
        width: 80,
      })[1] ?? ''
    expect(visibleWidth(pseudo.slice(0, pseudo.indexOf('Thought')))).toBe(
      visibleWidth(tool.slice(0, tool.indexOf('Read'))),
    )
  })

  test('never groups two thought rows', () => {
    const groups = groupActions([thought({ toolCallId: 'a' }), thought({ toolCallId: 'b' })])
    expect(groups).toHaveLength(2)
  })

  test('never groups a narration row', () => {
    const say = (id: string): RailAction =>
      thought({ doneLabel: 'Note', iconKey: 'chat', kind: 'narration', toolCallId: id })
    expect(groupActions([say('a'), say('b')])).toHaveLength(2)
  })

  test('a pending thought row uses the running label', () => {
    const line =
      railLines(groupActions([thought({ status: 'pending' })]), theme, {
        expanded: false,
        width: 80,
      })[1] ?? ''
    expect(line).toContain('Thinking')
  })

  test('still groups tool rows around a thought row', () => {
    const groups = groupActions([
      read({ toolCallId: 'a' }),
      read({ toolCallId: 'b' }),
      thought({ toolCallId: 't' }),
    ])
    expect(groups.map((group) => group.count)).toEqual([2, 1])
  })
})

describe('group budget', () => {
  function manyGroups(count: number): RailAction[] {
    return Array.from({ length: count }, (_value, index) =>
      read({
        detail: `f${String(index)}.ts`,
        doneLabel: `Tool${String(index)}`,
        toolCallId: `t${String(index)}`,
      }),
    )
  }

  test('shows every group while the count fits the budget', () => {
    const lines = railLines(groupActions(manyGroups(groupCap)), theme, {
      expanded: false,
      width: 80,
    })
    expect(lines).toHaveLength(groupCap + 1)
    expect(lines.some((line) => line.includes('completed'))).toBe(false)
  })

  test('collapses the oldest groups past the budget into one row', () => {
    const lines = railLines(groupActions(manyGroups(groupCap + 4)), theme, {
      expanded: false,
      width: 80,
    })
    expect(lines).toHaveLength(groupCap + 2)
    expect(lines[1]).toContain('4 completed')
  })

  test('keeps the newest groups visible', () => {
    const lines = railLines(groupActions(manyGroups(groupCap + 3)), theme, {
      expanded: false,
      width: 80,
    })
    expect(lines.at(-1)).toContain(`Tool${String(groupCap + 2)}`)
    expect(lines.some((line) => line.includes('Tool0'))).toBe(false)
  })

  test('the collapse row is the first child of the tree', () => {
    const lines = railLines(groupActions(manyGroups(groupCap + 1)), theme, {
      expanded: false,
      width: 80,
    })
    expect(lines[1]?.startsWith(treeBranch)).toBe(true)
  })
})

describe('clipping', () => {
  test('clips a row to the width without an ellipsis', () => {
    const line = railLines(
      groupActions([read({ detail: 'packages/hud/src/rail.ts and a much longer tail here' })]),
      theme,
      { expanded: false, width: 30 },
    )[1]
    expect(line).toBeDefined()
    expect(visibleWidth(line ?? '')).toBeLessThanOrEqual(30)
    expect(line ?? '').not.toContain('\u2026')
  })

  test('never wraps a row onto a second line', () => {
    const lines = railLines(groupActions([read({ detail: 'x'.repeat(400) })]), theme, {
      expanded: false,
      width: 40,
    })
    expect(lines).toHaveLength(2)
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })

  test('keeps the duration visible when the body has to clip', () => {
    const line =
      railLines(groupActions([read({ detail: 'y'.repeat(200), durationMs: 900 })]), theme, {
        expanded: false,
        width: 34,
      })[1] ?? ''
    expect(line).toContain('0.9s')
    expect(visibleWidth(line)).toBeLessThanOrEqual(34)
  })

  test('clips by visible width, not by code unit count', () => {
    const line =
      railLines(groupActions([read({ detail: '\u4f60\u597d'.repeat(30) })]), theme, {
        expanded: false,
        width: 32,
      })[1] ?? ''
    expect(visibleWidth(line)).toBeLessThanOrEqual(32)
  })
})

describe('label column', () => {
  test('pads a short label to the fixed width', () => {
    expect(padLabel('Read')).toBe('Read        ')
    expect(visibleWidth(padLabel('Read'))).toBe(labelWidth)
  })

  test('pads every label to the same width so multipliers align', () => {
    const labels = ['Read', 'Sequenced', 'Synthesized']
    const widths = labels.map((label) => visibleWidth(padLabel(label)))
    expect(new Set(widths).size).toBe(1)
  })

  test('adds a single space when the label already fills the column', () => {
    expect(padLabel('Impact analysis')).toBe('Impact analysis ')
  })

  test('aligns the multiplier across rows of different label lengths', () => {
    const lines = railLines(
      groupActions([
        read({ doneLabel: 'Read', toolCallId: 'a' }),
        read({ doneLabel: 'Read', toolCallId: 'b' }),
        bash({ doneLabel: 'Ran', toolCallId: 'c' }),
        bash({ doneLabel: 'Ran', toolCallId: 'd' }),
      ]),
      theme,
      { expanded: false, width: 100 },
    )
    const columns = lines
      .filter((line) => line.includes('\u00D7'))
      .map((line) => visibleWidth(line.slice(0, line.indexOf('\u00D7'))))
    expect(new Set(columns).size).toBe(1)
  })
})

describe('groupDetail', () => {
  test('joins the argument detail and the summary for a single call', () => {
    const group = groupActions([read({ detail: 'a.ts', summary: '4 lines' })])[0]
    expect(group === undefined ? '' : groupDetail(group)).toBe(`a.ts${separator}4 lines`)
  })

  test('prefixes a lone summary with the separator dot', () => {
    const group = groupActions([read({ summary: '4 lines' })])[0]
    expect(group === undefined ? '' : groupDetail(group)).toBe('· 4 lines')
  })

  test('lists the distinct arguments for a batch', () => {
    const group = groupActions([
      read({ detail: 'a.ts', summary: '1 line', toolCallId: 'a' }),
      read({ detail: 'b.ts', summary: '9 lines', toolCallId: 'b' }),
      read({ detail: 'b.ts', summary: '9 lines', toolCallId: 'c' }),
    ])[0]
    expect(group === undefined ? '' : groupDetail(group)).toBe(`a.ts${separator}b.ts`)
  })
})

describe('formatDuration', () => {
  test('prints one decimal place in seconds', () => {
    expect(formatDuration(1_100)).toBe('1.1s')
    expect(formatDuration(900)).toBe('0.9s')
    expect(formatDuration(55_000)).toBe('55.0s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(90_000)).toBe('1m 30s')
  })

  test('returns an empty string for a missing duration', () => {
    expect(formatDuration(undefined)).toBe('')
  })
})

describe('railHeader', () => {
  test('uses the singular noun for one action', () => {
    expect(railHeader(groupActions([read()]), theme)).toBe('1 action ▾')
  })

  test('counts every call inside a batch', () => {
    const groups = groupActions([read({ toolCallId: 'a' }), read({ toolCallId: 'b' })])
    expect(railHeader(groups, theme)).toBe('2 actions ▾')
  })

  test('excludes thought and narration rows from the count', () => {
    const groups = groupActions([
      read(),
      { ...read({ toolCallId: 'thought' }), kind: 'thought' },
      { ...read({ toolCallId: 'note' }), kind: 'narration' },
    ])
    expect(railHeader(groups, theme)).toBe('1 action ▾')
  })

  test('counts only the failed calls', () => {
    const groups = groupActions([
      bash({ toolCallId: 'a' }),
      bash({ status: 'error', toolCallId: 'b' }),
      bash({ status: 'error', toolCallId: 'c' }),
    ])
    expect(railHeader(groups, theme)).toBe('3 actions · 2 failed ▾')
  })
})

describe('railLines', () => {
  test('renders nothing without actions', () => {
    expect(railLines([], theme, { expanded: false })).toEqual([])
  })

  test('draws a tree keyed by tool name', () => {
    const groups = groupActions([
      read({ detail: 'src/index.ts', toolCallId: 'a' }),
      bash({ detail: 'ls -la', toolCallId: 'b' }),
    ])
    const lines = railLines(groups, theme, { expanded: false, width: 60 })
    expect(lines[0]).toBe('2 actions ▾')
    expect(lines[1]).toBe('├─ ✓ □ Read        src/index.ts')
    expect(lines[2]).toBe('╰─ ✓ $ Ran         ls -la')
  })

  test('uses the rounded corner on the last row', () => {
    const groups = groupActions([read({ detail: 'a.ts' })])
    const line = railLines(groups, theme, { expanded: false, width: 60 })[1] ?? ''
    expect(line.startsWith(treeLast)).toBe(true)
    expect(treeLast).toBe('╰─')
    expect(treeBranch).toBe('├─')
  })

  test('aligns every detail to one global label column', () => {
    const groups = groupActions([
      read({ detail: 'a.ts', toolCallId: 'a', doneLabel: 'Read' }),
      bash({ detail: 'ls', toolCallId: 'b' }),
      read({ detail: 'c.ts', toolCallId: 'c', doneLabel: 'Searched', iconKey: 'search' }),
    ])
    expect(labelColumn(groups)).toBe(labelWidth)
    const lines = railLines(groups, theme, { expanded: false, width: 60 })
    expect(lines[1]).toBe('├─ ✓ □ Read        a.ts')
    expect(lines[2]).toBe('├─ ✓ $ Ran         ls')
    expect(lines[3]).toBe('╰─ ✓ ⊙ Searched    c.ts')
  })

  test('shows no caret when nothing can expand', () => {
    const groups = groupActions([read({ detail: 'a.ts' })])
    expect(railLines(groups, theme, { expanded: false, width: 60 })[1]).toBe(
      '╰─ ✓ □ Read        a.ts',
    )
  })

  test('never puts a caret on a single row', () => {
    const groups = groupActions([read({ detail: 'a.ts', output: 'line', summary: 'line' })])
    expect(railLines(groups, theme, { expanded: false, width: 60 })[1]).toBe(
      '╰─ ✓ □ Read        a.ts · line',
    )
  })

  test('keeps the duration visible and hard-cuts a long row', () => {
    const groups = groupActions([
      bash({
        detail: 'find . -maxdepth 3 -iname "*.json" -not -path "*/node_modules/*" -print',
        durationMs: 600,
      }),
    ])
    const line = railLines(groups, theme, { expanded: false, width: 40 })[1] ?? ''
    expect(visibleWidth(line)).toBe(40)
    expect(line.endsWith('0.6s')).toBe(true)
    expect(line).not.toContain('…')
    expect(line).toMatch(/[^ ] {4}0\.6s$/u)
  })

  test('hard-cuts a long row without a duration', () => {
    const groups = groupActions([bash({ detail: 'x'.repeat(200) })])
    const line = railLines(groups, theme, { expanded: false, width: 30 })[1] ?? ''
    expect(visibleWidth(line)).toBe(30)
    expect(line).not.toContain('…')
  })

  test('shows a sub-second duration', () => {
    const fast = groupActions([read({ detail: 'a.ts', durationMs: 200 })])
    const line = railLines(fast, theme, { expanded: false, width: 40 })[1] ?? ''
    expect(visibleWidth(line)).toBe(40)
    expect(line.endsWith('0.2s')).toBe(true)
    expect(formatDuration(200)).toBe('0.2s')
  })

  test('right-aligns the duration of a single call', () => {
    const groups = groupActions([read({ detail: 'a.ts', summary: '1 line', durationMs: 900 })])
    expect(railLines(groups, theme, { expanded: false, width: 40 })[1]).toBe(
      '╰─ ✓ □ Read        a.ts · 1 line    0.9s',
    )
  })

  test('drops long batch arguments from the parent row', () => {
    const long = 'cd /Users/nothing/Workspaces/pi-extensions && bun run check && bun run test'
    const groups = groupActions([
      bash({ detail: `${long} 1`, toolCallId: 'a' }),
      bash({ detail: `${long} 2`, toolCallId: 'b' }),
    ])
    expect(railLines(groups, theme, { expanded: false, width: 200 })[1]).toBe(
      '╰─ ✓ $ Ran         ×2 ▾',
    )
  })

  test('keeps short batch arguments inline', () => {
    const groups = groupActions([
      bash({ detail: 'luna low', toolCallId: 'a' }),
      bash({ detail: 'luna', toolCallId: 'b' }),
    ])
    expect(railLines(groups, theme, { expanded: false, width: 80 })[1]).toBe(
      '╰─ ✓ $ Ran         ×2 luna low · luna ▾',
    )
  })

  test('nests the batch children without needing the expanded flag', () => {
    const groups = groupActions([
      bash({ detail: 'one', summary: '1 line', toolCallId: 'a' }),
      bash({ detail: 'two', summary: '1 line', toolCallId: 'b' }),
    ])
    const lines = railLines(groups, theme, { expanded: false, width: 60 })
    expect(lines).toHaveLength(4)
    expect(lines[2]).toBe('   ├─ ✓ $ Ran         one · 1 line')
    expect(lines[3]).toBe('   ╰─ ✓ $ Ran         two · 1 line')
  })

  test('caps the nested children and reports the remainder', () => {
    const actions = Array.from({ length: 11 }, (_value, index) =>
      bash({ detail: `cmd ${index}`, toolCallId: `c${index}` }),
    )
    const lines = railLines(groupActions(actions), theme, { expanded: false, width: 60 })
    expect(lines).toHaveLength(11)
    expect(lines.at(-1)).toBe('   ╰─ +3 completed')
  })

  test('expands a batch into aligned child rows with durations', () => {
    const groups = groupActions([
      read({ detail: 'a.ts', summary: '1 line', toolCallId: 'a', durationMs: 500 }),
      read({ detail: 'b.ts', summary: '9 lines', toolCallId: 'b', durationMs: 600 }),
    ])
    const lines = railLines(groups, theme, { expanded: true, width: 50 })
    expect(lines[1]).toBe('╰─ ✓ □ Read        ×2 a.ts · b.ts ▾')
    expect(lines[2]).toBe('   ├─ ✓ □ Read        a.ts · 1 line           0.5s')
    expect(lines[3]).toBe('   ╰─ ✓ □ Read        b.ts · 9 lines          0.6s')
  })

  test('keeps the stem for a batch that is not the last group', () => {
    const groups = groupActions([
      read({ detail: 'a.ts', toolCallId: 'a' }),
      read({ detail: 'b.ts', toolCallId: 'b' }),
      bash({ detail: 'ls', toolCallId: 'c' }),
    ])
    const lines = railLines(groups, theme, { expanded: true, width: 50 })
    expect(lines[2]).toBe('│  ├─ ✓ □ Read        a.ts')
    expect(lines[3]).toBe('│  ╰─ ✓ □ Read        b.ts')
  })

  test('prints the raw output for a single call', () => {
    const groups = groupActions([read({ detail: 'a.ts', output: 'first\nsecond' })])
    const lines = railLines(groups, theme, { expanded: true, width: 50 })
    expect(lines[2]).toBe('      first')
    expect(lines[3]).toBe('      second')
  })

  test('caps the printed output', () => {
    const output = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n')
    const lines = railLines(groupActions([read({ output })]), theme, { expanded: true, width: 50 })
    expect(lines.at(-1)).toBe('      …')
    expect(lines).toHaveLength(9)
  })
})

describe('summarizeOutput', () => {
  test('returns an empty string for empty output', () => {
    expect(summarizeOutput('   ')).toBe('')
  })

  test('echoes a single line the way the reference does', () => {
    expect(summarizeOutput('linha inicial')).toBe('linha inicial')
  })

  test('counts lines beyond the first', () => {
    expect(summarizeOutput('a\nb\nc\n')).toBe('3 lines')
  })

  test('keeps the first line of an error so the reason stays visible', () => {
    expect(summarizeOutput('Could not find the exact text\nmore detail', 'error')).toBe(
      'Could not find the exact text',
    )
  })
})

describe('RailStore', () => {
  test('derives the summary from the reported output', () => {
    const store = new RailStore()
    store.report('a', { detail: 'src/a.ts', doneLabel: 'Read', status: 'pending' })
    store.report('a', { output: 'one\ntwo', status: 'ok' })
    expect(store.size()).toBe(1)
    const group = store.groups()[0]
    expect(group === undefined ? '' : groupDetail(group)).toBe(`src/a.ts${separator}2 lines`)
  })

  test('records the duration between the first report and the settle', () => {
    let clock = 1_000
    const store = new RailStore(() => clock)
    store.report('a', { detail: 'a.ts', doneLabel: 'Read', status: 'pending' })
    clock = 1_450
    store.report('a', { output: 'one', status: 'ok' })
    expect(store.groups()[0]?.actions[0]?.durationMs).toBe(450)
  })

  test('falls back to a default label and icon', () => {
    setIconMode('ascii')
    const store = new RailStore()
    store.report('a', {})
    const group = store.groups()[0]
    expect(group === undefined ? '' : groupLabel(group)).toBe('Tool')
    expect(group?.iconKey).toBe('tool')
  })

  test('reset clears the actions', () => {
    const store = new RailStore()
    store.report('a', { doneLabel: 'Read' })
    store.reset()
    expect(store.size()).toBe(0)
  })

  test('keeps the call order', () => {
    const store = new RailStore()
    store.report('a', { category: 'read', doneLabel: 'Read' })
    store.report('b', { category: 'other', doneLabel: 'Ran' })
    store.report('a', { status: 'ok' })
    expect(store.groups().map((group) => groupLabel(group))).toEqual(['Read', 'Ran'])
  })

  test('reorders existing actions by segment order', () => {
    const store = new RailStore()
    store.report('tool', { doneLabel: 'Read' })
    store.report('thought', { doneLabel: 'Thought', kind: 'thought' })
    store.reorder(['thought', 'tool'])
    expect(store.groups().map((group) => groupLabel(group))).toEqual(['Thought', 'Read'])
  })

  test('does not measure a pseudo action duration', () => {
    let now = 100
    const store = new RailStore(() => now)
    store.report('thought', { measureDuration: false, status: 'pending' })
    now = 500
    store.report('thought', { measureDuration: false, status: 'ok' })
    expect(store.groups()[0]?.actions[0]?.durationMs).toBeUndefined()
  })

  test('removes a provisional pseudo action', () => {
    const store = new RailStore()
    store.report('tool', { doneLabel: 'Read' })
    store.report('note', { doneLabel: 'Note', kind: 'narration' })
    expect(store.has('note')).toBe(true)
    store.remove('note')
    expect(store.has('note')).toBe(false)
    expect(store.groups().map((group) => groupLabel(group))).toEqual(['Read'])
  })
})

describe('mapSessionRails', () => {
  const base = { id: 'e', parentId: null, timestamp: '0' } as const
  const userEntry: SessionEntry = {
    ...base,
    message: { content: [], role: 'user', timestamp: 0 },
    type: 'message',
  }
  const railEntry: SessionEntry = {
    ...base,
    customType: railEntryType,
    data: { turn: 1 },
    type: 'custom',
  }
  type RailStateTestData = {
    report: {
      category?: 'meta'
      doneLabel: string
      iconKey: 'agent' | 'todo'
      parentToolCallId?: string
      runningLabel: string
      status: 'ok' | 'pending'
      toolCallId: string
      toolName?: string
    }
    turn: number
  }
  const railStateEntry = (data: RailStateTestData): SessionEntry => ({
    ...base,
    customType: railStateEntryType,
    data,
    type: 'custom',
  })
  const toolResultEntry = (id: string, text: string, isError = false): SessionEntry => ({
    ...base,
    message: {
      content: [{ text, type: 'text' }],
      isError,
      role: 'toolResult',
      timestamp: 1_500,
      toolCallId: id,
      toolName: 'bash',
    },
    type: 'message',
  })

  const assistantEntry = (...ids: string[]): SessionEntry => ({
    ...base,
    message: {
      api: 'anthropic-messages',
      content: ids.map((id): ToolCall => ({ arguments: {}, id, name: 'bash', type: 'toolCall' })),
      model: 'test',
      provider: 'anthropic',
      role: 'assistant',
      stopReason: 'toolUse',
      timestamp: 0,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    type: 'message',
  })

  const pseudoEntry = (): SessionEntry => ({
    ...base,
    message: {
      api: 'anthropic-messages',
      content: [
        { thinking: '# Plan\nweigh it', type: 'thinking' },
        { text: 'found it\nsecond line', type: 'text' },
        { arguments: {}, id: 'k', name: 'bash', type: 'toolCall' },
      ],
      model: 'test',
      provider: 'anthropic',
      role: 'assistant',
      stopReason: 'toolUse',
      timestamp: 2,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    type: 'message',
  })

  const finalTextEntry = (): SessionEntry => ({
    ...base,
    message: {
      api: 'anthropic-messages',
      content: [{ text: 'final answer', type: 'text' }],
      model: 'test',
      provider: 'anthropic',
      role: 'assistant',
      stopReason: 'stop',
      timestamp: 3,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    type: 'message',
  })

  const blankThinkingEntry = (): SessionEntry => ({
    ...base,
    message: {
      api: 'anthropic-messages',
      content: [
        { thinking: '   \n\n', type: 'thinking' },
        { arguments: {}, id: 'k', name: 'bash', type: 'toolCall' },
      ],
      model: 'test',
      provider: 'anthropic',
      role: 'assistant',
      stopReason: 'toolUse',
      timestamp: 0,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    type: 'message',
  })

  test('backfills a thought row from a thinking block', () => {
    const store = mapSessionRails([userEntry, pseudoEntry()]).byToolCallId.get('k')
    const thought = store
      ?.groups()
      .flatMap((group) => group.actions)
      .find((action) => action.kind === 'thought')
    expect(thought?.detail).toBe('Plan')
  })

  test('keeps opening prose outside the rail', () => {
    const store = mapSessionRails([userEntry, pseudoEntry()]).byToolCallId.get('k')
    expect(store?.groups().some((group) => group.actions[0]?.kind === 'narration')).toBe(false)
  })

  test('backfills only intermediate prose as a narration row', () => {
    const rails = mapSessionRails([userEntry, railEntry, assistantEntry('a'), pseudoEntry()])
    const groups = rails.byToolCallId.get('k')?.groups() ?? []
    const narration = groups
      .flatMap((group) => group.actions)
      .find((action) => action.kind === 'narration')
    expect(narration?.detail).toBe('found it')
    expect(narration?.summary).toBe('2 lines')
    expect(rails.hiddenAssistantTimestamps).toEqual(new Set([2]))
    expect(rails.hiddenAssistantTextBlocks).toEqual(new Map([[2, new Set([1])]]))
  })

  test('keeps narration visible when its turn has no rail entry', () => {
    const rails = mapSessionRails([userEntry, assistantEntry('a'), pseudoEntry()])
    expect(rails.hiddenAssistantTimestamps).toEqual(new Set())
    expect(rails.hiddenAssistantTextBlocks).toEqual(new Map())
  })

  test('preserves segment order around an intermediate Note', () => {
    const store = mapSessionRails([userEntry, assistantEntry('a'), pseudoEntry()]).byToolCallId.get(
      'k',
    )
    const kinds = (store?.groups() ?? []).map((group) => group.actions[0]?.kind ?? 'tool')
    expect(kinds).toEqual(['tool', 'thought', 'narration', 'tool'])
  })

  test('keeps final prose outside the rail', () => {
    const rails = mapSessionRails([userEntry, assistantEntry('a'), finalTextEntry()])
    const store = rails.byToolCallId.get('a')
    expect(store?.groups()).toHaveLength(1)
    expect(rails.hiddenAssistantTimestamps).toEqual(new Set())
  })

  test('skips a blank thinking block', () => {
    const entry = blankThinkingEntry()
    const store = mapSessionRails([userEntry, entry]).byToolCallId.get('k')
    const groups = store?.groups() ?? []
    expect(groups).toHaveLength(1)
    expect(groups[0]?.actions[0]?.kind).toBeUndefined()
  })

  test('gives every turn its own store', () => {
    const rails = mapSessionRails([
      userEntry,
      assistantEntry('a', 'b'),
      userEntry,
      assistantEntry('c'),
    ])
    expect(rails.byToolCallId.get('a')).toBe(rails.byToolCallId.get('b'))
    expect(rails.byToolCallId.get('c')).not.toBe(rails.byToolCallId.get('a'))
  })

  test('keeps several assistant messages of one turn on the same store', () => {
    const rails = mapSessionRails([userEntry, assistantEntry('a'), assistantEntry('b')])
    expect(rails.byToolCallId.get('a')).toBe(rails.byToolCallId.get('b'))
  })

  test('ignores entries without tool calls', () => {
    expect(mapSessionRails([userEntry, assistantEntry()]).byToolCallId.size).toBe(0)
  })

  test('backfills the actions of a reopened session', () => {
    const rails = mapSessionRails([
      userEntry,
      assistantEntry('a'),
      toolResultEntry('a', 'one\ntwo'),
    ])
    const store = rails.byToolCallId.get('a')
    expect(store?.size()).toBe(1)
    const group = store?.groups()[0]
    expect(group === undefined ? '' : groupLabel(group)).toBe('Ran')
    expect(group === undefined ? '' : groupDetail(group)).toBe('· 2 lines')
  })

  test('derives the backfilled duration from the message timestamps', () => {
    const rails = mapSessionRails([userEntry, assistantEntry('a'), toolResultEntry('a', 'ok')])
    expect(rails.byToolCallId.get('a')?.groups()[0]?.actions[0]?.durationMs).toBe(1_500)
  })

  test('marks a backfilled failure as an error row', () => {
    const rails = mapSessionRails([
      userEntry,
      assistantEntry('a'),
      toolResultEntry('a', 'boom', true),
    ])
    expect(rails.byToolCallId.get('a')?.groups()[0]?.status).toBe('error')
  })

  test('leaves a call without a result pending', () => {
    const rails = mapSessionRails([userEntry, assistantEntry('a')])
    expect(rails.byToolCallId.get('a')?.groups()[0]?.status).toBe('pending')
  })

  test('restores the argument detail of a built-in tool', () => {
    const entry: SessionEntry = {
      ...base,
      message: {
        api: 'anthropic-messages',
        content: [
          { arguments: { path: '/repo/src/a.ts' }, id: 'r', name: 'read', type: 'toolCall' },
        ],
        model: 'test',
        provider: 'anthropic',
        role: 'assistant',
        stopReason: 'toolUse',
        timestamp: 0,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      type: 'message',
    }
    const rails = mapSessionRails([userEntry, entry], '/repo')
    const group = rails.byToolCallId.get('r')?.groups()[0]
    expect(group === undefined ? '' : groupLabel(group)).toBe('Reading')
    expect(group === undefined ? '' : groupDetail(group)).toBe('src/a.ts')
  })

  test('restores custom labels and nested actions from state entries', () => {
    const rails = mapSessionRails([
      userEntry,
      railEntry,
      assistantEntry('parent'),
      railStateEntry({
        report: {
          category: 'meta',
          doneLabel: 'Todo',
          iconKey: 'todo',
          runningLabel: 'Todo',
          status: 'ok',
          toolCallId: 'parent',
          toolName: 'todo_write',
        },
        turn: 1,
      }),
      toolResultEntry('parent', 'line 1\nline 2'),
      railStateEntry({
        report: {
          doneLabel: 'Delegated',
          iconKey: 'agent',
          parentToolCallId: 'parent',
          runningLabel: 'Delegating',
          status: 'ok',
          toolCallId: 'child',
        },
        turn: 1,
      }),
      toolResultEntry('child', 'child output'),
    ])
    const parent = rails.byToolCallId.get('parent')?.groups()[0]?.actions[0]
    expect(parent?.doneLabel).toBe('Todo')
    expect(parent?.category).toBe('meta')
    expect(parent?.summary).toBe('')
    expect(parent?.durationMs).toBeUndefined()
    expect(parent?.children?.[0]?.doneLabel).toBe('Delegated')
    expect(parent?.children?.[0]?.status).toBe('ok')
    expect(rails.byToolCallId.get('parent')?.size()).toBe(1)
    expect(rails.byToolCallId.get('child')).toBe(rails.byToolCallId.get('parent'))
  })

  test('keeps a completed result after a pending state report', () => {
    const rails = mapSessionRails([
      userEntry,
      railEntry,
      assistantEntry('pending'),
      railStateEntry({
        report: {
          doneLabel: 'Custom',
          iconKey: 'todo',
          runningLabel: 'Customizing',
          status: 'pending',
          toolCallId: 'pending',
        },
        turn: 1,
      }),
      toolResultEntry('pending', 'done'),
    ])
    const action = rails.byToolCallId.get('pending')?.groups()[0]?.actions[0]
    expect(action?.doneLabel).toBe('Custom')
    expect(action?.status).toBe('ok')
    expect(action?.output).toBe('done')
  })

  test('labels a non built-in tool from its name', () => {
    const entry: SessionEntry = {
      ...base,
      message: {
        api: 'anthropic-messages',
        content: [{ arguments: {}, id: 'w', name: 'web_search', type: 'toolCall' }],
        model: 'test',
        provider: 'anthropic',
        role: 'assistant',
        stopReason: 'toolUse',
        timestamp: 0,
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 0,
          output: 0,
          totalTokens: 0,
        },
      },
      type: 'message',
    }
    const group = mapSessionRails([userEntry, entry]).byToolCallId.get('w')?.groups()[0]
    expect(group?.label).toBe('Web search')
    expect(group?.iconKey).toBe('web')
  })
})

describe('meta actions', () => {
  function meta(overrides: Partial<RailAction> = {}): RailAction {
    return read({
      category: 'meta',
      doneLabel: 'Todo',
      iconKey: 'todo',
      runningLabel: 'Todo',
      ...overrides,
    })
  }

  test('collapses repeated meta calls into one row', () => {
    const groups = groupActions([
      meta({ detail: '4 tasks', toolCallId: 'm1' }),
      read({ detail: 'a.ts', toolCallId: 'a' }),
      meta({ detail: '4 tasks · 1 done', toolCallId: 'm2' }),
      read({ detail: 'b.ts', toolCallId: 'b' }),
      meta({ detail: '4 tasks · 2 done', toolCallId: 'm3' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.count).toBe(3)
    expect(groups[0]?.label).toBe('Todo')
  })

  test('lets the surrounding calls batch once meta rows are pulled out', () => {
    const groups = groupActions([
      read({ detail: 'a.ts', toolCallId: 'a' }),
      meta({ toolCallId: 'm1' }),
      read({ detail: 'b.ts', toolCallId: 'b' }),
    ])
    const reads = groups.find((group) => group.category === 'read')
    expect(reads?.count).toBe(2)
  })

  test('shows the latest meta state as the detail', () => {
    const groups = groupActions([
      meta({ detail: 'first', toolCallId: 'm1' }),
      meta({ detail: 'last', toolCallId: 'm2' }),
    ])
    const group = groups[0]
    expect(group === undefined ? '' : groupDetail(group)).toBe('last')
  })

  test('an error in any meta call marks the row', () => {
    const groups = groupActions([
      meta({ toolCallId: 'm1' }),
      meta({ status: 'error', toolCallId: 'm2' }),
    ])
    expect(groups[0]?.status).toBe('error')
  })
})
