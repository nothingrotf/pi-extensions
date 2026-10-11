import { describe, expect, it } from 'vite-plus/test'

import { reviewPrompt } from '../../packages/pstack/src/delivery-engine.ts'
import { formatReport, type RunResult, sessionRunMetrics } from './metrics.ts'
import {
  benchmarkPrompt,
  ENGINE_DISPATCH_LIMIT,
  REPLAY_REVIEW_BRIEF,
  REPLAY_ROUND_LIMIT,
  replayEnginePrompt,
  replayPrompt,
} from './prompts.ts'
import { ownerPolicy, replayTasks, reviewerPolicy } from './replays.ts'

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
          role: 'bug-fix',
          runGeneration: 1,
          timing: {
            requestedAt: 1000,
            executionStartedAt: 1500,
            executionEndedAt: 11_500,
            workspaceSetupMs: 400,
          },
        },
        { agentId: 'static', role: 'code review', runGeneration: 2 },
        {
          agentId: 'runtime',
          role: 'runtime verification',
          runGeneration: 1,
          timing: {
            requestedAt: 12_000,
            executionStartedAt: 12_000,
            executionEndedAt: 20_000,
            workspaceSetupMs: 0,
          },
        },
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
      agentExecutionMs: 18_000,
      attempts: 3,
      ownerAttempts: 1,
      ownerExecutionMs: 10_000,
      reviewExecutionMs: 0,
      runtimeExecutionMs: 8000,
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

  it('counts gate calls, reused passes, and long commands in every session', () => {
    const call = (timestamp: string, id: string, name: string) => ({
      type: 'message',
      timestamp,
      message: { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: {} }] },
    })
    const done = (timestamp: string, id: string, name: string, text: string) => ({
      type: 'message',
      timestamp,
      message: {
        role: 'toolResult',
        toolCallId: id,
        toolName: name,
        content: [{ type: 'text', text }],
      },
    })
    const worker = jsonl(
      { type: 'session', timestamp: '2026-01-01T00:00:00.000Z', parentSession: 'root.jsonl' },
      call('2026-01-01T00:00:01.000Z', 'suite', 'pstack_gate'),
      done('2026-01-01T00:01:31.000Z', 'suite', 'pstack_gate', 'Gate passed: test'),
      call('2026-01-01T00:01:32.000Z', 'again', 'pstack_gate'),
      done('2026-01-01T00:01:33.000Z', 'again', 'pstack_gate', 'Gate passed. No command ran.'),
      call('2026-01-01T00:01:34.000Z', 'focused', 'bash'),
      done('2026-01-01T00:01:40.000Z', 'focused', 'bash', 'ok'),
      call('2026-01-01T00:01:41.000Z', 'slow', 'bash'),
      done('2026-01-01T00:02:41.000Z', 'slow', 'bash', 'ok'),
      call('2026-01-01T00:02:42.000Z', 'read', 'read'),
      done('2026-01-01T00:03:42.000Z', 'read', 'read', 'text'),
    )
    expect(
      sessionRunMetrics([
        { content: worker, path: 'worker.jsonl' },
        { content: root, path: 'root.jsonl' },
      ]),
    ).toMatchObject({ gateCalls: 2, gateReuses: 1, longCommandMs: 150_000, longCommands: 2 })
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

  it('replays each real task with every criterion and the same review models', () => {
    const models = { code: 'review/model:high', runtime: 'verify/model:low' }
    for (const task of replayTasks) {
      const prompt = replayPrompt(task, models)
      for (const criterion of task.criteria) expect(prompt).toContain(`id "${criterion.id}"`)
      expect(prompt).toContain(`issue "${task.issue}"`)
      expect(prompt).toContain('role "bug-fix"')
      expect(prompt).toContain('model "review/model:high"')
      expect(prompt).toContain(`after ${REPLAY_ROUND_LIMIT} implementation submissions`)
      expect(prompt).toContain(
        JSON.stringify(reviewPrompt('runtime verification', REPLAY_REVIEW_BRIEF)),
      )
      expect(replayEnginePrompt(task, models)).toContain(
        `"brief":${JSON.stringify(REPLAY_REVIEW_BRIEF)}`,
      )
      expect(task.acceptance.join(' ')).toContain(task.hiddenTests[0] ?? 'missing')
    }
  })

  it('counts engine dispatches and reads the engine checkpoint', () => {
    const engine = jsonl(
      { type: 'session', timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo' },
      {
        type: 'message',
        timestamp: '2026-01-01T00:05:00.000Z',
        message: {
          role: 'toolResult',
          toolName: 'pstack_deliver',
          content: [
            {
              type: 'text',
              text: `Engine stop: accepted\nSteps:\n\nCheckpoint: ${JSON.stringify({ summary: { state: 'accepted' } })}`,
            },
          ],
          details: {
            steps: [
              { step: 'workspace', agents: [] },
              { step: 'implement', agents: [{ agentId: 'owner' }] },
              { step: 'record', agents: [{ agentId: 'owner' }] },
              { step: 'review', agents: [{ agentId: 's' }, { agentId: 'r' }] },
            ],
          },
        },
      },
    )
    const metrics = sessionRunMetrics([{ content: engine, path: '/sessions/root.jsonl' }])
    expect(metrics).toMatchObject({
      acceptedAfterMs: 300_000,
      finalState: 'accepted',
      taskDispatches: 3,
    })
  })

  it('gives the engine arm the same criteria, owner, and review models', () => {
    const models = { code: 'review/model:high', runtime: 'verify/model:low' }
    for (const task of replayTasks) {
      const prompt = replayEnginePrompt(task, models)
      for (const criterion of task.criteria) expect(prompt).toContain(`id "${criterion.id}"`)
      expect(prompt).toContain('Call pstack_deliver once')
      expect(prompt).toContain('"role":"bug-fix"')
      expect(prompt).toContain('"codeModel":"review/model:high"')
      expect(prompt).toContain('"runtimeModel":"verify/model:low"')
      expect(prompt).toContain(`"maxDispatches":${ENGINE_DISPATCH_LIMIT}`)
    }
  })

  it('swaps only the implementation owner roles in a policy copy', () => {
    const policy = [
      '---',
      'description: models',
      '---',
      'feature: openai/a:medium [fast]',
      'bug-fix: openai/a:high [fast]',
      'code review: openai/b:xhigh, anthropic/c:xhigh',
      '',
    ].join('\n')
    const swapped = ownerPolicy(policy, 'anthropic/c:medium')
    expect(swapped).toContain('code review: openai/b:xhigh, anthropic/c:xhigh')
    expect(swapped).toContain('description: models')
    for (const role of ['feature', 'refactoring', 'bug-fix', 'perf-issue', 'hillclimb']) {
      expect(swapped.split('\n').filter((line) => line.startsWith(`${role}:`))).toEqual([
        `${role}: anthropic/c:medium`,
      ])
    }
    const reviewed = reviewerPolicy(swapped, 'anthropic/c:high')
    expect(reviewed.split('\n').filter((line) => line.startsWith('code review:'))).toEqual([
      'code review: anthropic/c:high',
    ])
    expect(reviewed).toContain('bug-fix: anthropic/c:medium')
  })
})
