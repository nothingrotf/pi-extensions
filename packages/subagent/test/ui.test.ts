import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vite-plus/test'

import {
  activitySnippet,
  describeCall,
  oneLineLabel,
  SubagentsWidget,
  type SubagentTheme,
} from '../src/format.ts'
import { createPeekPane, eventLines } from '../src/peek.ts'
import type { SubagentSnapshot } from '../src/runtime.ts'

const theme: SubagentTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
  getFgAnsi: () => '',
}

function snapshot(
  agentId: string,
  description: string,
  status: SubagentSnapshot['status'],
  sessionFile: string,
): SubagentSnapshot {
  const running = status === 'running'
  return {
    agentId,
    contextState: undefined,
    description,
    effort: 'high',
    endedAt: running ? undefined : 2_000,
    error: status === 'failed' ? 'Failure' : undefined,
    intercomUsage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      durationMs: 0,
      input: 0,
      output: 0,
      toolCalls: 0,
      turns: 0,
    },
    lastActivity: running ? 'read' : undefined,
    model: 'openai-codex/gpt-5.6-sol',
    output: status === 'completed' ? 'Done' : undefined,
    readonly: true,
    retryFailure: undefined,
    retryState: undefined,
    running,
    sessionFile,
    startedAt: 1_000,
    status,
    subagentType: 'explore',
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      durationMs: 1_000,
      input: 1200,
      output: 300,
      toolCalls: 2,
      turns: 1,
    },
  }
}

