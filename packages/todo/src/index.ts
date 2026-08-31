import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'

import {
  activeTodoCount,
  cloneTodos,
  completedTodoCount,
  decodeTodoReadDetails,
  decodeTodoWriteDetails,
  formatTodoReadResult,
  formatTodoWriteResult,
  readTodos,
  type Todo,
  TodoInputSchema,
  type TodoReadDetails,
  type TodoReadInput,
  TodoReadSchema,
  type TodoWriteDetails,
  updateTodos,
} from './domain.ts'
import { TodoOverlay } from './overlay.ts'

export const TodoWriteSchema = Type.Object(
  {
    todos: Type.Array(TodoInputSchema, {
      description: 'Array of TODO items to update or create',
    }),
    merge: Type.Boolean({
      description:
        'Whether to merge the todos with the existing todos. If true, the todos will be merged into the existing todos based on the id field. You can leave unchanged properties undefined. If false, the new todos will replace the existing todos.',
    }),
  },
  { additionalProperties: false },
)

export type TodoWriteInput = Static<typeof TodoWriteSchema>

const todoWriteDescription = `Use this tool to create and manage a structured task list for the current coding session. This helps track progress and demonstrate thoroughness to the user.

### When to Use This Tool

Use proactively for:
- Complex multi-step tasks (3+ distinct steps)
- Non-trivial tasks requiring careful planning
- User explicitly requests todo list
- User provides multiple tasks (numbered/comma-separated)
- After receiving new instructions - capture requirements as todos (use merge=true to append)
- After completing tasks - mark complete with merge=true and update status promptly
- When starting a new task - mark it in_progress (ideally only one at a time)
- When user sends corrections, follow-ups, or new requirements - update todos accordingly

### When NOT to Use

Skip for:
1. Single straightforward steps
2. Trivial tasks (<3 trivial steps)
3. Purely conversational/informational requests
4. Tracking simple tool call progress within a single turn

### Task States

- pending: Not started
- in_progress: Currently working on (limit to ONE at a time)
- completed: Finished successfully
- cancelled: No longer needed

### Best Practices

- Update todos in real-time, don't batch at the end
- Mark complete IMMEDIATELY after finishing (don't wait for end of turn)
- Always use merge=true except when replacing entire list
- Only mark completed when fully done; keep in_progress during work
- Cancel tasks no longer relevant
- Use clear, action-oriented descriptions (max 38 chars)
- Create todos when plan is clear; don't announce without tool call
- Make todos specific and actionable
- Break complex tasks into trackable steps

User request: "Review file A, fix bug B, add tests" → create todos, mark first in_progress
Starting step 2: mark step 1 completed, step 2 in_progress
Mid-task new requirement: merge=true to add todo
All done: mark all completed before final response`

const todoReadDescription =
  'Read the structured task list for the current coding session. Filter by status, ID, or both. Empty filters return the complete list.'

export function renderHeader(todos: readonly Todo[], theme: Theme): string {
  if (todos.length === 0) {
    return theme.fg('dim', 'No to-dos found')
  }
  const active = activeTodoCount(todos)
  const completed = completedTodoCount(todos)
  if (active === 0) {
    return theme.fg('success', theme.bold('All done'))
  }
  const title = `Working on ${active} to-do${active === 1 ? '' : 's'}`
  if (completed === 0) {
    return theme.fg('toolTitle', theme.bold(title))
  }
  return `${theme.fg('toolTitle', theme.bold(title))}${theme.fg('dim', ` • ${completed} done`)}`
}

function renderTodo(todo: Todo, theme: Theme): string | null {
  if (todo.status === 'cancelled') {
    return null
  }
  if (todo.status === 'completed') {
    return `${theme.fg('success', '✔')} ${theme.fg('dim', theme.strikethrough(todo.content))}`
  }
  if (todo.status === 'in_progress') {
    return `${theme.fg('warning', '◐')} ${theme.fg('warning', todo.content)}`
  }
  return `${theme.fg('text', '○')} ${theme.fg('dim', todo.content)}`
}

export function orderedVisibleTodos(todos: readonly Todo[]): Todo[] {
  return [
    ...todos.filter((todo) => todo.status === 'completed'),
    ...todos.filter((todo) => todo.status === 'in_progress'),
    ...todos.filter((todo) => todo.status === 'pending'),
  ]
}

function renderTodoList(todos: readonly Todo[], theme: Theme): Text {
  const lines = [renderHeader(todos, theme)]
  for (const todo of orderedVisibleTodos(todos)) {
    const line = renderTodo(todo, theme)
    if (line !== null) {
      lines.push(line)
    }
  }
  return new Text(lines.join('\n'), 0, 0)
}

