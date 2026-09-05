import { describe, expect, test } from 'vite-plus/test'

import type { Todo } from '../src/domain.ts'
import {
  createReminderCycle,
  decideMidRunNudge,
  decideStopReminder,
  isAwaitingUserAnswer,
  recordToolResult,
  recordTodoUpdate,
} from '../src/reminders.ts'

function todo(id: string, status: Todo['status']): Todo {
  return { id, content: `task ${id}`, status, createdAt: '1', updatedAt: '1', dependencies: [] }
}

describe('awaiting user answer detection', () => {
  test('detects questions without an ASCII or language restriction', () => {
    expect(isAwaitingUserAnswer('Which branch should I use?')).toBe(true)
    expect(isAwaitingUserAnswer('Summary.\n- Q1: keep the old API?')).toBe(true)
    expect(isAwaitingUserAnswer('Do you want me to continue?')).toBe(true)
    expect(isAwaitingUserAnswer('Qual opção prefere?')).toBe(true)
    expect(isAwaitingUserAnswer('Qual arquivo devo alterar?')).toBe(true)
    expect(isAwaitingUserAnswer('続行しますか？')).toBe(true)
  })

  test('detects response cues', () => {
    expect(isAwaitingUserAnswer('Please confirm before I delete the branch.')).toBe(true)
    expect(isAwaitingUserAnswer('Let me know which option you prefer.')).toBe(true)
  })

  test('detects a question followed by options and a closing statement', () => {
    const text = [
      'Onde preciso da sua decisão',
      '',
      'Como você quer finalizar essa skill?',
      '',
      '1. Manter como PR próprio empilhado acima de feature/obs-59.',
      '2. Mover o commit para dentro de feature/obs-59 e atualizar o PR #71.',
      '3. Outra coisa que eu não entendi.',
      '',
      'Enquanto isso não toco no stack nem spawno mais nada.',
    ].join('\n')
    expect(isAwaitingUserAnswer(text)).toBe(true)
  })

  test('ignores questions outside the trailing window', () => {
    const filler = Array.from({ length: 12 }, (_, index) => `Step ${index + 1} done.`)
    expect(isAwaitingUserAnswer(['Should I continue?', ...filler].join('\n'))).toBe(false)
  })

  test.each([
    '**Which file should I edit?**',
    '## Which file should I edit?',
    '- __Qual arquivo devo alterar?__',
    '**Confirme antes de continuar.**',
    'Por favor, escolha uma alternativa.',
    'Preciso que você escolha uma alternativa.',
    'Aguardo sua decisão.',
    'Reply with the target branch.',
    'I will wait for your approval.',
  ])('recognizes a user prompt in %s', (text) => {
    expect(isAwaitingUserAnswer(text)).toBe(true)
  })

  test.each([
    '```text\nWhich branch should I use?\n```\nThe example is complete.',
    '~~~text\nQual arquivo devo alterar?\n~~~\nThe example is complete.',
    '> Which branch should I use?\nThe quote is complete.',
    '> Example:\nWhich branch should I use?\n\nWork remains.',
    '`Example:\nWhich branch should I use?\n`\n\nWork remains.',
    '`Which file should I edit?`',
    '    Which file should I edit?\nThe example is complete.',
    '<!-- Which file should I edit? -->\nThe example is complete.',
  ])('ignores questions in quoted text or code: %s', (text) => {
    expect(isAwaitingUserAnswer(text)).toBe(false)
  })

  test('retains a real question after a multiline blockquote', () => {
    expect(
      isAwaitingUserAnswer('> Example:\nWhich branch should I use?\n\nQual arquivo devo alterar?'),
    ).toBe(true)
  })

  test('retains a real question after a fenced example', () => {
    expect(isAwaitingUserAnswer('````\n```\nQuestion?\n````\n**Qual arquivo devo alterar?**')).toBe(
      true,
    )
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
    expect(cycle.mutationsSinceLastTouch).toBe(1)
    cycle = recordToolResult(cycle, 'todo_write', false)
    expect(cycle.mutationsSinceLastTouch).toBe(0)
  })

  test('todo_write alone does not count as progress after a stop reminder', () => {
    const todos = [todo('1', 'pending')]
    const stop = { text: 'Waiting.', hadToolCalls: false, stopReason: 'stop' }
    const first = decideStopReminder(createReminderCycle(), todos, stop)
    if (first.kind !== 'remind') {
      throw new Error('expected reminder')
    }
    const touched = recordToolResult(first.cycle, 'todo_write', false)
    expect(decideStopReminder(touched, todos, stop)).toEqual({
      kind: 'silent',
      reason: 'awaiting-progress',
    })
    const progressed = recordToolResult(touched, 'edit', false)
    const second = decideStopReminder(progressed, todos, stop)
    expect(second.kind).toBe('remind')
    if (second.kind !== 'remind') {
      throw new Error('expected reminder')
    }
    expect(second.attempt).toBe(2)
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
    const progressed = recordToolResult(first.cycle, 'edit', false)
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

  test.each(['read', 'todo_read', 'bash', 'mcp', 'Task'])(
    'does not treat %s as progress',
    (name) => {
      const cycle = {
        ...createReminderCycle(),
        reminderAwaitingProgress: true,
        mutationsSinceLastTouch: 11,
      }
      expect(recordToolResult(cycle, name, false)).toEqual(cycle)
      expect(recordToolResult(cycle, name, true)).toEqual(cycle)
    },
  )

  test.each(['edit', 'write', 'todo_write'])(
    'does not treat a failed %s as progress or a todo touch',
    (name) => {
      const cycle = {
        ...createReminderCycle(),
        reminderAwaitingProgress: true,
        mutationsSinceLastTouch: 11,
      }
      expect(recordToolResult(cycle, name, true)).toEqual(cycle)
    },
  )

  test.each(['completed', 'cancelled', 'blocked'] satisfies Todo['status'][])(
    'counts a transition to %s as progress',
    (status) => {
      const cycle = { ...createReminderCycle(), reminderAwaitingProgress: true }
      expect(
        recordTodoUpdate(cycle, [todo('a', 'pending')], [todo('a', status)])
          .reminderAwaitingProgress,
      ).toBe(false)
    },
  )

  test('counts removal but not a no-op, rename, or active pointer change as progress', () => {
    const cycle = { ...createReminderCycle(), reminderAwaitingProgress: true }
    const before = [todo('a', 'pending')]
    expect(recordTodoUpdate(cycle, before, []).reminderAwaitingProgress).toBe(false)
    expect(recordTodoUpdate(cycle, before, before).reminderAwaitingProgress).toBe(true)
    expect(
      recordTodoUpdate(cycle, before, [{ ...todo('a', 'in_progress'), content: 'Renamed content' }])
        .reminderAwaitingProgress,
    ).toBe(true)
  })

  test.each(['aborted', 'error', 'length', 'pending', 'deferred', 'toolUse'])(
    'ignores the %s stop reason',
    (stopReason) => {
      expect(
        decideStopReminder(createReminderCycle(), [todo('a', 'pending')], {
          text: 'Stopped.',
          hadToolCalls: false,
          stopReason,
        }),
      ).toEqual({ kind: 'silent', reason: stopReason })
    },
  )

  test('requires visible text from a normal assistant stop', () => {
    expect(
      decideStopReminder(createReminderCycle(), [todo('a', 'pending')], {
        text: '  ',
        hadToolCalls: false,
        stopReason: 'stop',
      }),
    ).toEqual({ kind: 'silent', reason: 'empty-response' })
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
