import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  renderTaskControlCall,
  renderTaskControlResult,
  serializeTaskControl,
  TaskControlInputSchema,
  type TaskControlScope,
  waitForJobs,
} from '../src/control.ts'
import type { JobProgressDetails } from '../src/jobs.ts'
import type { SubagentSnapshot } from '../src/runtime.ts'

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
  getFgAnsi: () => '',
}

function snapshot(agentId: string, running: boolean): SubagentSnapshot {
  const usage = {
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    durationMs: 0,
    input: 0,
    output: 0,
    toolCalls: 0,
    turns: 0,
  }
  return {
    agentId,
    contextState: undefined,
    description: `${agentId} lane`,
    effort: 'high',
    endedAt: running ? undefined : 5_000,
    error: undefined,
    intercomUsage: usage,
    lastActivity: undefined,
    model: 'model',
    output: undefined,
    readonly: true,
    retryFailure: undefined,
    retryState: undefined,
    running,
    sessionFile: `/tmp/${agentId}.jsonl`,
    startedAt: 1_000,
    status: running ? 'running' : 'completed',
    subagentType: 'shell',
    usage,
  }
}

function fixture(initial: SubagentSnapshot[]) {
  let snapshots = initial
  const listeners = new Set<() => void>()
  const messages: (string | undefined)[] = []
  const updates: JobProgressDetails[] = []
  const scope: TaskControlScope = {
    allows: () => true,
    callerId: () => 'root',
    cancel: () => Promise.reject(new Error('unused')),
    destination: () => Promise.reject(new Error('unused')),
    snapshots: () => snapshots,
    steer: () => Promise.reject(new Error('unused')),
  }
  return {
    host: { hasUI: true, ui: { setWorkingMessage: (message?: string) => messages.push(message) } },
    messages,
    runtime: {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    scope,
    settle(agentId: string) {
      snapshots = snapshots.map((entry) =>
        entry.agentId === agentId ? snapshot(agentId, false) : entry,
      )
      for (const listener of listeners) listener()
    },
    updates,
    onUpdate: (partial: { details?: JobProgressDetails }) => {
      if (partial.details !== undefined) updates.push(partial.details)
    },
  }
}

describe('task control wait', () => {
  it('validates the wait and jobs inputs', () => {
    expect(Value.Check(TaskControlInputSchema, { action: 'wait' })).toBe(true)
    expect(Value.Check(TaskControlInputSchema, { action: 'wait', agent_ids: [] })).toBe(false)
    expect(Value.Check(TaskControlInputSchema, { action: 'wait', timeout_ms: 10 })).toBe(false)
    expect(Value.Check(TaskControlInputSchema, { action: 'jobs' })).toBe(true)
  })

  it('returns idle when nothing runs', async () => {
    const state = fixture([snapshot('done', false)])
    const details = await waitForJobs({ action: 'wait' }, state.host, state.runtime, state.scope, {
      onUpdate: state.onUpdate,
      signal: undefined,
    })
    expect(details).toEqual({ action: 'wait', jobs: [], outcome: 'idle', settled: [] })
    expect(state.messages).toEqual([])
  })

  it('streams the job tree and returns on the first settled job', async () => {
    const state = fixture([snapshot('a', true), snapshot('b', true)])
    const pending = waitForJobs({ action: 'wait' }, state.host, state.runtime, state.scope, {
      onUpdate: state.onUpdate,
      signal: undefined,
    })
    expect(state.messages.at(-1)).toBe('Waiting on 2 jobs')
    expect(state.updates.at(-1)?.jobs.map((job) => job.agentId)).toEqual(['a', 'b'])
    state.settle('b')
    const details = await pending
    expect(details.outcome).toBe('settled')
    expect(details.settled).toEqual(['b'])
    expect(state.messages.at(-1)).toBeUndefined()
    expect(serializeTaskControl(details)).toContain('Settled: b.')
    expect(serializeTaskControl(details)).toContain('- a running "a lane"')
  })

  it('returns on timeout and on abort', async () => {
    vi.useFakeTimers()
    try {
      const state = fixture([snapshot('a', true)])
      const timed = waitForJobs(
        { action: 'wait', timeout_ms: 1_000 },
        state.host,
        state.runtime,
        state.scope,
        { onUpdate: undefined, signal: undefined },
      )
      await vi.advanceTimersByTimeAsync(1_000)
      expect((await timed).outcome).toBe('timeout')
      const controller = new AbortController()
      const aborted = waitForJobs({ action: 'wait' }, state.host, state.runtime, state.scope, {
        onUpdate: undefined,
        signal: controller.signal,
      })
      controller.abort()
      expect((await aborted).outcome).toBe('aborted')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the call and result frames with the job tree', () => {
    const call = (input: Parameters<typeof renderTaskControlCall>[0]): string[] =>
      renderTaskControlCall(input, theme)
        .render(80)
        .map((line) => stripTerminalSequences(line).trimEnd())
    expect(call({ action: 'wait' })).toEqual(['TaskControl wait all running jobs'])
    expect(call({ action: 'wait', agent_ids: ['a'] })).toEqual(['TaskControl wait 1 job'])
    expect(call({ action: 'jobs' })).toEqual(['TaskControl jobs'])
    expect(call({ action: 'status', agent_id: 'a' })).toEqual(['TaskControl status a'])
    const jobs = [
      {
        agentId: 'a',
        description: 'a lane',
        durationMs: 4_000,
        lastActivity: undefined,
        status: 'running' as const,
      },
      {
        agentId: 'b',
        description: 'b lane',
        durationMs: 4_000,
        lastActivity: undefined,
        status: 'completed' as const,
      },
    ]
    const progress = renderTaskControlResult(
      { jobs, status: 'progress' },
      '',
      { expanded: false, isPartial: true },
      theme,
    ).render(80)
    expect(progress[0]).toBe('ⓘ waiting on 1 of 2 jobs 1 done')
    expect(progress).toHaveLength(3)
    const sealed = renderTaskControlResult(
      { action: 'wait', jobs, outcome: 'settled', settled: ['b'] },
      '',
      { expanded: false, isPartial: false },
      theme,
    ).render(80)
    expect(sealed).toEqual(['✔ 1 job settled 1 done', '└─ • ⟦task⟧ b lane 4.0s'])
    const listing = renderTaskControlResult(
      { action: 'jobs', jobs },
      '',
      { expanded: false, isPartial: false },
      theme,
    ).render(80)
    expect(listing).toEqual([
      'ⓘ waiting on 1 of 2 jobs 1 done',
      '├─ ⟳ ⟦task⟧ a lane 4.0s',
      '└─ • ⟦task⟧ b lane 4.0s',
    ])
  })
})
