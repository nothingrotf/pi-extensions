import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import {
  askCallPatch,
  askResultPatch,
  askResultRows,
  askRows,
  normalizeAskPatch,
} from '../src/rail-ask.ts'
import { mapSessionRails, railPatchForCall } from '../src/rail-tools.ts'
import { railLines, RailStore } from '../src/rail.ts'
import { blankPalette } from './helpers.ts'

const input = {
  title: 'Visual test',
  questions: [
    {
      id: 'single',
      prompt: 'How does it look?',
      options: [
        { id: 'good', label: 'Looks good' },
        { id: 'adjust', label: 'Needs adjustment' },
      ],
      allowMultiple: false,
    },
    {
      id: 'multiple',
      prompt: 'Which elements look right?',
      options: [
        { id: 'spacing', label: 'Spacing' },
        { id: 'colors', label: 'Colors' },
      ],
      allowMultiple: true,
    },
  ],
}

const details = {
  ...input,
  status: 'success',
  answers: [
    { questionId: 'single', selectedOptionIds: ['good'], freeformText: '' },
    {
      questionId: 'multiple',
      selectedOptionIds: ['spacing', 'colors'],
      freeformText: 'Typography',
    },
  ],
}

const theme = { fg: (_color: string, text: string) => text, palette: blankPalette() }

describe('AskQuestion rail options', () => {
  test('shows each question and every option before an answer', () => {
    expect(askRows(input)).toEqual([
      'How does it look?',
      '  [ ] Looks good',
      '  [ ] Needs adjustment',
      '  [ ] Other',
      'Which elements look right?',
      '  [ ] Spacing',
      '  [ ] Colors',
      '  [ ] Other',
    ])
  })

  test('marks single, multiple, and freeform answers', () => {
    expect(askResultRows('AskQuestion', details)).toEqual([
      'How does it look?',
      '  [x] Looks good',
      '  [ ] Needs adjustment',
      '  [ ] Other',
      'Which elements look right?',
      '  [x] Spacing',
      '  [x] Colors',
      '  [x] Other: Typography',
    ])
  })

  test('ignores invalid data and unrelated tools', () => {
    expect(askRows({ questions: [{}] })).toBeUndefined()
    expect(askResultRows('read', details)).toBeUndefined()
    expect(askRows(input, { answers: [{}] })).toEqual(askRows(input))
    expect(askResultRows('AskQuestion', { ...input, status: 'rejected' })).toEqual(askRows(input))
  })

  test('hides option details until expansion', () => {
    const store = new RailStore()
    for (const id of ['first', 'second']) {
      store.report(id, railPatchForCall({ arguments: input, toolName: 'AskQuestion' }, ''))
      store.report(id, { ...askResultPatch('AskQuestion', details), status: 'ok' })
    }
    expect(store.groups()).toHaveLength(1)
    const lines = railLines(store.groups(), theme, { expanded: false, width: 100 })
    expect(lines.some((line) => line.includes('[x]'))).toBe(false)
    expect(lines.some((line) => line.includes('[ ]'))).toBe(false)
    const expanded = railLines(store.groups(), theme, { expanded: true, width: 100 })
    expect(expanded.filter((line) => line.includes('[x] Looks good'))).toHaveLength(2)
    expect(expanded.filter((line) => line.includes('[ ] Needs adjustment'))).toHaveLength(2)
    expect(lines.every((line) => visibleWidth(line) <= 100)).toBe(true)
    for (const width of [20, 40]) {
      expect(
        railLines(store.groups(), theme, { expanded: false, width }).every(
          (line) => visibleWidth(line) <= width,
        ),
      ).toBe(true)
    }
  })

  test('shows a compact Asked row only after the answer arrives', () => {
    const store = new RailStore()
    store.report('ask', askCallPatch(input))
    expect(railLines(store.groups(), theme, { expanded: false })).toEqual([])
    store.report('ask', {
      ...askResultPatch('AskQuestion', details),
      status: 'ok',
      measureDuration: false,
    })
    const lines = railLines(store.groups(), theme, { expanded: false, width: 180 })
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Asked')
    expect(lines[1]).toContain('How does it look?')
    expect(lines[1]).toContain('Looks good · Spacing, Colors, Typography')
    expect(lines[1]).toContain('▸')
    const expanded = railLines(store.groups(), theme, { expanded: true, width: 180 })
    expect(expanded[1]).toContain('▾')
    expect(expanded.some((line) => line.includes('[x] Colors'))).toBe(true)
  })

  test('normalizes bridge labels and applies reference detail limits', () => {
    const patch = normalizeAskPatch({
      iconKey: 'ask',
      doneLabel: 'Ask',
      runningLabel: 'Ask',
      detail: 'q'.repeat(51),
      summary: 'a'.repeat(61),
    })
    expect(patch.doneLabel).toBe('Asked')
    expect(patch.runningLabel).toBe('Asking')
    expect(patch.detail).toBe(`${'q'.repeat(47)}...`)
    expect(patch.summary).toBe(`${'a'.repeat(57)}...`)
    expect(askResultPatch('AskQuestion', { ...input, status: 'rejected' }).summary).toBe('skipped')
    expect(askResultPatch('read', details)).toEqual({})
  })

  test('preserves options through parent reports without redundant cache changes', () => {
    const store = new RailStore()
    store.report('ask', { askRows: askRows(input) })
    const version = store.version()
    store.report('ask', { askRows: askRows(input) })
    expect(store.version()).toBe(version)
    store.report('ask', { summary: 'Answered', status: 'ok', resetDerived: true })
    expect(store.values()[0]?.askRows).toEqual(askRows(input))
  })

  test('restores selected options from session results after parent state reports', () => {
    const base = { id: 'entry', parentId: null, timestamp: '0' }
    const entries: SessionEntry[] = [
      {
        ...base,
        type: 'message',
        message: {
          api: 'anthropic-messages',
          role: 'assistant',
          provider: 'anthropic',
          model: 'test',
          stopReason: 'toolUse',
          timestamp: 0,
          content: [{ type: 'toolCall', id: 'ask', name: 'AskQuestion', arguments: input }],
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      },
      { ...base, type: 'custom', customType: 'hud-rail', data: { turn: 1 } },
      {
        ...base,
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'ask',
          toolName: 'AskQuestion',
          content: [{ type: 'text', text: 'Answered' }],
          details,
          isError: false,
          timestamp: 100,
        },
      },
      {
        ...base,
        type: 'custom',
        customType: 'hud-rail-state',
        data: {
          turn: 1,
          report: { toolCallId: 'ask', doneLabel: 'Ask', status: 'ok', summary: 'Answered' },
        },
      },
    ]
    const restored = mapSessionRails(entries).byToolCallId.get('ask')
    expect(restored?.values()[0]?.askRows).toEqual(askRows(input, details))
    expect(railLines(restored?.groups() ?? [], theme, { expanded: true }).join('\n')).toContain(
      '[x] Colors',
    )
  })

  test('sanitizes option labels and freeform text', () => {
    const rows = askRows({
      questions: [{ id: 'q', prompt: 'Pick\na choice', options: [{ id: 'a', label: 'A\nB' }] }],
    })
    expect(rows?.every((row) => !row.includes('\n'))).toBe(true)
  })
})
