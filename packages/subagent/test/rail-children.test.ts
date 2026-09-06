import { describe, expect, it } from 'vite-plus/test'

import {
  childOutputPreview,
  childOutputSummary,
  childRailReport,
  childToolDetail,
  RailChildReporter,
} from '../src/rail-children.ts'
import type { RailActionReport } from '../src/rail.ts'
import type { ChildToolEvent } from '../src/runtime.ts'

type Listener = (event: ChildToolEvent) => void

function fakeRuntime() {
  const listeners = new Set<Listener>()
  return {
    emit: (event: ChildToolEvent) => {
      for (const listener of listeners) listener(event)
    },
    listeners,
    subscribeChildTools: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function fakeRail(active = true) {
  const reports: RailActionReport[] = []
  return { active, report: (report: RailActionReport) => reports.push(report), reports }
}

describe('child rail reports', () => {
  it('maps built-in child tools to rail labels and relative details', () => {
    const report = childRailReport(
      {
        agentId: 'child',
        args: { path: '/work/pkg/package.json' },
        cwd: '/work/pkg',
        status: 'pending',
        toolCallId: 'call-1',
        toolName: 'read',
      },
      'task-1',
    )
    expect(report).toEqual({
      category: 'read',
      detail: 'package.json',
      doneLabel: 'Read',
      iconKey: 'read',
      parentToolCallId: 'task-1',
      runningLabel: 'Reading',
      status: 'pending',
      toolCallId: 'child:call-1',
      toolName: 'read',
    })
  })

  it('summarizes settled output, bounds the preview, and carries the duration', () => {
    const output = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')
    const report = childRailReport(
      {
        agentId: 'child',
        cwd: '/work',
        output,
        status: 'ok',
        toolCallId: 'call-2',
        toolName: 'bash',
      },
      'task-1',
      1_250,
    )
    expect(report).toMatchObject({
      doneLabel: 'Ran',
      durationMs: 1_250,
      iconKey: 'shell',
      parentToolCallId: 'task-1',
      status: 'ok',
      summary: '40 lines',
      toolCallId: 'child:call-2',
    })
    expect(report?.output?.split('\n')).toHaveLength(12)
    expect(childOutputPreview('x'.repeat(10_000))).toHaveLength(4_096)
    expect(childOutputSummary('  boom: failed\nmore', 'error')).toBe('boom: failed')
    expect(childOutputSummary('single value', 'ok')).toBe('single value')
    expect(childOutputSummary('', 'ok')).toBe('')
  })

  it('labels intercom tools, hides progress updates, and derives unknown labels', () => {
    const base = { agentId: 'child', cwd: '/work', status: 'pending' as const }
    expect(
      childRailReport(
        { ...base, args: { message: 'Needs review' }, toolCallId: 'n', toolName: 'notify_parent' },
        'task-1',
      ),
    ).toMatchObject({ detail: 'Needs review', doneLabel: 'Notified parent', iconKey: 'agent' })
    expect(
      childRailReport(
        { ...base, args: { question: 'Scope?' }, toolCallId: 'q', toolName: 'ask_parent' },
        'task-1',
      ),
    ).toMatchObject({ detail: 'Scope?', doneLabel: 'Asked parent', iconKey: 'ask' })
    expect(
      childRailReport(
        {
          ...base,
          args: { description: 'Nested inspect', prompt: 'x', subagent_type: 'explore' },
          toolCallId: 't',
          toolName: 'Task',
        },
        'task-1',
      ),
    ).toMatchObject({ detail: 'Nested inspect', doneLabel: 'Dispatched', iconKey: 'agent' })
    expect(
      childRailReport(
        { ...base, args: { phase: 'x' }, toolCallId: 'p', toolName: 'update_progress' },
        'task-1',
      ),
    ).toBeUndefined()
    const unknown = childRailReport(
      { ...base, args: { query: 'pi tui' }, toolCallId: 'w', toolName: 'web_search' },
      'task-1',
    )
    expect(unknown).toMatchObject({ detail: 'pi tui', doneLabel: 'Web search' })
    expect(unknown?.iconKey).toBeUndefined()
  })

  it('clips long arguments and keeps absolute paths outside the child directory', () => {
    expect(childToolDetail('bash', { command: 'x'.repeat(100) }, '/work')).toHaveLength(60)
    expect(childToolDetail('read', { path: '/elsewhere/file.ts' }, '/work')).toBe(
      '/elsewhere/file.ts',
    )
    expect(childToolDetail('read', { path: '/work' }, '/work')).toBe('.')
    expect(childToolDetail('grep', { nope: true }, '/work')).toBe('')
  })
})

describe('RailChildReporter', () => {
  const start = (agentId: string, toolCallId: string): ChildToolEvent => ({
    agentId,
    args: { path: '/work/a.ts' },
    cwd: '/work',
    status: 'pending',
    toolCallId,
    toolName: 'read',
  })
  const end = (agentId: string, toolCallId: string): ChildToolEvent => ({
    agentId,
    cwd: '/work',
    output: 'one\ntwo',
    status: 'ok',
    toolCallId,
    toolName: 'read',
  })

  it('reports only started children, measures durations, and stops cleanly', () => {
    const runtime = fakeRuntime()
    const rail = fakeRail()
    let now = 1_000
    const reporter = new RailChildReporter(rail, runtime, 'task-1', () => now)
    runtime.emit(start('stranger', 'c0'))
    reporter.started('child')
    runtime.emit(start('child', 'c1'))
    now = 1_300
    runtime.emit(end('child', 'c1'))
    runtime.emit(end('child', 'c2'))
    expect(rail.reports.map((report) => [report.toolCallId, report.status])).toEqual([
      ['child:c1', 'pending'],
      ['child:c1', 'ok'],
      ['child:c2', 'ok'],
    ])
    expect(rail.reports[1]?.durationMs).toBe(300)
    expect(rail.reports[2]?.durationMs).toBeUndefined()
    expect(rail.reports.every((report) => report.parentToolCallId === 'task-1')).toBe(true)
    reporter.stop()
    reporter.started('late')
    runtime.emit(start('child', 'c3'))
    runtime.emit(start('late', 'c4'))
    expect(rail.reports).toHaveLength(3)
    expect(runtime.listeners.size).toBe(0)
  })

  it('stays silent while the rail is inactive', () => {
    const runtime = fakeRuntime()
    const rail = fakeRail(false)
    const reporter = new RailChildReporter(rail, runtime, 'task-1')
    reporter.started('child')
    runtime.emit(start('child', 'c1'))
    expect(rail.reports).toHaveLength(0)
    reporter.stop()
  })
})
