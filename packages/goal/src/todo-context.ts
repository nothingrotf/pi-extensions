import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import { escapeXmlText } from './prompts.ts'

const TodoItemSchema = Type.Object({
  id: Type.String(),
  content: Type.String(),
  status: Type.Union([
    Type.Literal('pending'),
    Type.Literal('in_progress'),
    Type.Literal('completed'),
    Type.Literal('cancelled'),
    Type.Literal('blocked'),
  ]),
  blocker: Type.Optional(Type.String()),
})

const TodoWriteDetailsSchema = Type.Object({
  todos: Type.Array(TodoItemSchema),
})

export type TodoContextItem = Static<typeof TodoItemSchema>

export const todoWriteToolName = 'todo_write'
export const todoUserEditEntryType = 'pi-todo-user-edit'

export function decodeTodoWriteDetails<Input>(value: Input): TodoContextItem[] | null {
  try {
    return Value.Decode(TodoWriteDetailsSchema, value).todos
  } catch {
    return null
  }
}

interface BranchEntry {
  type: string
  customType?: string
  data?: unknown
  message?: { role: string; toolName?: string; details?: unknown; isError?: boolean }
}

export function readTodosFromBranch(entries: readonly BranchEntry[]): TodoContextItem[] {
  let todos: TodoContextItem[] = []
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === todoUserEditEntryType) {
      const edited = decodeTodoWriteDetails(entry.data)
      if (edited !== null) {
        todos = edited
      }
      continue
    }
    if (entry.type !== 'message' || entry.message === undefined) {
      continue
    }
    const message = entry.message
    if (
      message.role !== 'toolResult' ||
      message.toolName !== todoWriteToolName ||
      message.isError === true
    ) {
      continue
    }
    const decoded = decodeTodoWriteDetails(message.details)
    if (decoded !== null) {
      todos = decoded
    }
  }
  return todos
}

function isControlCharacter(code: number): boolean {
  return (
    code <= 0x08 ||
    code === 0x0b ||
    code === 0x0c ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029
  )
}

export function sanitizeGoalTodoText(text: string): string {
  const escaped = escapeXmlText(text)
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  let result = ''
  for (let index = 0; index < escaped.length; index += 1) {
    const code = escaped.charCodeAt(index)
    result += isControlCharacter(code) ? ' ' : escaped.charAt(index)
  }
  return result
}

export function renderTodoContext(todos: readonly TodoContextItem[]): string | undefined {
  if (todos.length === 0) {
    return undefined
  }
  let closed = 0
  let open = 0
  const lines: string[] = []
  for (const todo of todos) {
    if (todo.status === 'completed' || todo.status === 'cancelled') {
      closed += 1
    } else {
      open += 1
    }
    const blocker =
      todo.status === 'blocked' && todo.blocker !== undefined
        ? ` (blocked on: ${sanitizeGoalTodoText(todo.blocker)})`
        : ''
    lines.push(
      `- [${todo.status}] #${sanitizeGoalTodoText(todo.id)} ${sanitizeGoalTodoText(todo.content)}${blocker}`,
    )
  }
  return [
    '<todo_context>',
    'Persisted todos: live progress state for current goal, not old transcript decoration; goal continuations lack visible user nudge → treat as live state.',
    'Before substantial work: compare next action with todos. If item stale, already finished, or no longer active pointer, call `todo_write` first with the listed `#id`: mark done or rewrite list. Do not leave stale in_progress while working on later phases. Blocked items wait on external input; set them back to pending when actionable.',
    '',
    `Overall: ${closed}/${todos.length} done, ${open} open.`,
    ...lines,
    '</todo_context>',
  ].join('\n')
}
