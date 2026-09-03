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
import { mapSessionRails } from '../src/rail-tools.ts'
import {
  formatDuration,
  groupActions,
  groupDetail,
  groupLabel,
  labelColumn,
  labelWidth,
  padLabel,
  railHeader,
  railLines,
  RailStore,
  separator,
  summarizeOutput,
  treeBranch,
  treeLast,
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
    detail: '',
    doneLabel: 'Read',
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

  test('hides a duration below the reference floor', () => {
    const fast = groupActions([read({ detail: 'a.ts', durationMs: 200 })])
    expect(railLines(fast, theme, { expanded: false, width: 40 })[1]).toBe(
      '╰─ ✓ □ Read        a.ts',
    )
    expect(formatDuration(200)).toBe('')
    expect(formatDuration(500)).toBe('0.5s')
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
})

describe('mapSessionRails', () => {
  const base = { id: 'e', parentId: null, timestamp: '0' } as const
  const userEntry: SessionEntry = {
    ...base,
    message: { content: [], role: 'user', timestamp: 0 },
    type: 'message',
  }
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
    expect(group === undefined ? '' : groupLabel(group)).toBe('Shell')
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
    expect(group === undefined ? '' : groupLabel(group)).toBe('Read')
    expect(group === undefined ? '' : groupDetail(group)).toBe('src/a.ts')
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
