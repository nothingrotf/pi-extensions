import { initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { beforeAll, describe, expect, it } from 'vite-plus/test'

import type { SubagentTheme } from '../src/format.ts'
import {
  type AgentRow,
  formatCount,
  renderAgentRows,
  summaryLine,
  TaskCall,
  taskCallHeader,
} from '../src/task-render.ts'

const theme: SubagentTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
  getFgAnsi: () => '',
}

function row(label: string, status: AgentRow['status'], extra: Partial<AgentRow> = {}): AgentRow {
  return {
    activity: undefined,
    agentType: 'shell',
    background: false,
    context: undefined,
    cost: 0,
    durationMs: 65_000,
    error: undefined,
    label,
    output: undefined,
    status,
    task: undefined,
    toolCalls: 0,
    ...extra,
  }
}

const strip = (lines: string[]): string[] =>
  lines.map((line) => stripTerminalSequences(line).trimEnd())

describe('task rendering', () => {
  beforeAll(() => {
    initTheme('dark')
  })

  it('formats counts like the reference', () => {
    expect(formatCount(999)).toBe('999')
    expect(formatCount(2_400)).toBe('2.4K')
    expect(formatCount(272_000)).toBe('272K')
  })

  it('renders the call header, brief, and agent rows', () => {
    expect(
      stripTerminalSequences(
        taskCallHeader({ run_in_background: true, subagent_type: 'shell' }, theme),
      ),
    ).toBe('⇶ Task: shell background')
    const call = new TaskCall(
      { description: 'Probe registry', prompt: '# Goal\nRun the suite.', subagent_type: 'shell' },
      theme,
      {},
    )
    const lines = strip(call.render(80))
    expect(lines[0]).toBe('⇶ Task: shell')
    expect(lines).toContain('• Probe registry: # Goal ⟦shell⟧')
    expect(lines.some((line) => line.includes('Run the suite.'))).toBe(true)
    const withResult = new TaskCall(
      { description: 'Probe', prompt: 'x', subagent_type: 'shell' },
      theme,
      {
        hasResult: true,
      },
    )
    expect(strip(withResult.render(80)).some((line) => line.startsWith('• '))).toBe(false)
  })

  it('renders live, done, and failed rows with stats and output', () => {
    const rows = [
      row('Ampere', 'running', {
        activity: 'Bash bun test',
        context: { percent: 5.1, window: 272_000 },
        cost: 0.12,
        toolCalls: 3,
      }),
      row('Ada', 'completed', { cost: 0.3, output: 'ok\nline two', toolCalls: 12 }),
      row('Blackwell', 'failed', { error: 'boom' }),
    ]
    expect(strip(renderAgentRows(rows, { expanded: false, live: false }, theme))).toEqual([
      '• Ada ⟦shell⟧ ⟦done⟧ · 12 🛠 · $0.30 · 1m5s',
      '  Output',
      '    ok',
      '    line two',
      '✘ Blackwell ⟦shell⟧ ⟦failed⟧ · 1m5s',
      '  ✘ boom',
      '• Ampere ⟦shell⟧ · 3 🛠 · 5.1%/272K · $0.12',
      '  └ Bash bun test',
    ])
    expect(stripTerminalSequences(summaryLine(rows, 65_000, theme))).toBe(
      '⟦1 succeeded · 1 failed · 1m5s⟧',
    )
  })

  it('folds rows past the collapsed cap', () => {
    const rows = Array.from({ length: 6 }, (_value, index) => row(`r${index}`, 'completed'))
    const lines = strip(renderAgentRows(rows, { expanded: false, live: false }, theme))
    expect(lines[0]).toBe('… 2 more agents')
    expect(lines).toHaveLength(5)
    expect(renderAgentRows(rows, { expanded: true, live: false }, theme)).toHaveLength(6)
  })
})