describe('subagent TUI', () => {
  it('renders the same compact widget shape and respects terminal width', () => {
    const snapshots = [
      snapshot('active', 'Inspect runtime', 'running', '/tmp/active.jsonl'),
      snapshot('done', 'Review tests', 'completed', '/tmp/done.jsonl'),
    ]
    const widget = new SubagentsWidget(() => snapshots, theme)
    const lines = widget.render(72)
    expect(lines).toEqual([' Subagents', '  └─ • Inspect runtime ⟦explore⟧ read', ''])
    expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true)
    expect(new SubagentsWidget(() => snapshots.slice(1), theme).render(72)).toEqual([])
  })

  it('formats detailed live activity from tool arguments and assistant text', () => {
    expect(
      describeCall('read', { path: '/workspace/packages/subagent/src/runtime.ts' }, '/workspace'),
    ).toBe('Read packages/subagent/src/runtime.ts')
    expect(describeCall('bash', { command: 'bun run test' }, '/workspace')).toBe(
      'Bash bun run test',
    )
    expect(activitySnippet('A child\nreturned   a concise result.')).toBe(
      'A child returned a concise result.',
    )
    expect(oneLineLabel('\u001B[31mUnsafe\u001B[0m\nlabel\u200B')).toBe('Unsafe label')
    expect(oneLineLabel('left\u0085right')).toBe('left right')
    expect(oneLineLabel('😀😀😀', 3)).toBe('😀😀😀')
    expect(oneLineLabel('😀😀😀', 2)).toBe('😀…')
  })

  it('parses transcript calls, results, and errors for the tail pane', () => {
    const call = JSON.stringify({
      message: {
        content: [
          {
            arguments: { path: '/workspace/packages/subagent/src/runtime.ts' },
            name: 'read',
            type: 'toolCall',
          },
        ],
        role: 'assistant',
      },
    })
    const result = JSON.stringify({
      message: {
        content: [{ text: 'Permission denied', type: 'text' }],
        isError: true,
        role: 'toolResult',
        toolName: 'read',
      },
    })
    expect(eventLines(call)).toEqual([
      {
        gutter: '→',
        kind: 'call',
        text: 'read …/subagent/src/runtime.ts',
      },
    ])
    expect(eventLines(result)).toEqual([
      {
        gutter: '✗',
        kind: 'error',
        text: 'read: Permission denied',
      },
    ])
  })

  it('discards a partial oversized JSONL entry and renders later complete entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'subagent-peek-tail-'))
    const sessionFile = join(dir, 'child.jsonl')
    const oversized = JSON.stringify({
      message: {
        content: [{ text: 'x'.repeat(70 * 1024), type: 'text' }],
        role: 'assistant',
      },
    })
    const complete = JSON.stringify({
      message: {
        content: [{ text: 'Visible complete entry', type: 'text' }],
        role: 'assistant',
      },
    })
    await writeFile(sessionFile, `${oversized}\n${complete}\n`)
    const pane = createPeekPane(
      () => [snapshot('active', 'Inspect tail', 'running', sessionFile)],
      theme,
      () => {},
      () => {},
      () => {},
    )
    try {
      pane.handleInput('\r')
      const rendered = pane.render(80).join('\n')
      expect(rendered).toContain('Visible complete entry')
      expect(rendered).not.toContain('xxxxxxxx')
    } finally {
      pane.dispose()
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('keeps a complete entry that starts exactly at the tail boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'subagent-peek-boundary-'))
    const sessionFile = join(dir, 'child.jsonl')
    const boundary = JSON.stringify({
      message: {
        content: [{ text: 'Boundary entry remains visible', type: 'text' }],
        role: 'assistant',
      },
    })
    const emptyFiller = JSON.stringify({
      message: { content: [{ text: '', type: 'text' }], role: 'assistant' },
    })
    const fillerLength = 64 * 1024 - Buffer.byteLength(`${boundary}\n${emptyFiller}\n`)
    const filler = JSON.stringify({
      message: { content: [{ text: 'x'.repeat(fillerLength), type: 'text' }], role: 'assistant' },
    })
    await writeFile(sessionFile, `{}\n${boundary}\n${filler}\n`)
    const pane = createPeekPane(
      () => [snapshot('active', 'Inspect boundary', 'running', sessionFile)],
      theme,
      () => {},
      () => {},
      () => {},
    )
    try {
      pane.handleInput('\r')
      pane.handleInput('g')
      expect(pane.render(80).join('\n')).toContain('Boundary entry remains visible')
    } finally {
      pane.dispose()
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('keeps cancellation bound to the selected Agent ID after reordering', () => {
    const first = snapshot('first', 'First task', 'running', '/tmp/first.jsonl')
    const second = snapshot('second', 'Second task', 'running', '/tmp/second.jsonl')
    let snapshots = [first, second]
    let aborted: string | undefined
    const pane = createPeekPane(
      () => snapshots,
      theme,
      () => {},
      () => {},
      (item) => {
        aborted = item.agentId
      },
    )
    try {
      pane.render(80)
      pane.handleInput('x')
      snapshots = [second, first]
      pane.handleInput('y')
      expect(aborted).toBe('first')
    } finally {
      pane.dispose()
    }
  })

  it('opens transcript tail, navigates, and confirms cancellation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'subagent-peek-'))
    const sessionFile = join(dir, 'child.jsonl')
    await writeFile(
      sessionFile,
      `${JSON.stringify({
        message: {
          content: [
            {
              text: 'Child result includes enough detail to wrap across rows without a detached truncation marker at the pane boundary.',
              type: 'text',
            },
          ],
          role: 'assistant',
        },
      })}\n`,
    )
    const snapshots = [snapshot('active', 'Inspect runtime', 'running', sessionFile)]
    let closed = false
    let aborted: string | undefined
    let renders = 0
    const pane = createPeekPane(
      () => snapshots,
      theme,
      () => {
        renders += 1
      },
      () => {
        closed = true
      },
      (item) => {
        aborted = item.agentId
      },
    )
    try {
      const listLines = pane.render(80)
      expect(listLines.join('\n')).toContain('• Inspect runtime · 2 tools')
      expect(listLines.every((line) => visibleWidth(line) <= 80)).toBe(true)
      pane.handleInput('\r')
      const tailLines = pane.render(80)
      const renderedTail = tailLines.join('\n')
      expect(renderedTail).toContain('Child result includes enough detail')
      expect(renderedTail).toContain('truncation marker at the pane boundary.')
      expect(renderedTail).not.toContain('…')
      expect(tailLines.every((line) => visibleWidth(line) <= 80)).toBe(true)
      pane.handleInput('\x1b')
      pane.handleInput('x')
      expect(pane.render(80).join('\n')).toContain('abort Inspect runtime?  y / n')
      pane.handleInput('y')
      expect(aborted).toBe('active')
      pane.handleInput('\x1b')
      expect(closed).toBe(true)
      expect(renders).toBeGreaterThan(0)
    } finally {
      pane.dispose()
      await rm(dir, { force: true, recursive: true })
    }
  })
})
