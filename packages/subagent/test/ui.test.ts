import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vite-plus/test'

import { quotedBody, renderIntercomCard } from '../src/cards.ts'
import {
  activitySnippet,
  describeCall,
  oneLineLabel,
  renderSubagentHudLines,
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

it('renders send age separately from delivery latency and acknowledgment', () => {
  const lines = renderIntercomCard(
    { agentId: 'child', kind: 'notification', level: 'warning', message: 'Check dependency' },
    'Child',
    9_000,
    {
      expanded: false,
      now: 120_000,
      delivery: {
        agentId: 'child',
        content: 'Check dependency',
        customType: 'subagent-intercom',
        display: true,
        id: 'notice',
        kind: 'notice',
        level: 'warning',
        ownerSessionId: 'owner',
        runGeneration: 1,
        sentAt: 0,
        queuedAt: 0,
        deliveredAt: 60_000,
        state: 'delivered',
      },
    },
    theme,
  ).join('\n')
  expect(lines).toContain('sent 2m ago')
  expect(lines).toContain('queue 1m')
  expect(lines).toContain('delivered')
  expect(lines).not.toContain('acknowledged')
})

function snapshot(
  agentId: string,
  description: string,
  status: SubagentSnapshot['status'],
  sessionFile: string,
  background = false,
): SubagentSnapshot {
  const running = status === 'running'
  return {
    agentId,
    background,
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
  it('wraps full IRC text instead of losing content after eighty columns', () => {
    const message =
      'A complete report with enough text to cross the old fixed column limit. '.repeat(4) +
      'FINAL EVIDENCE'
    for (const width of [32, 80, 160]) {
      const lines = quotedBody(message, theme, { expanded: true, width })
      const body = lines.map((line) => line.replace(/^  ▏ /u, '').trim()).join(' ')
      expect(body).toBe(message)
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
      expect(lines.join('\n')).not.toContain('…')
    }
  })

  it('bounds collapsed IRC previews and retains full text on expansion', () => {
    const body = Array.from({ length: 30 }, (_, index) => `Evidence ${index}`).join('\n')
    const collapsed = quotedBody(body, theme, { expanded: false, width: 40 })
    expect(collapsed).toHaveLength(4)
    expect(collapsed.at(-1)).toContain('+27 more lines')
    const expanded = quotedBody(body, theme, { expanded: true, width: 40 })
    expect(expanded).toHaveLength(30)
    expect(expanded.at(-1)).toContain('Evidence 29')
  })

  it('uses available widget width for complete agent names', () => {
    const name = 'Eliminar custos extras nas chamadas do agente'
    const agent = snapshot('wide', name, 'running', '/tmp/one.jsonl', true)
    for (const width of [80, 120, 180]) {
      const lines = renderSubagentHudLines([agent], theme, width, 2_500)
      expect(lines.join('\n')).toContain(name)
      expect(lines.join('\n')).not.toContain('…')
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
    }
  })

  it('wraps long Unicode agent names without dropping their tail', () => {
    const words = Array.from({ length: 40 }, (_, index) => `界面${index}`)
    const agent = snapshot('long', words.join(' '), 'running', '/tmp/one.jsonl', true)
    for (const width of [32, 60, 120]) {
      const lines = renderSubagentHudLines([agent], theme, width, 2_500)
      const text = lines.map(stripTerminalSequences).join('\n')
      expect(text.replace(/\s/gu, '')).toContain(words.join(''))
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
    }
  })

  it('keeps IRC quote rows within narrow terminal widths', () => {
    for (let width = 0; width <= 40; width += 1) {
      for (const expanded of [false, true]) {
        const lines = quotedBody('界面 🙂 é '.repeat(10), theme, { expanded, width })
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
      }
    }
  })

  it('renders the dispatch panel and respects terminal width', () => {
    const snapshots = [
      snapshot('active', 'Inspect runtime', 'running', '/tmp/active.jsonl'),
      snapshot('done', 'Review tests', 'completed', '/tmp/done.jsonl'),
    ]
    const lines = renderSubagentHudLines(snapshots, theme, 72, 2_500, 'anthropic/claude-opus-5')
    const plainLines = lines.map(stripTerminalSequences)
    expect(plainLines[0]).toMatch(/^   󰚩 dispatch · 2 ▾/)
    expect(plainLines[1]).toContain('◉ opus')
    expect(plainLines[2]).toContain('(◉‿◉) Inspect runtime')
    expect(plainLines[3]).toContain('(✓‿✓) Review tests')
    expect(plainLines.at(-2)).toContain('↯ inspect in the panel')
    expect(plainLines.at(-2)).toContain('ctrl+shift+a')
    expect(plainLines.at(-1)).toBe('')
    expect(lines.every((line) => visibleWidth(line) <= 72)).toBe(true)
    expect(new SubagentsWidget(() => snapshots.slice(1), theme).render(72)).toEqual([])
  })

  it('splits background jobs into their own panel and expires settled rows', () => {
    const foreground = snapshot('foreground', 'Explore files', 'running', '/tmp/foreground.jsonl')
    const background = snapshot('background', 'Run tests', 'running', '/tmp/background.jsonl', true)
    const rendered = renderSubagentHudLines([foreground, background], theme, 120, 2_500).join('\n')
    expect(rendered).toContain('󰚩 dispatch · 1 ▾')
    expect(rendered).toContain('◌ background · 1 ▾')
    const settled = snapshot('done', 'Review tests', 'completed', '/tmp/done.jsonl')
    expect(renderSubagentHudLines([settled], theme, 120, 3_399)).not.toEqual([])
    expect(renderSubagentHudLines([settled], theme, 120, 3_400)).toEqual([])
  })

  it('animates a running thinking face', () => {
    const thinking = snapshot('thinking', 'Reason about tests', 'running', '/tmp/thinking.jsonl')
    thinking.lastActivity = 'Thinking'
    const rows = [0, 480, 960, 1_440].map((now) =>
      stripTerminalSequences(
        renderSubagentHudLines([thinking], theme, 120, now, 'openai-codex/gpt-5.6-sol')[2] ?? '',
      ),
    )
    expect(new Set(rows).size).toBe(4)
  })

  it('aligns widgets with the three-space text inset', () => {
    const snapshots = [snapshot('foreground', 'Inspect runtime', 'running', '/tmp/one.jsonl')]
    for (const item of [
      { inset: 3, width: 55 },
      { inset: 3, width: 56 },
      { inset: 3, width: 79 },
      { inset: 3, width: 80 },
      { inset: 3, width: 109 },
      { inset: 3, width: 110 },
    ]) {
      expect(
        renderSubagentHudLines(snapshots, theme, item.width, 2_500)[0]?.match(/^ */)?.[0].length,
      ).toBe(item.inset)
    }
  })

  it('fits every responsive width', () => {
    const snapshots = [
      snapshot(
        'foreground',
        'Inspect a very long runtime description',
        'running',
        '/tmp/one.jsonl',
      ),
      snapshot(
        'background',
        'Run a very long background command',
        'running',
        '/tmp/two.jsonl',
        true,
      ),
    ]
    for (let width = 8; width <= 140; width += 1) {
      expect(
        renderSubagentHudLines(snapshots, theme, width, 2_500).every(
          (line) => visibleWidth(line) <= width,
        ),
      ).toBe(true)
    }
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
