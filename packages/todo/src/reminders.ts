import { Marked } from 'marked'

import { actionableTodos, isRemindableStatus, type Todo } from './domain.ts'

export const maximumStopReminders = 3
export const midRunNudgeMutationThreshold = 12
export const midRunNudgeMaximumPerCycle = 2
export const mutatingToolNames: readonly string[] = ['edit', 'write']
export const awaitingUserAnswerLineWindow = 12

const userResponseCue =
  /^(?:please\s+)?(?:confirm|reply|choose|pick|decide|advise|answer|let\s+me\s+know|tell\s+me)\b|^(?:por\s+favor[,.:]?\s+)?(?:confirme|confirma|responda|responde|escolha|escolhe|decida|diga|informe|avise|me\s+diga|me\s+avise)\b|^(?:i\s+(?:need|await)|waiting\s+for|i\s+will\s+wait\s+for)\s+your\b|^(?:aguardo\s+(?:sua|seu)|preciso\s+(?:da\s+sua|do\s+seu|que\s+voce)|fico\s+no\s+aguardo)\b/i

const proseMarkdown = new Marked({
  renderer: {
    code: () => '\n',
    blockquote: () => '\n',
    html: () => '\n',
    table: () => '\n',
    codespan: () => '',
    image: () => '',
    checkbox: () => '',
    hr: () => '\n',
    br: () => '\n',
    space: () => '\n',
    paragraph({ tokens }) {
      return `${this.parser.parseInline(tokens)}\n`
    },
    heading({ tokens }) {
      return `${this.parser.parseInline(tokens)}\n`
    },
    list({ items }) {
      return items.map((item) => this.listitem(item)).join('\n')
    },
    listitem({ tokens }) {
      return this.parser.parse(tokens)
    },
    strong({ tokens }) {
      return this.parser.parseInline(tokens)
    },
    em({ tokens }) {
      return this.parser.parseInline(tokens)
    },
    del({ tokens }) {
      return this.parser.parseInline(tokens)
    },
    link({ tokens }) {
      return this.parser.parseInline(tokens)
    },
    text(token) {
      return 'tokens' in token && token.tokens !== undefined
        ? this.parser.parseInline(token.tokens)
        : token.text
    },
  },
})

