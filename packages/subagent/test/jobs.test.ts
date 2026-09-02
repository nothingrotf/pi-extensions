import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it, vi } from 'vite-plus/test'

import type { SubagentTheme } from '../src/format.ts'
import {
  formatJobDuration,
  type JobSnapshot,
  JobTree,
  jobTitle,
  renderJobTree,
  sortJobs,
  toJobSnapshot,
} from '../src/jobs.ts'
import { JobProgress } from '../src/progress.ts'
import type { SubagentSnapshot } from '../src/runtime.ts'

const theme: SubagentTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
}

function job(
  agentId: string,
  status: JobSnapshot['status'],
  durationMs: number,
  lastActivity?: string,
): JobSnapshot {
  return { agentId, description: `${agentId} lane`, durationMs, lastActivity, status }
}

function snapshot(agentId: string, status: SubagentSnapshot['status']): SubagentSnapshot {
  const running = status === 'running'
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
    endedAt: running ? undefined : 9_000,
    error: undefined,
    intercomUsage: usage,
    lastActivity: running ? 'Read file' : undefined,
    model: 'model',
    output: undefined,
    readonly: true,
    retryFailure: undefined,
    retryState: undefined,
    running,
    sessionFile: `/tmp/${agentId}.jsonl`,
    startedAt: 1_000,
    status,
    subagentType: 'explore',
    usage,
  }
}

describe('job tree', () => {
  it('formats durations like the hub rows', () => {
    expect(formatJobDuration(4_400)).toBe('4s')
    expect(formatJobDuration(488_000)).toBe('8m8s')
    expect(formatJobDuration(3_720_000)).toBe('1h2m')
  })

  it('titles the block from the running count', () => {
    expect(jobTitle([job('a', 'running', 1), job('b', 'running', 1)])).toBe('waiting on 2 jobs')
    expect(jobTitle([job('a', 'running', 1), job('b', 'completed', 1)])).toBe(
      'waiting on 1 of 2 jobs',
    )
    expect(jobTitle([job('a', 'completed', 1)])).toBe('1 job settled')
  })

  it('sorts running first, then failed, then settled by duration', () => {
    const sorted = sortJobs([
      job('done', 'completed', 5),
      job('slow', 'running', 9),
      job('bad', 'failed', 3),
      job('fast', 'running', 2),
    ]).map((entry) => entry.agentId)
    expect(sorted).toEqual(['slow', 'fast', 'bad', 'done'])
  })

  it('renders the live tree and drops running rows once settled', () => {
    const jobs = [job('ampere', 'running', 488_000, 'Read file'), job('ada', 'completed', 2_000)]
    const live = renderJobTree(jobs, { expanded: false, isPartial: true, now: 0, width: 80 }, theme)
    expect(live[0]).toBe('ⓘ waiting on 1 of 2 jobs · 1 done')
    expect(live[1]).toBe('├─ ⠋ [task] ampere lane 8m8s → Read file')
    expect(live[2]).toBe('└─ ✓ [task] ada lane 2s')
    expect(live.every((line) => visibleWidth(line) <= 80)).toBe(true)

    const sealed = renderJobTree(
      jobs,
      { expanded: false, isPartial: false, now: 0, width: 80 },
      theme,
    )
    expect(sealed).toEqual(['✓ 1 job settled · 1 done', '└─ ✓ [task] ada lane 2s'])
  })

  it('collapses long lists and truncates to the component width', () => {
    const jobs = Array.from({ length: 10 }, (_value, index) => job(`j${index}`, 'running', index))
    const lines = new JobTree(jobs, { expanded: false, isPartial: true, now: 0 }, theme).render(24)
    expect(lines).toHaveLength(10)
    expect(lines.at(-1)).toBe('└─ +2 more')
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true)
    const expanded = new JobTree(jobs, { expanded: true, isPartial: true, now: 0 }, theme).render(
      80,
    )
    expect(expanded).toHaveLength(11)
  })

  it('maps runtime snapshots to jobs', () => {
    expect(toJobSnapshot(snapshot('a', 'running'), 5_000)).toEqual({
      agentId: 'a',
      description: 'a lane',
      durationMs: 4_000,
      lastActivity: 'Read file',
      status: 'running',
    })
    expect(toJobSnapshot(snapshot('b', 'completed'), 50_000).durationMs).toBe(8_000)
  })
})

describe('job progress', () => {
  it('publishes tracked jobs on runtime changes and clears the status when stopped', () => {
    vi.useFakeTimers()
    try {
      const listeners = new Set<() => void>()
      const snapshots = [snapshot('a', 'running'), snapshot('other', 'running')]
      const runtime = {
        listSnapshots: () => snapshots,
        subscribe: (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      const statuses = new Map<string, string | undefined>()
      const ctx = {
        hasUI: true,
        ui: { setStatus: (key: string, text: string | undefined) => statuses.set(key, text) },
      }
      const updates: string[] = []
      const progress = new JobProgress(runtime, ctx, (partial) => {
        updates.push(partial.details.jobs.map((entry) => entry.agentId).join(','))
      })
      expect(updates).toEqual([])
      progress.started('a')
      expect(updates).toEqual(['a'])
      expect(statuses.get('subagent')).toBe('waiting on 1 job')
      for (const listener of listeners) listener()
      expect(updates).toEqual(['a', 'a'])
      vi.advanceTimersByTime(1_000)
      expect(updates).toHaveLength(3)
      progress.stop()
      expect(listeners.size).toBe(0)
      expect(statuses.get('subagent')).toBeUndefined()
      vi.advanceTimersByTime(5_000)
      expect(updates).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })
})