function readFilterSuffix(input: TodoReadInput): string {
  const parts: string[] = []
  if (input.statusFilter !== undefined && input.statusFilter.length > 0) {
    parts.push(`status: ${input.statusFilter.join(', ')}`)
  }
  if (input.idFilter !== undefined && input.idFilter.length > 0) {
    parts.push(`ids: ${input.idFilter.join(', ')}`)
  }
  return parts.length === 0 ? '' : ` (${parts.join('; ')})`
}

export default function todo(pi: ExtensionAPI): void {
  let todos: Todo[] = []
  const overlay = new TodoOverlay(() => todos)
  const statusKey = 'todos'

  const refreshStatus = (ctx: ExtensionContext) => {
    const visible = todos.filter((todo) => todo.status !== 'cancelled')
    if (visible.length === 0) {
      ctx.ui.setStatus(statusKey, undefined)
      return
    }
    const completed = completedTodoCount(visible)
    ctx.ui.setStatus(statusKey, `todos ${completed}/${visible.length}`)
  }

  const restore = (ctx: ExtensionContext) => {
    todos = []
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'message') {
        continue
      }
      const message = entry.message
      if (message.role !== 'toolResult' || message.toolName !== 'todo_write') {
        continue
      }
      const details = decodeTodoWriteDetails(message.details)
      if (details !== null) {
        todos = cloneTodos(details.todos)
      }
    }
    refreshStatus(ctx)
    if (ctx.hasUI) {
      overlay.setUI(ctx.ui)
      overlay.reset()
      overlay.update()
    }
  }

  pi.on('session_start', (_event, ctx) => {
    restore(ctx)
  })

  pi.on('session_tree', (_event, ctx) => {
    restore(ctx)
  })

  pi.on('session_shutdown', () => {
    overlay.dispose()
  })

  pi.on('agent_start', () => {
    pi.events.emit('todo_turn_start_ids', {
      todoIds: todos.map((todo) => todo.id),
    })
    overlay.hideCompletedFromPreviousRun()
  })

  pi.registerTool({
    name: 'todo_write',
    label: 'Todo write',
    description: todoWriteDescription,
    promptSnippet: 'Create and manage a structured task list for the current coding session',
    promptGuidelines: [
      'Use todo_write before substantial multi-step work, after new requirements, and after each completed task.',
      'Before the final response, use todo_write to mark every task completed or cancelled.',
    ],
    parameters: TodoWriteSchema,
    executionMode: 'sequential',
    async execute(toolCallId, params, _signal, _onUpdate, ctx) {
      const details: TodoWriteDetails = updateTodos(todos, params.todos, params.merge, Date.now())
      todos = cloneTodos(details.todos)
      refreshStatus(ctx)
      if (ctx.hasUI) {
        overlay.setUI(ctx.ui)
        if (todos.length === 0) {
          overlay.reset()
        }
        overlay.update()
      }
      const notificationTodos = params.todos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      }))
      pi.events.emit('todo_update', {
        toolCallId,
        todos: notificationTodos,
        merge: params.merge,
      })
      return {
        content: [{ type: 'text', text: formatTodoWriteResult(todos) }],
        details,
      }
    },
    renderCall(args, theme) {
      const action =
        !args.merge && args.todos.length === 0 ? 'Clearing' : args.merge ? 'Updating' : 'Creating'
      return new Text(theme.fg('warning', `${action} to-dos...`), 0, 0)
    },
    renderResult(result, _options, theme) {
      const details = decodeTodoWriteDetails(result.details)
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Unknown error'
        return new Text(theme.fg('error', `Error updating to-dos: ${message}`), 0, 0)
      }
      if (!details.wasMerge && details.todos.length === 0) {
        return new Text(theme.fg('success', 'Cleared to-dos'), 0, 0)
      }
      return renderTodoList(details.todos, theme)
    },
  })

  pi.registerTool({
    name: 'todo_read',
    label: 'Todo read',
    description: todoReadDescription,
    promptSnippet: 'Read and filter the structured task list for the current coding session',
    parameters: TodoReadSchema,
    executionMode: 'sequential',
    async execute(_toolCallId, params) {
      const details: TodoReadDetails = readTodos(todos, params)
      return {
        content: [{ type: 'text', text: formatTodoReadResult(details.todos) }],
        details,
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg('warning', `Reading to-dos...${readFilterSuffix(args)}`), 0, 0)
    },
    renderResult(result, _options, theme) {
      const details = decodeTodoReadDetails(result.details)
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Unknown error'
        return new Text(theme.fg('error', `Error reading to-dos: ${message}`), 0, 0)
      }
      return renderTodoList(details.todos, theme)
    },
  })
}
