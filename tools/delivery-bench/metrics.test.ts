import { describe, expect, it } from 'vite-plus/test'

import { formatReport, type RunResult, sessionRunMetrics } from './metrics.ts'
import { benchmarkPrompt } from './prompts.ts'

function jsonl(...entries: readonly object[]): string {
  return `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`
}

function checkpoint(timestamp: string, state: string) {
  return {
    type: 'message',
    timestamp,
    message: {
      role: 'toolResult',
      toolName: 'pstack_delivery',
      content: [{ type: 'text', text: JSON.stringify({ summary: { state } }) }],
    },
  }
}

const root = jsonl(
  { type: 'session', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo' },
  {
    type: 'message',
    timestamp: '2026-01-01T00:00:01.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'a', name: 'Task', arguments: { prompt: 'fix' } }],
    },
  },
  {
    type: 'custom',
    timestamp: '2026-01-01T00:00:02.000Z',
    customType: '@nothingrotf/pstack/delivery-workspace-v1',
    data: { worktree: '/worktrees/issue' },
  },
  {
    type: 'custom',
    timestamp: '2026-01-01T00:00:03.000Z',
    customType: 'pi-subagent-state',
    data: {
      records: [
        {
          agentId: 'owner',
          runGeneration: 1,
          timing: {
            requestedAt: 1000,
            executionStartedAt: 1400,
            executionEndedAt: 11_400,
            workspaceSetupMs: 300,
          },
        },
      ],
    },
  },
  checkpoint('2026-01-01T00:00:10.000Z', 'candidate'),
  {
    type: 'message',
    timestamp: '2026-01-01T00:00:11.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'b',
          name: 'Task',
          arguments: { tasks: [{ id: 's' }, { id: 'r' }] },
        },
      ],
    },
  },
  {
    type: 'custom',
    timestamp: '2026-01-01T00:00:12.000Z',
    customType: 'pi-subagent-state',
    data: {
      records: [
        {
          agentId: 'owner',
          runGeneration: 1,
          timing: {
            requestedAt: 1000,
            executionStartedAt: 1500,
            executionEndedAt: 11_500,
            workspaceSetupMs: 400,
          },
        },
        { agentId: 'static', runGeneration: 2 },
      ],
    },
  },
  checkpoint('2026-01-01T00:01:30.000Z', 'accepted'),
  checkpoint('2026-01-01T00:01:40.000Z', 'accepted'),
)

const child = jsonl({
  type: 'session',
  timestamp: '2026-01-01T00:00:01.500Z',
  cwd: '/worktrees/issue',
  parentSession: '/sessions/root.jsonl',
})

function result(arm: string, run: number, wallMs: number): RunResult {
  return {
    ...sessionRunMetrics([{ content: root, path: 'root.jsonl' }]),
    acceptance: 'pass',
    arm,
    exitCode: 0,
    run,
    setupRuns: arm === 'baseline' ? 3 : 1,
    wallMs,
  }
}

describe('delivery benchmark metrics', () => {
  it('derives acceptance, dispatches, and attempt timing from the root session', () => {
    expect(
      sessionRunMetrics([
        { content: child, path: 'child.jsonl' },
        { content: root, path: 'root.jsonl' },
      ]),
    ).toMatchObject({
      acceptedAfterMs: 90_000,
      agentExecutionMs: 10_000,
      attempts: 2,
      childSessions: 1,
      coordinatorTurns: 2,
      finalState: 'accepted',
      preparationMs: 500,
      rootSession: 'root.jsonl',
      taskDispatches: 3,
      workspaceSetupMs: 400,
      worktree: '/worktrees/issue',
    })
  })

  it('reports each run and the median of each arm', () => {
    const report = formatReport([
      result('baseline', 1, 200_000),
      result('workspace', 1, 100_000),
      result('baseline', 2, 300_000),
      result('workspace', 2, 120_000),
    ])
    expect(report).toContain('| baseline | 2 | 2 | 2 | 250.0 | 90.0 | 3 |')
    expect(report).toContain('| workspace | 2 | 2 | 2 | 110.0 | 90.0 | 1 |')
  })

  it('keeps the two arms on the same criteria and models', () => {
    const models = { code: 'review/model:high', runtime: 'verify/model:low' }
    const baseline = benchmarkPrompt('baseline', models)
    const workspace = benchmarkPrompt('workspace', models)
    for (const prompt of [baseline, workspace]) {
      expect(prompt).toContain('id "bulk"')
      expect(prompt).toContain('id "unknown"')
      expect(prompt).toContain('model "review/model:high"')
      expect(prompt).toContain('model "verify/model:low"')
    }
    expect(baseline).toContain('never call pstack_delivery with action "workspace"')
    expect(baseline).toContain('{"mode":"worktree","integration":"manual"}')
    expect(baseline).toContain('Dispatch a new Task, not a resume')
    expect(workspace).toContain('resume next.resume')
    expect(workspace).not.toContain('"integration":"manual"')
  })
})
