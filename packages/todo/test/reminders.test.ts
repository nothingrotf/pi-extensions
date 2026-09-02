import { describe, expect, test } from 'vite-plus/test'

import type { Todo } from '../src/domain.ts'
import {
  createReminderCycle,
  decideMidRunNudge,
  decideStopReminder,
  isAwaitingUserAnswer,
  recordToolResult,
} from '../src/reminders.ts'

function todo(id: string, status: Todo['status']): Todo {
  return { id, content: `task ${id}`, status, createdAt: '1', updatedAt: '1', dependencies: [] }
}

describe('awaiting user answer detection', () => {
  test('detects question lines with English cues, labels, and non-ASCII text', () => {
    expect(isAwaitingUserAnswer('Which branch should I use?')).toBe(true)
    expect(isAwaitingUserAnswer('Summary.\n- Q1: keep the old API?')).toBe(true)
    expect(isAwaitingUserAnswer('Do you want me to continue?')).toBe(true)
    expect(isAwaitingUserAnswer('Qual opção prefere?')).toBe(true)
    expect(isAwaitingUserAnswer('Qual arquivo devo alterar?')).toBe(false)
    expect(isAwaitingUserAnswer('続行しますか？')).toBe(true)
  })

  test('detects response cues', () => {
    expect(isAwaitingUserAnswer('Please confirm before I delete the branch.')).toBe(true)
    expect(isAwaitingUserAnswer('Let me know which option you prefer.')).toBe(true)
  })

  test('ignores incidental question marks and plain statements', () => {
    expect(isAwaitingUserAnswer('Added `foo?: string` to the type.')).toBe(false)
    expect(isAwaitingUserAnswer('All tests pass.')).toBe(false)
    expect(isAwaitingUserAnswer('')).toBe(false)
  })
})

describe('reminder cycle', () => {
  test('counts mutating tools and resets on todo_write', () => {
    let cycle = createReminderCycle()
    cycle = recordToolResult(cycle, 'edit', false)
    cycle = recordToolResult(cycle, 'bash', false)
    cycle = recordToolResult(cycle, 'bash', true)
    cycle = recordToolResult(cycle, 'read', false)
    expect(cycle.mutationsSinceLastTouch).toBe(2)
    cycle = recordToolResult(cycle, 'todo_write', false)
    expect(cycle.mutationsSinceLastTouch).toBe(0)
  })

  test('decides stop reminders with the documented guards', () => {
    const todos = [todo('1', 'pending'), todo('2', 'blocked'), todo('3', 'completed')]
    const stop = { text: 'Stopped.', hadToolCalls: false, stopReason: 'stop' }
    const first = decideStopReminder(createReminderCycle(), todos, stop)
    expect(first.kind).toBe('remind')
    if (first.kind !== 'remind') {
      throw new Error('expected reminder')
    }
    expect(first.todos.map((item) => item.id)).toEqual(['1'])
    expect(first.attempt).toBe(1)
    expect(decideStopReminder(first.cycle, todos, stop)).toEqual({
      kind: 'silent',
      reason: 'awaiting-progress',
    })
    const progressed = recordToolResult(first.cycle, 'read', false)
    expect(decideStopReminder(progressed, [todo('2', 'blocked')], stop)).toEqual({
      kind: 'silent',
      reason: 'no-incomplete',
    })
    expect(decideStopReminder(progressed, todos, { ...stop, text: 'Should I continue?' })).toEqual({
      kind: 'silent',
      reason: 'awaiting-user',
    })
    expect(decideStopReminder({ ...progressed, reminderCount: 3 }, todos, stop)).toEqual({
      kind: 'silent',
      reason: 'max-reminders',
    })
  })

  test('decides mid-run nudges by threshold and cap', () => {
    const todos = [todo('1', 'in_progress')]
    const idle = { ...createReminderCycle(), mutationsSinceLastTouch: 11 }
    expect(decideMidRunNudge(idle, todos)).toEqual({ kind: 'silent' })
    const ready = { ...idle, mutationsSinceLastTouch: 12 }
    const nudged = decideMidRunNudge(ready, todos)
    expect(nudged.kind).toBe('nudge')
    if (nudged.kind !== 'nudge') {
      throw new Error('expected nudge')
    }
    expect(nudged.cycle.midRunNudgeCount).toBe(1)
    expect(nudged.cycle.mutationsSinceLastTouch).toBe(0)
    expect(decideMidRunNudge({ ...ready, midRunNudgeCount: 2 }, todos)).toEqual({ kind: 'silent' })
    expect(decideMidRunNudge(ready, [todo('1', 'blocked')])).toEqual({ kind: 'silent' })
  })
})
