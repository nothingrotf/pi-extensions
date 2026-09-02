import { isRemindableStatus, type Todo } from './domain.ts'

export const maximumStopReminders = 3
export const midRunNudgeMutationThreshold = 12
export const midRunNudgeMaximumPerCycle = 2
export const mutatingToolNames: readonly string[] = ['bash', 'edit', 'write']

const markdownPromptPrefix = /^(?:>\s*)?(?:(?:[-*+]|\d+[.)])\s+)*/
const promptLabel = /^(?:q(?:uestion)?|ask)\s*\d*\s*[:.)-]\s*/i
const questionPrompt =
  /^(?:what|which|when|where|why|how|who|whom|whose|do|does|did|can|could|would|will|should|is|are|am|may|shall)\b/i
const userDirectedPrompt = /\b(?:you|your|we|our)\b/i
const userResponseCue =
  /^(?:please\s+)?(?:confirm|reply|choose|pick|decide|advise)\b|^(?:please\s+)?answer\b|^(?:please\s+)?(?:let\s+me\s+know|tell\s+me)\b/i

function hasNonAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0x7f) {
      return true
    }
  }
  return false
}

function promptLine(line: string): { text: string; hadPromptLabel: boolean } {
  const withoutMarkdownPrefix = line.trim().replace(markdownPromptPrefix, '').trim()
  const withoutPromptLabel = withoutMarkdownPrefix.replace(promptLabel, '').trim()
  return {
    text: withoutPromptLabel,
    hadPromptLabel: withoutPromptLabel !== withoutMarkdownPrefix,
  }
}

function isQuestionPromptLine(line: string): boolean {
  const candidate = promptLine(line)
  if (!/[?？]\s*$/.test(candidate.text)) {
    return false
  }
  return (
    candidate.hadPromptLabel ||
    questionPrompt.test(candidate.text) ||
    userDirectedPrompt.test(candidate.text) ||
    hasNonAscii(candidate.text)
  )
}

function isResponseCueLine(line: string): boolean {
  const candidate = promptLine(line)
    .text.replace(/[.!?。！？]+$/, '')
    .trim()
  return userResponseCue.test(candidate)
}

export function isAwaitingUserAnswer(assistantText: string): boolean {
  const text = assistantText.trim()
  if (text.length === 0) {
    return false
  }
  const lastLine = text.split(/\r?\n/).at(-1)?.trim()
  return lastLine !== undefined && (isQuestionPromptLine(lastLine) || isResponseCueLine(lastLine))
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
  const touchedTodo = toolName === 'todo_write'
  const mutated = !isError && mutatingToolNames.includes(toolName)
  return {
    ...cycle,
    mutationsSinceLastTouch: touchedTodo
      ? 0
      : mutated
        ? cycle.mutationsSinceLastTouch + 1
        : cycle.mutationsSinceLastTouch,
    reminderAwaitingProgress: false,
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
  if (assistant.stopReason === 'aborted' || assistant.stopReason === 'error') {
    return { kind: 'silent', reason: assistant.stopReason }
  }
  if (assistant.hadToolCalls) {
    return { kind: 'silent', reason: 'tool-calls' }
  }
  if (cycle.reminderAwaitingProgress) {
    return { kind: 'silent', reason: 'awaiting-progress' }
  }
  if (cycle.reminderCount >= maximumStopReminders) {
    return { kind: 'silent', reason: 'max-reminders' }
  }
  const incomplete = todos.filter((todo) => isRemindableStatus(todo.status))
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
    'Please continue working on these tasks or mark them complete if finished.',
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
  const incompleteCount = todos.filter((todo) => isRemindableStatus(todo.status)).length
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
  const noun = incompleteCount === 1 ? 'item' : 'items'
  return [
    '<system-reminder>',
    `Many file or shell mutations happened since the last todo_write call. ${incompleteCount} todo ${noun} remain open.`,
    'Reconcile the todo list with the real state before more work: mark finished items completed, set the current item in_progress, and add new items for work that appeared.',
    'Batch the todo_write call with the next real action. Do not make it the only tool call of the turn.',
    '</system-reminder>',
  ].join('\n')
}
