import { defineTool, type ExtensionContext } from '@earendil-works/pi-coding-agent'

import {
  cloneTodos,
  decodeTodoWriteDetails,
  formatTodoReadResult,
  formatTodoSummary,
  formatTodoWriteResult,
  readTodos,
  type Todo,
  TodoReadSchema,
  updateTodos,
  validateTodoWrite,
} from './domain.ts'
import { TodoWriteSchema, todoReadDescription, todoWriteDescription } from './protocol.ts'

export function createSessionTodoTools() {
  let todos: Todo[] = []
  let owner: ExtensionContext['sessionManager'] | undefined
  let leaf: string | null | undefined

  const restore = (ctx: ExtensionContext) => {
    const currentLeaf = ctx.sessionManager.getLeafId()
    if (owner === ctx.sessionManager && leaf === currentLeaf) return
    owner = ctx.sessionManager
    leaf = currentLeaf
    todos = []
    const branch = ctx.sessionManager.getBranch()
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      const entry = branch[index]
      if (entry?.type !== 'message') continue
      const message = entry.message
      if (message.role !== 'toolResult' || message.toolName !== 'todo_write' || message.isError)
        continue
      const details = decodeTodoWriteDetails(message.details)
      if (details !== null) {
        todos = cloneTodos(details.todos)
        return
      }
    }
  }

  return [
    defineTool({
      name: 'todo_write',
      label: 'Todo write',
      description: todoWriteDescription,
      promptSnippet: "Manage only this session's task list, never a parent or sibling plan",
      promptGuidelines: [
        'Use todo_write to track your assigned scope. Session-local planning is permitted in read-only Tasks and does not authorize repository changes.',
        'Use todo_write to mark external dependencies blocked, and request_parent for real coordinator decisions. Never mark unverified or unfinished work completed.',
      ],
      parameters: TodoWriteSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        signal?.throwIfAborted()
        restore(ctx)
        const errors = validateTodoWrite(todos, params.todos, params.merge)
        if (errors.length > 0) throw new Error(formatTodoSummary(todos, errors))
        const details = updateTodos(todos, params.todos, params.merge, Date.now())
        todos = cloneTodos(details.todos)
        return { content: [{ type: 'text', text: formatTodoWriteResult(todos) }], details }
      },
    }),
    defineTool({
      name: 'todo_read',
      label: 'Todo read',
      description: todoReadDescription,
      promptSnippet: "Read only this session's task list",
      parameters: TodoReadSchema,
      executionMode: 'sequential',
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        signal?.throwIfAborted()
        restore(ctx)
        const details = readTodos(todos, params)
        return { content: [{ type: 'text', text: formatTodoReadResult(details.todos) }], details }
      },
    }),
  ]
}