function proseLines(text: string): string[] {
  return proseMarkdown
    .parse(text, { async: false })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

const continuationPermission =
  /^(?:(?:can|may|should|shall) i (?:continue|proceed)|do you want me to (?:continue|proceed)|posso (?:continuar|prosseguir))\s*[?？]$/i

export function isUserStopRequest(text: string): boolean {
  const normalized = text.trim().normalize('NFD').replace(/\p{M}/gu, '')
  return (
    /^(?:please\s+)?(?:stop|cancel|pause)\b/i.test(normalized) ||
    /^(?:por favor[, ]+)?(?:pare|parar|cancele|cancelar|pause|nao continue)\b/i.test(normalized)
  )
}

export function isAwaitingUserAnswer(assistantText: string): boolean {
  return proseLines(assistantText)
    .slice(-awaitingUserAnswerLineWindow)
    .flatMap((line) => line.split(/(?<=[.!?？])\s+/u))
    .filter((line) => !continuationPermission.test(line))
    .some(
      (line) =>
        /[?？]\s*$/.test(line) ||
        userResponseCue.test(line.normalize('NFD').replace(/\p{M}/gu, '')),
    )
}

export interface ReminderCycle {
  reminderCount: number
  reminderAwaitingProgress: boolean
  mutationsSinceLastTouch: number
  midRunNudgeCount: number
}

export function createReminderCycle(): ReminderCycle {
  return {
    reminderCount: 0,
    reminderAwaitingProgress: false,
    mutationsSinceLastTouch: 0,
    midRunNudgeCount: 0,
  }
}

export function recordToolResult(
  cycle: ReminderCycle,
  toolName: string,
  isError: boolean,
): ReminderCycle {
  if (isError) return cycle
  const touchedTodo = toolName === 'todo_write'
  const mutated = mutatingToolNames.includes(toolName)
  return {
    ...cycle,
    mutationsSinceLastTouch: touchedTodo
      ? 0
      : mutated
        ? cycle.mutationsSinceLastTouch + 1
        : cycle.mutationsSinceLastTouch,
    reminderAwaitingProgress: mutated ? false : cycle.reminderAwaitingProgress,
  }
}

export function recordTodoUpdate(
  cycle: ReminderCycle,
  previous: readonly Todo[],
  next: readonly Todo[],
): ReminderCycle {
  const remainingIds = new Set(
    next.filter((todo) => isRemindableStatus(todo.status)).map((todo) => todo.id),
  )
  const progressed = previous.some(
    (todo) => isRemindableStatus(todo.status) && !remainingIds.has(todo.id),
  )
  return {
    ...cycle,
    mutationsSinceLastTouch: 0,
    reminderAwaitingProgress: progressed ? false : cycle.reminderAwaitingProgress,
  }
}

export type StopReminderDecision =
  | { kind: 'silent'; reason: string }
  | { kind: 'remind'; cycle: ReminderCycle; attempt: number; todos: Todo[] }

export function decideStopReminder(
  cycle: ReminderCycle,
  todos: readonly Todo[],
  assistant: { text: string; hadToolCalls: boolean; stopReason: string },
): StopReminderDecision {
  if (assistant.stopReason !== 'stop') {
    return { kind: 'silent', reason: assistant.stopReason }
  }
  if (assistant.hadToolCalls) {
    return { kind: 'silent', reason: 'tool-calls' }
  }
  if (assistant.text.trim().length === 0) {
    return { kind: 'silent', reason: 'empty-response' }
  }
  if (cycle.reminderAwaitingProgress) {
    return { kind: 'silent', reason: 'awaiting-progress' }
  }
  if (cycle.reminderCount >= maximumStopReminders) {
    return { kind: 'silent', reason: 'max-reminders' }
  }
  const incomplete = actionableTodos(todos)
  if (incomplete.length === 0) {
    return { kind: 'silent', reason: 'no-incomplete' }
  }
  if (isAwaitingUserAnswer(assistant.text)) {
    return { kind: 'silent', reason: 'awaiting-user' }
  }
  const attempt = cycle.reminderCount + 1
  return {
    kind: 'remind',
    attempt,
    todos: incomplete,
    cycle: {
      ...cycle,
      reminderCount: attempt,
      reminderAwaitingProgress: true,
      mutationsSinceLastTouch: 0,
    },
  }
}

export function formatStopReminder(todos: readonly Todo[], attempt: number): string {
  const list = todos.map((todo) => `- ${todo.content} (id: ${todo.id})`).join('\n')
  return [
    '<system-reminder>',
    `You stopped with ${todos.length} incomplete todo item(s):`,
    list,
    '',
    'Continue only with already authorized tasks that do not require user input.',
    'Do not ask for permission merely to continue those tasks.',
    'Respect user stop, pause, and cancellation requests. Never infer approval for a new scope or consequential action.',
    'Use todo_write to mark finished tasks completed.',
    'If a task requires user input, mark it blocked with a blocker note and ask the user.',
    'Do not mark unfinished work completed or cancelled to silence this reminder.',
    '',
    `(Reminder ${attempt}/${maximumStopReminders})`,
    '</system-reminder>',
  ].join('\n')
}

export type MidRunNudgeDecision =
  | { kind: 'silent' }
  | { kind: 'nudge'; cycle: ReminderCycle; incompleteCount: number }

export function decideMidRunNudge(
  cycle: ReminderCycle,
  todos: readonly Todo[],
): MidRunNudgeDecision {
  if (cycle.mutationsSinceLastTouch < midRunNudgeMutationThreshold) {
    return { kind: 'silent' }
  }
  if (cycle.midRunNudgeCount >= midRunNudgeMaximumPerCycle) {
    return { kind: 'silent' }
  }
  const incompleteCount = actionableTodos(todos).length
  if (incompleteCount === 0) {
    return { kind: 'silent' }
  }
  return {
    kind: 'nudge',
    incompleteCount,
    cycle: {
      ...cycle,
      mutationsSinceLastTouch: 0,
      midRunNudgeCount: cycle.midRunNudgeCount + 1,
    },
  }
}

export function formatMidRunNudge(incompleteCount: number): string {
  const remaining = incompleteCount === 1 ? 'item remains' : 'items remain'
  return [
    '<system-reminder>',
    `Twelve successful file edits or writes occurred since the last todo_write call. ${incompleteCount} todo ${remaining} open.`,
    '',
    'Reconcile the todo list with the actual task state before more work.',
    'Mark finished items completed, and keep externally blocked items blocked with a blocker note.',
    'Batch the todo_write call with the next real action.',
    'Do not make it the only tool call of the turn.',
    '</system-reminder>',
  ].join('\n')
}
