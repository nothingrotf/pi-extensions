import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import { decodeIntercomDetails, renderIntercomCard } from '../src/cards.ts'
import {
  evidencePage,
  renderTaskControlCall,
  renderTaskControlResult,
  serializeTaskControl,
  TaskControlInputSchema,
  taskStatus,
  type TaskControlRenderState,
  type TaskControlScope,
  waitForJobs,
} from '../src/control.ts'
import type { JobProgressDetails, JobSnapshot } from '../src/jobs.ts'
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
    attempt: 1,
    background: false,
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

function job(agentId: string, status: JobSnapshot['status']): JobSnapshot {
  return {
    agentId,
    context: undefined,
    cost: 0,
    description: `${agentId} lane`,
    durationMs: 4_000,
    lastActivity: undefined,
    status,
    subagentType: 'task',
    toolCalls: 0,
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
    listenerCount: () => listeners.size,
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
  it('keeps evidence pages valid and within the serialized transport budget', () => {
    const source = '\u0000"\n界🙂\\'.repeat(2_000)
    let cursor = 0
    let recovered = ''
    while (cursor < Buffer.byteLength(source)) {
      const result = (content: string, nextCursor: number | null, totalBytes: number) => {
        const details: Parameters<typeof serializeTaskControl>[0] = {
          action: 'evidence',
          agent_id: 'agent',
          attempt: 1,
          content,
          cursor,
          digest: 'a'.repeat(64),
          freshness: 'current',
          next_cursor: nextCursor,
          outcome: 'found',
          section: 'output',
          total_bytes: totalBytes,
        }
        return {
          content: [{ text: serializeTaskControl(details), type: 'text' }],
          details,
        }
      }
      let serializationCalls = 0
      const page = evidencePage(source, cursor, 8 * 1_024, (content, nextCursor, totalBytes) => {
        serializationCalls += 1
        return JSON.stringify(result(content, nextCursor, totalBytes))
      })
      if (page === undefined) throw new Error('The evidence cursor became invalid.')
      const transport = result(page.content, page.nextCursor, page.totalBytes)
      expect(Buffer.byteLength(JSON.stringify(transport))).toBeLessThanOrEqual(32 * 1_024)
      expect(Buffer.byteLength(transport.content[0]?.text ?? '')).toBeLessThanOrEqual(32 * 1_024)
      expect(Buffer.byteLength(JSON.stringify(transport.details))).toBeLessThanOrEqual(32 * 1_024)
      expect(serializationCalls).toBeLessThanOrEqual(16)
      recovered += page.content
      if (page.nextCursor === null) break
      expect(page.nextCursor).toBeGreaterThan(cursor)
      cursor = page.nextCursor
    }
    expect(recovered).toBe(source)
  })

  it('bounds status error content and details without changing runtime records', () => {
    const rawError = '\u0000"界🙂\\'.repeat(10_000)
    const failed: SubagentSnapshot = {
      ...snapshot('failed', false),
      error: rawError,
      status: 'failed',
    }
    const details: Parameters<typeof serializeTaskControl>[0] = {
      action: 'status',
      outcome: 'found',
      task: taskStatus({ latestResult: () => undefined }, failed),
    }
    const content = serializeTaskControl(details)
    expect(failed.error).toBe(rawError)
    expect(details.task.error).toContain('[Preview truncated.]')
    expect(Buffer.byteLength(details.task.error ?? '')).toBeLessThanOrEqual(2 * 1_024 + 22)
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(32 * 1_024)
    expect(Buffer.byteLength(JSON.stringify(details))).toBeLessThanOrEqual(32 * 1_024)
  })

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
    expect(state.listenerCount()).toBe(0)
  })

  it('streams the job tree and returns on the first settled job', async () => {
    const state = fixture([snapshot('a', true), snapshot('b', true)])
    const events: (string | null)[] = []
    const pending = waitForJobs({ action: 'wait' }, state.host, state.runtime, state.scope, {
      events: {
        emit: (_channel: string, data: string | null) => {
          events.push(data)
        },
      },
      onUpdate: state.onUpdate,
      signal: undefined,
    })
    expect(state.messages.at(-1)).toBe('Waiting on 2 jobs')
    expect(events.at(-1)).toBe('Waiting on 2 jobs')
    expect(state.updates.at(-1)?.jobs.map((job) => job.agentId)).toEqual(['a', 'b'])
    state.settle('b')
    const details = await pending
    expect(details.outcome).toBe('settled')
    expect(details.settled).toEqual(['b'])
    expect(state.messages.at(-1)).toBeUndefined()
    expect(events.at(-1)).toBeNull()
    expect(state.listenerCount()).toBe(0)
    expect(serializeTaskControl(details)).toContain('Settled: b.')
    expect(serializeTaskControl(details)).toContain('- a running "a lane"')
  })

  it('cleans up when subscription reports settlement synchronously', async () => {
    let current = snapshot('a', true)
    let subscriptions = 0
    const scope: TaskControlScope = {
      allows: () => true,
      callerId: () => 'root',
      cancel: () => Promise.reject(new Error('unused')),
      destination: () => Promise.reject(new Error('unused')),
      snapshots: () => [current],
      steer: () => Promise.reject(new Error('unused')),
    }
    const details = await waitForJobs(
      { action: 'wait' },
      { hasUI: false, ui: { setWorkingMessage: () => undefined } },
      {
        subscribe: (listener) => {
          subscriptions += 1
          current = snapshot('a', false)
          listener()
          return () => {
            subscriptions -= 1
          }
        },
      },
      scope,
      { onUpdate: undefined, signal: undefined },
    )
    expect(details.outcome).toBe('settled')
    expect(subscriptions).toBe(0)
  })

  it('returns on timeout and on abort', async () => {
    vi.useFakeTimers()
    try {
      const state = fixture([snapshot('a', true)])
      const defaultController = new AbortController()
      let defaultResolved = false
      const defaultWait = waitForJobs({ action: 'wait' }, state.host, state.runtime, state.scope, {
        onUpdate: undefined,
        signal: defaultController.signal,
      }).then((details) => {
        defaultResolved = true
        return details
      })
      await vi.advanceTimersByTimeAsync(300_000)
      expect(defaultResolved).toBe(false)
      defaultController.abort()
      expect((await defaultWait).outcome).toBe('aborted')
      expect(state.listenerCount()).toBe(0)
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
      expect(state.listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders the call and result frames with the job tree', () => {
    const state: TaskControlRenderState = {}
    const call = (input: Parameters<typeof renderTaskControlCall>[0]): string[] =>
      renderTaskControlCall(input, theme, state)
        .render(80)
        .map((line) => stripTerminalSequences(line).trimEnd())
    expect(call({ action: 'wait' })).toEqual(['⏳ all running jobs'])
    expect(call({ action: 'wait', agent_ids: ['a'] })).toEqual(['⏳ poll a'])
    expect(call({ action: 'wait', agent_ids: ['a', 'b'] })).toEqual(['⏳ poll 2 jobs'])
    expect(call({ action: 'jobs' })).toEqual(['⏳ background jobs'])
    expect(call({ action: 'status', agent_id: 'a' })).toEqual(['⏳ status a'])
    expect(call({ action: 'steer', agent_id: 'a', message: 'Focus on tests' })).toEqual([
      '⏳ Steer ➤ a',
      '  ▏ Focus on tests',
    ])
    const jobs = [job('a', 'running'), job('b', 'completed')]
    const progress = renderTaskControlResult(
      { jobs, status: 'progress' },
      '',
      { expanded: false, isPartial: true },
      theme,
      state,
    ).render(80)
    expect(progress[0]).toBe('ⓘ waiting on 1 of 2 jobs 1 done')
    expect(progress).toHaveLength(3)
    expect(call({ action: 'wait' })).toEqual([])
    expect(call({ action: 'status', agent_id: 'a' })).toEqual([])
    const sealed = renderTaskControlResult(
      { action: 'wait', jobs, outcome: 'settled', settled: ['b'] },
      '',
      { expanded: false, isPartial: false },
      theme,
      state,
    ).render(80)
    expect(sealed).toEqual(['✔ 1 job settled 1 done', '╰─ • ⟦task⟧ b lane 4.0s'])
    const listing = renderTaskControlResult(
      {
        action: 'jobs',
        count: 2,
        cursor: 0,
        has_more: false,
        jobs,
        next_cursor: null,
        total: 2,
      },
      '',
      { expanded: false, isPartial: false },
      theme,
      state,
    ).render(80)
    expect(listing).toEqual([
      'ⓘ waiting on 1 of 2 jobs 1 done',
      '├─ ⟳ ⟦task⟧ a lane 4.0s',
      '╰─ • ⟦task⟧ b lane 4.0s',
    ])
  })

  it('renders receipts and intercom cards', () => {
    const state: TaskControlRenderState = {}
    const render = (
      details: Parameters<typeof renderTaskControlResult>[0],
      args?: Parameters<typeof renderTaskControlResult>[6],
    ) =>
      renderTaskControlResult(
        details,
        '',
        { expanded: false, isPartial: false },
        theme,
        state,
        (id) => `${id} lane`,
        args,
      )
        .render(80)
        .map((line) => stripTerminalSequences(line).trimEnd())
    expect(
      render(
        {
          action: 'steer',
          agent_id: 'a',
          outcome: 'queued',
          queued_at: 1,
          reason: null,
          revision: 1,
        },
        { action: 'steer', agent_id: 'a', message: 'Focus on tests' },
      ),
    ).toEqual(['✉ Steer ➤ a lane queued', '  ▏ Focus on tests'])
    expect(
      render({
        action: 'cancel',
        agent_id: 'a',
        outcome: 'requested',
        reason: 'stop',
        revision: 1,
      }),
    ).toEqual(['⏹ Cancel a lane requested · stop'])
    expect(
      render({
        action: 'join',
        agent_id: 'a',
        outcome: 'conflict',
        reason: 'conflict',
        receipt: null,
        revision: 1,
      }),
    ).toEqual(['⚠ Join a lane conflict · conflict'])
    expect(render({ action: 'status', agent_id: 'a', outcome: 'not-found' })).toEqual([
      '⚠ Task a not found',
    ])
    const failedTask: SubagentSnapshot = {
      ...snapshot('failed', false),
      error: 'failure '.repeat(40),
      status: 'failed',
    }
    const failedStatus = render({
      action: 'status',
      outcome: 'found',
      task: {
        activity: null,
        agent_id: failedTask.agentId,
        artifact: null,
        attempt: failedTask.attempt,
        context_state: null,
        description: failedTask.description,
        effort: failedTask.effort,
        ended_at: failedTask.endedAt ?? null,
        error: failedTask.error ?? null,
        evidence: [],
        gate_count: 0,
        intercom_usage: failedTask.intercomUsage,
        isolation: null,
        model: failedTask.model,
        output_bytes: 0,
        readonly: failedTask.readonly,
        retry_failure: null,
        retry_state: null,
        running: failedTask.running,
        started_at: failedTask.startedAt,
        state: failedTask.status,
        structured_output_status: null,
        subagent_type: failedTask.subagentType,
        tool_receipt_count: 0,
        usage: failedTask.usage,
      },
    })
    expect(failedStatus).toHaveLength(2)
    expect(failedStatus[1]).toContain('failure')
    expect(failedStatus[1]?.length).toBeLessThanOrEqual(84)
    const card = renderIntercomCard(
      { agentId: 'a', kind: 'automatic-reply', question: 'Which branch?', reply: 'Use main.' },
      'a lane',
      1_000,
      { expanded: false, now: 61_000 },
      theme,
    ).map((line) => stripTerminalSequences(line))
    expect(card).toEqual([
      '✉ IRC ⟵ a lane · 1m ago · advisory only',
      '  ▏ Which branch?',
      '  ➤ advisor · not authorization',
      '  ▏ Use main.',
    ])
    expect(decodeIntercomDetails({ kind: 'other' })).toBeUndefined()
  })
})
