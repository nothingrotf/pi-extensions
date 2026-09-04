import { visibleWidth } from '@earendil-works/pi-tui'
import { beforeAll, describe, expect, test } from 'vite-plus/test'

import { setIconMode } from '../src/icons.ts'
import { RailComponent, type RailThemeSource } from '../src/rail-entry.ts'
import type { PseudoBlock } from '../src/rail-pseudo.ts'
import type { RailSegment } from '../src/rail-segments.ts'
import { railPatchForCall } from '../src/rail-tools.ts'
import { projectRailVoice } from '../src/rail-voice.ts'
import { RailStore, showsPendingNarration } from '../src/rail.ts'

const theme: RailThemeSource = { fg: (_color, text) => text }
const escape = String.fromCharCode(27)
const ansiPattern = new RegExp(`${escape}\\[[0-9;]*m`, 'gu')
const plain = (lines: readonly string[]): string[] =>
  lines.map((line) => line.replace(ansiPattern, ''))

beforeAll(() => {
  setIconMode('ascii')
})

type ToolArgs = { command: string; path?: undefined } | { command?: undefined; path: string }

class Turn {
  readonly store = new RailStore()
  private working = false
  private pending = false
  private pseudoIds = new Set<string>()
  private segments: RailSegment[] = []

  agentStart(): void {
    this.working = true
    this.pending = false
  }

  messageEnd(blocks: readonly PseudoBlock[]): void {
    for (const block of blocks) {
      const index = this.segments.length + 1
      if (block.thinking !== undefined) {
        this.segments.push({
          content: block.thinking,
          id: `thought:${String(index)}`,
          type: 'reasoning',
        })
      } else if (block.text !== undefined) {
        this.segments.push({
          content: block.text,
          id: `narration:${String(index)}`,
          type: 'text',
        })
      }
    }
    this.reconcile()
  }

  toolStart(toolName: string, toolCallId: string, args: ToolArgs): void {
    this.pending = false
    this.segments.push({ toolCallIds: [toolCallId], type: 'tools' })
    this.store.report(toolCallId, railPatchForCall({ arguments: args, toolName }, ''))
    this.reconcile()
  }

  narrateBeforeTool(text: string, toolName: string, toolCallId: string, args: ToolArgs): void {
    const index = this.segments.length + 1
    this.segments.push({ content: text, id: `narration:${String(index)}`, type: 'text' })
    this.toolStart(toolName, toolCallId, args)
  }

  childStart(parentToolCallId: string, toolCallId: string, toolName: string, args: ToolArgs): void {
    this.store.reportChild(
      parentToolCallId,
      toolCallId,
      railPatchForCall({ arguments: args, toolName }, ''),
    )
  }

  toolEnd(toolCallId: string, output: string): void {
    this.store.report(toolCallId, { output, status: 'ok' })
    this.reconcile()
  }

  childEnd(parentToolCallId: string, toolCallId: string, output: string): void {
    this.store.reportChild(parentToolCallId, toolCallId, { output, status: 'ok' })
  }

  agentEnd(): void {
    this.working = false
    this.pending = false
  }

  private reconcile(): void {
    const projection = projectRailVoice(this.segments, false)
    const nextIds = new Set(projection.rows.map((row) => row.id))
    for (const id of this.pseudoIds) {
      if (!nextIds.has(id)) this.store.remove(id)
    }
    for (const row of projection.rows) this.store.report(row.id, row.patch)
    this.store.reorder(projection.order)
    this.pseudoIds = nextIds
    this.pending = showsPendingNarration({
      actions: this.store.groups().flatMap((group) => group.actions),
      hasFinalText: projection.hasTrailingText,
      reasoningActive: projection.reasoningActive,
      streaming: this.working,
    })
  }

  render(width = 78): string[] {
    return plain(
      new RailComponent(
        () => this.store,
        theme,
        false,
        () => this.pending,
      ).render(width),
    )
  }
}

describe('live turn', () => {
  test('a thinking block alone opens the rail', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.messageEnd([{ thinking: '# Plan\nweigh the options' }])
    const lines = turn.render()
    expect(lines[0]).toContain('0 actions')
    expect(lines[1]).toContain('Thought')
    expect(lines[1]).toContain('Plan')
  })

  test('a running tool reads in the present tense', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    expect(turn.render()[1]).toContain('Reading')
  })

  test('the same tool switches to the past tense when it finishes', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    const line = turn.render()[1] ?? ''
    expect(line).toContain('Read')
    expect(line).not.toContain('Reading')
  })

  test('the pending row appears in the gap after the last tool', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    expect(turn.render().at(-1)).toContain('Thinking')
  })

  test('the pending row disappears once the answer arrives', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    turn.messageEnd([{ text: 'The note says hello.' }])
    expect(turn.render().some((line) => line.includes('Thinking'))).toBe(false)
  })

  test('the pending row disappears when the turn ends', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    turn.agentEnd()
    expect(turn.render().some((line) => line.includes('Thinking'))).toBe(false)
  })

  test('repeated calls of one tool fold into a run', () => {
    const turn = new Turn()
    turn.agentStart()
    for (const id of ['a', 'b', 'c']) {
      turn.toolStart('read', id, { path: `${id}.ts` })
      turn.toolEnd(id, 'x')
    }
    turn.agentEnd()
    const lines = turn.render()
    expect(lines[1]).toContain('\u00D73')
    expect(lines[0]).toContain('3 actions')
  })

  test('a nested call renders under its parent', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('bash', 'p', { command: 'run agent' })
    turn.childStart('p', 'c', 'read', { path: 'deep.ts' })
    turn.childEnd('p', 'c', 'one\ntwo')
    turn.toolEnd('p', 'done')
    turn.agentEnd()
    const lines = turn.render()
    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('deep.ts')
    expect(lines[2]?.startsWith('    ')).toBe(true)
  })

  test('a full turn keeps every line inside the width', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.messageEnd([{ thinking: '# Plan' }])
    turn.toolStart('read', 'a', { path: 'a-very-long-path/that/keeps/going/on.ts' })
    turn.toolEnd('a', 'x'.repeat(400))
    turn.messageEnd([{ text: 'done' }])
    turn.agentEnd()
    for (const line of turn.render(40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
  })

  test('keeps final prose outside the rail', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.messageEnd([{ thinking: '# Plan' }])
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    turn.messageEnd([{ text: 'The note says hello.' }])
    turn.agentEnd()
    const lines = turn.render()
    expect(lines[1]).toContain('Thought')
    expect(lines[2]).toContain('Read')
    expect(lines.some((line) => line.includes('Note'))).toBe(false)
  })

  test('orders an intermediate Note between tool calls', () => {
    const turn = new Turn()
    turn.agentStart()
    turn.toolStart('read', 'a', { path: 'note.md' })
    turn.toolEnd('a', 'hello')
    turn.narrateBeforeTool('Found it.', 'bash', 'b', { command: 'true' })
    turn.toolEnd('b', '')
    turn.agentEnd()
    const lines = turn.render()
    expect(lines[1]).toContain('Read')
    expect(lines[2]).toContain('Note')
    expect(lines[3]).toContain('Ran')
  })
})
