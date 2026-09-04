import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import type { TextContent } from '@earendil-works/pi-ai'
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  Theme,
} from '@earendil-works/pi-coding-agent'
import { type Component, Text, truncateToWidth } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import {
  type EagerMode,
  matchTodo,
  parseEagerMode,
  parseTodoCommand,
  setStatus,
  slugId,
  splitBlockArguments,
  todoUsage,
  userEditReminder,
} from './command.ts'
import {
  activeTodoCount,
  cloneTodos,
  completedTodoCount,
  decodeTodoReadDetails,
  decodeTodoWriteDetails,
  formatTodoReadResult,
  formatTodoSummary,
  formatTodoWriteResult,
  normalizeInProgress,
  readTodos,
  snapshotTodoDetails,
  type Todo,
  TodoInputSchema,
  type TodoReadDetails,
  type TodoReadInput,
  TodoReadSchema,
  TodoSchema,
  sanitizeTerminalText,
  type TodoWriteDetails,
  updateTodos,
  validateTodoWrite,
  type TodoStatus,
} from './domain.ts'
import { markdownToTodos, todosToMarkdown } from './markdown.ts'
import {
  formatTodoLine,
  selectCollapsedTodos,
  TodoOverlay,
  treeBranch,
  treeLast,
} from './overlay.ts'
import { emptyRailComponent, RailBridge, type RailStatus } from './rail.ts'
import {
  createReminderCycle,
  decideMidRunNudge,
  decideStopReminder,
  formatMidRunNudge,
  formatStopReminder,
  maximumStopReminders,
  recordToolResult,
} from './reminders.ts'

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

const todoWriteDescription = `Write a structured todo list to track progress within a session.

**Tasks: verbatim content strings with a stable \`id\`. Reference existing tasks by their \`id\` from the previous result. Never guess an id from memory: call \`todo_read\` to recover the list.**

After each successful call: if nothing is \`in_progress\`, the earliest \`pending\` task whose dependencies are completed auto-promotes to \`in_progress\`; if several are \`in_progress\`, only the earliest stays. Blocked tasks never auto-promote. Completed tasks never revert by themselves.

## Operations

|\`merge\`|Fields|Effect|
|---|---|---|
|\`false\`|\`todos: [...]\`|Initialize full list; replaces existing|
|\`false\`|\`todos: []\`|Clear the list|
|\`true\`|\`todos: [{id, content, status}]\`|Update or add the listed items by id; unlisted items stay unchanged|

Status values:
- \`pending\`: not started
- \`in_progress\`: current work (one at a time)
- \`completed\`: finished successfully
- \`cancelled\`: no longer needed
- \`blocked\`: waiting on external input (a user decision, another agent, a service). Add a short \`blocker\` note. Blocked items never trigger stop reminders. Set them back to \`pending\` when actionable.

Optional \`dependencies\`: ids that must complete before the task is ready. Unknown ids are an error.

A call with any error is rejected as a whole and the list stays unchanged.

## Anatomy

- Task content: 5-10 words; what, not how; unique.
- Id: short stable token (\`auth-port\`, \`run-tests\`). Never rename an id after creation.

## Rules

- Mark tasks completed immediately after finishing; keep the list in execution order.
- NEVER make a todo call the turn's only tool call. Batch it with real work: create the list with the first reads or edits; each completion with the next action. Solo todo turns waste a round trip.
- Waiting on something you cannot act on: set \`blocked\` with a \`blocker\`. If the blocker is agent-actionable, add an unblocking task instead.
- New instructions arrive mid-task: capture them in the list before proceeding.

## Create a list

- Task requires 3+ distinct steps.
- User explicitly requests one.
- User provides a set of tasks.

<critical>
User gives a multi-step plan (numbered or bulleted checklist, or "N bugs/items/tasks"):
- MUST create every item as its own task before working.
- Enumerate all; NEVER summarize into fewer tasks, sample "the important ones", drop items, or track the rest from memory.
</critical>

## Skip

Single straightforward steps, trivial tasks, purely conversational requests, and tool-call tracking within one turn.

## Examples

Initial setup:
{"merge": false, "todos": [{"id": "scaffold", "content": "Scaffold package", "status": "in_progress"}, {"id": "wire", "content": "Wire workspace", "status": "pending", "dependencies": ["scaffold"]}, {"id": "tests", "content": "Run test suite", "status": "pending", "dependencies": ["wire"]}]}

Complete one task (the next ready task auto-promotes):
{"merge": true, "todos": [{"id": "scaffold", "content": "Scaffold package", "status": "completed"}]}

Block on the user:
{"merge": true, "todos": [{"id": "wire", "content": "Wire workspace", "status": "blocked", "blocker": "needs registry token from user"}]}

Append tasks:
{"merge": true, "todos": [{"id": "retries", "content": "Handle retries", "status": "pending"}]}

Clear:
{"merge": false, "todos": []}`

const todoReadDescription =
  'Read the structured task list for the current coding session. Filter by status, ID, or both. Empty filters return the complete list.'

const TODO_ICON = '☑'

function railTodoDetail(details: TodoWriteDetails | null): string {
  if (details === null) return 'failed'
  const total = details.todos.length
  if (total === 0) return 'cleared'
  const label = `${total} task${total === 1 ? '' : 's'}`
  const done = completedTodoCount(details.todos)
  return done > 0 ? `${label} · ${done} done` : label
}

interface TodoRenderState {
  hasResult?: boolean
}

function pendingLine(state: TodoRenderState, line: string): Component {
  return {
    invalidate: () => undefined,
    render: (width: number): string[] =>
      state.hasResult === true ? [] : [truncateToWidth(line, width, '…')],
  }
}

export function todoStatusLine(
  options: { icon: string; meta?: readonly string[]; title?: string },
  theme: Theme,
): string {
  const meta = (options.meta ?? []).filter((part) => part.length > 0)
  const suffix = meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''
  return `${options.icon} ${theme.fg('accent', options.title ?? 'Todo')}${suffix}`
}

export function renderHeader(todos: readonly Todo[], theme: Theme): string {
  const icon = theme.fg('accent', TODO_ICON)
  if (todos.length === 0) return todoStatusLine({ icon, meta: ['no todos'] }, theme)
  const meta = [`${todos.length} task${todos.length === 1 ? '' : 's'}`]
  const completed = completedTodoCount(todos)
  if (completed > 0) meta.push(`${completed} done`)
  if (activeTodoCount(todos) === 0) meta.push(theme.fg('success', 'all done'))
  return todoStatusLine({ icon, meta }, theme)
}

const toolResultCap = 8

export function renderTodoLines(
  todos: readonly Todo[],
  theme: Theme,
  options: { expanded: boolean },
): string[] {
  const lines = [renderHeader(todos, theme)]
  if (todos.length === 0) return lines
  lines.push('')
  const selection = options.expanded
    ? { items: [...todos], summary: '' }
    : selectCollapsedTodos([...todos], toolResultCap)
  selection.items.forEach((todo, index) => {
    const last = selection.summary === '' && index === selection.items.length - 1
    lines.push(`${theme.fg('dim', last ? treeLast : treeBranch)} ${formatTodoLine(todo, theme)}`)
  })
  if (selection.summary !== '') {
    lines.push(`${theme.fg('dim', treeLast)} ${theme.fg('muted', selection.summary)}`)
  }
  return lines
}

function renderTodoList(todos: readonly Todo[], theme: Theme, expanded: boolean): Text {
  return new Text(renderTodoLines(todos, theme, { expanded }).join('\n'), 0, 0)
}

interface AssistantSummary {
  text: string
  hadToolCalls: boolean
  stopReason: string
}

function lastAssistant(messages: AgentEndEvent['messages']): AssistantSummary | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant') {
      continue
    }
    const text = message.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    return {
      text,
      hadToolCalls: message.content.some((block) => block.type === 'toolCall'),
      stopReason: message.stopReason,
    }
  }
  return null
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

const userEditEntryType = 'pi-todo-user-edit'
const eagerEntryType = 'pi-todo-eager'

const UserEditEntrySchema = Type.Object({ todos: Type.Array(TodoSchema) })
const EagerEntrySchema = Type.Object({
  mode: Type.Union([Type.Literal('off'), Type.Literal('preferred'), Type.Literal('always')]),
})

function decodeUserEditEntry<Input>(value: Input): Todo[] | null {
  try {
    return cloneTodos(Value.Decode(UserEditEntrySchema, value).todos)
  } catch {
    return null
  }
}

function decodeEagerEntry<Input>(value: Input): EagerMode | null {
  try {
    return Value.Decode(EagerEntrySchema, value).mode
  } catch {
    return null
  }
}

const ReminderDetailsSchema = Type.Object({
  attempt: Type.Integer(),
  maxAttempts: Type.Integer(),
  todos: Type.Array(Type.Object({ id: Type.String(), content: Type.String() })),
})

function decodeReminderDetails<Input>(value: Input) {
  try {
    return Value.Decode(ReminderDetailsSchema, value)
  } catch {
    return null
  }
}

function eagerPrelude(mode: EagerMode): string {
  if (mode === 'always') {
    return [
      '<system-reminder>',
      'Before substantive work, create a todo list.',
      '',
      'You MUST call `todo_write` first in this turn with `merge: false`.',
      'You MUST cover the entire request from investigation through implementation and verification, not just the next immediate step.',
      'Task content MUST be concise, specific 5-10 word labels with short stable ids.',
      '',
      'After `todo_write` succeeds, continue the request in the same turn.',
      'NEVER call `todo_write` again unless task state has materially changed.',
      '</system-reminder>',
    ].join('\n')
  }
  return [
    '<system-reminder>',
    'Consider calling `todo_write` first with `merge: false` to lay out a plan. A good list covers the whole request, investigation through implementation and verification, not just the next step, with specific task content a future turn could execute without re-planning.',
    'Keep each task to a concise, specific 5-10 word label with a short stable id.',
    'If you create the list, continue the request in the same turn and avoid re-calling `todo_write` unless task state materially changes.',
    '</system-reminder>',
  ].join('\n')
}

function resolveMarkdownPath(input: string, cwd: string): string {
  const raw = input.trim().replace(/^"(.*)"$/, '$1') || 'TODO.md'
  return isAbsolute(raw) ? raw : resolve(cwd, raw)
}

export default function todo(pi: ExtensionAPI): void {
  let todos: Todo[] = []
  const rail = new RailBridge(pi, ['todo_read', 'todo_write'])
  const overlay = new TodoOverlay(() => todos)
  const statusKey = 'todos'
  let cycle = createReminderCycle()
  let reminderTurnPending = false
  const defaultEagerMode: EagerMode = 'preferred'
  let eagerMode: EagerMode = defaultEagerMode
  let userPromptPending = false

  const todoToolActive = () => pi.getActiveTools().includes('todo_write')

  const refreshStatus = (ctx: ExtensionContext) => {
    ctx.ui.setStatus(statusKey, undefined)
  }

  const restore = (ctx: ExtensionContext) => {
    todos = []
    eagerMode = defaultEagerMode
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'custom') {
        if (entry.customType === userEditEntryType) {
          const edited = decodeUserEditEntry(entry.data)
          if (edited !== null) {
            todos = edited
          }
        } else if (entry.customType === eagerEntryType) {
          const mode = decodeEagerEntry(entry.data)
          if (mode !== null) {
            eagerMode = mode
          }
        }
        continue
      }
      if (entry.type !== 'message') {
        continue
      }
      const message = entry.message
      if (
        message.role !== 'toolResult' ||
        message.toolName !== 'todo_write' ||
        message.isError === true
      ) {
        continue
      }
      const details = decodeTodoWriteDetails(message.details)
      if (details !== null) {
        todos = cloneTodos(details.todos)
      }
    }
    refreshStatus(ctx)
    if (ctx.mode === 'tui') {
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

  const hasUserMessages = (ctx: ExtensionContext): boolean =>
    ctx.sessionManager
      .getBranch()
      .some((entry) => entry.type === 'message' && entry.message.role === 'user')

  pi.on('input', (event) => {
    const text = event.text.trim()
    userPromptPending = text.length > 0 && !text.startsWith('/')
  })

  pi.on('before_agent_start', (event, ctx) => {
    const fromUserPrompt = userPromptPending
    userPromptPending = false
    if (reminderTurnPending) {
      reminderTurnPending = false
      return
    }
    cycle = createReminderCycle()
    if (!fromUserPrompt || eagerMode === 'off' || todos.length > 0 || !todoToolActive()) {
      return
    }
    const prompt = event.prompt.trimEnd()
    if (prompt.endsWith('?') || prompt.endsWith('!') || hasUserMessages(ctx)) {
      return
    }
    return {
      message: {
        customType: 'eager-todo-prelude',
        content: eagerPrelude(eagerMode),
        display: false,
      },
    }
  })

  pi.on('tool_execution_end', (event) => {
    cycle = recordToolResult(cycle, event.toolName, event.isError)
    if (!todoToolActive()) {
      return
    }
    const decision = decideMidRunNudge(cycle, todos)
    if (decision.kind === 'silent') {
      return
    }
    cycle = decision.cycle
    pi.sendMessage(
      {
        customType: 'todo-mid-run-nudge',
        content: formatMidRunNudge(decision.incompleteCount),
        display: false,
      },
      { triggerTurn: false, deliverAs: 'steer' },
    )
  })

  pi.on('agent_end', (event, ctx) => {
    if (!todoToolActive() || ctx.hasPendingMessages()) {
      return
    }
    const assistant = lastAssistant(event.messages)
    if (assistant === null) {
      return
    }
    const decision = decideStopReminder(cycle, todos, assistant)
    if (decision.kind === 'silent') {
      return
    }
    cycle = decision.cycle
    reminderTurnPending = true
    pi.events.emit('todo_reminder', {
      todos: decision.todos.map((todo) => ({
        id: todo.id,
        content: todo.content,
        status: todo.status,
      })),
      attempt: decision.attempt,
      maxAttempts: maximumStopReminders,
    })
    pi.sendMessage(
      {
        customType: 'todo-reminder',
        content: formatStopReminder(decision.todos, decision.attempt),
        display: true,
        details: {
          attempt: decision.attempt,
          maxAttempts: maximumStopReminders,
          todos: decision.todos.map((todo) => ({ id: todo.id, content: todo.content })),
        },
      },
      { triggerTurn: true, deliverAs: 'followUp' },
    )
  })

  pi.on('agent_start', () => {
    pi.events.emit('todo_turn_start_ids', {
      todoIds: todos.map((todo) => todo.id),
    })
    overlay.hideCompletedFromPreviousRun()
  })

  pi.registerTool<typeof TodoWriteSchema, TodoWriteDetails, TodoRenderState>({
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
      const errors = validateTodoWrite(todos, params.todos, params.merge)
      if (errors.length > 0) {
        return {
          content: [{ type: 'text', text: formatTodoSummary(todos, errors) }],
          details: snapshotTodoDetails(todos),
          isError: true,
        }
      }
      const details: TodoWriteDetails = updateTodos(todos, params.todos, params.merge, Date.now())
      todos = cloneTodos(details.todos)
      refreshStatus(ctx)
      if (ctx.mode === 'tui') {
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
    renderShell: 'self',
    renderCall(args, theme, context) {
      const op = !args.merge && args.todos.length === 0 ? 'clear' : args.merge ? 'merge' : 'init'
      const count =
        args.todos.length === 0
          ? ''
          : `${args.todos.length} item${args.todos.length === 1 ? '' : 's'}`
      if (rail.active) {
        rail.report({
          detail: `${op} ${count}`.trim(),
          category: 'meta',
          doneLabel: 'Todo',
          runningLabel: 'Todo',
          status: 'pending',
          toolCallId: context.toolCallId,
          iconKey: 'todo',
          toolName: 'todo_write',
        })
        return emptyRailComponent
      }
      return pendingLine(
        context.state,
        todoStatusLine({ icon: theme.fg('muted', '⏳'), meta: [`${op} ${count}`.trim()] }, theme),
      )
    },
    renderResult(result, options, theme, context) {
      context.state.hasResult = true
      const details = decodeTodoWriteDetails(result.details)
      if (rail.active) {
        const status: RailStatus = context.isError ? 'error' : 'ok'
        rail.report({
          detail: railTodoDetail(details),
          category: 'meta',
          doneLabel: 'Todo',
          runningLabel: 'Todo',
          status,
          toolCallId: context.toolCallId,
          iconKey: 'todo',
          toolName: 'todo_write',
        })
        return emptyRailComponent
      }
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Unknown error'
        return new Text(
          `${todoStatusLine({ icon: theme.fg('error', '✘') }, theme)}\n  ${theme.fg('error', message)}`,
          0,
          0,
        )
      }
      if (!details.wasMerge && details.todos.length === 0) {
        return new Text(
          todoStatusLine({ icon: theme.fg('accent', TODO_ICON), meta: ['cleared'] }, theme),
          0,
          0,
        )
      }
      return renderTodoList(details.todos, theme, options.expanded)
    },
  })

  pi.registerTool<typeof TodoReadSchema, TodoReadDetails, TodoRenderState>({
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
    renderShell: 'self',
    renderCall(args, theme, context) {
      if (rail.active) {
        rail.report({
          detail: `view${readFilterSuffix(args)}`,
          category: 'meta',
          doneLabel: 'Todo',
          runningLabel: 'Todo',
          status: 'pending',
          toolCallId: context.toolCallId,
          iconKey: 'todo',
          toolName: 'todo_read',
        })
        return emptyRailComponent
      }
      return pendingLine(
        context.state,
        todoStatusLine(
          { icon: theme.fg('muted', '⏳'), meta: [`view${readFilterSuffix(args)}`] },
          theme,
        ),
      )
    },
    renderResult(result, options, theme, context) {
      context.state.hasResult = true
      const details = decodeTodoReadDetails(result.details)
      if (rail.active) {
        rail.report({
          detail:
            details === null
              ? 'view'
              : `${details.todos.length} task${details.todos.length === 1 ? '' : 's'}`,
          category: 'meta',
          doneLabel: 'Todo',
          runningLabel: 'Todo',
          status: context.isError ? 'error' : 'ok',
          toolCallId: context.toolCallId,
          iconKey: 'todo',
          toolName: 'todo_read',
        })
        return emptyRailComponent
      }
      if (details === null) {
        const text = result.content.find((item) => item.type === 'text')
        const message = text?.type === 'text' ? text.text : 'Unknown error'
        return new Text(
          `${todoStatusLine({ icon: theme.fg('error', '✘') }, theme)}\n  ${theme.fg('error', message)}`,
          0,
          0,
        )
      }
      return renderTodoList(details.todos, theme, options.expanded)
    },
  })
  pi.registerMessageRenderer('todo-reminder', (message, _options, theme) => {
    const details = decodeReminderDetails(message.details)
    if (details === null) {
      return new Text(
        todoStatusLine({ icon: theme.fg('warning', '⚠'), title: 'Todo reminder' }, theme),
        0,
        0,
      )
    }
    const lines = [
      todoStatusLine(
        {
          icon: theme.fg('warning', '⚠'),
          meta: [`${details.attempt}/${details.maxAttempts}`, `${details.todos.length} incomplete`],
          title: 'Todo reminder',
        },
        theme,
      ),
      ...details.todos.map(
        (todo, index) =>
          `${theme.fg('dim', index === details.todos.length - 1 ? treeLast : treeBranch)} ${theme.fg('warning', `☐ ${sanitizeTerminalText(todo.content)}`)}`,
      ),
    ]
    return new Text(lines.join('\n'), 1, 0)
  })

  const commitUserEdit = (
    next: Todo[],
    action: string,
    ctx: ExtensionCommandContext,
    options: { removed?: boolean } = {},
  ) => {
    todos = normalizeInProgress(cloneTodos(next), Date.now())
    refreshStatus(ctx)
    if (ctx.mode === 'tui') {
      overlay.setUI(ctx.ui)
      if (todos.length === 0) {
        overlay.reset()
      }
      overlay.update()
    }
    pi.appendEntry(userEditEntryType, { todos: cloneTodos(todos) })
    pi.events.emit('todo_update', {
      toolCallId: null,
      todos: todos.map((item) => ({ id: item.id, content: item.content, status: item.status })),
      merge: false,
    })
    pi.sendMessage(
      {
        customType: 'todo-user-edit',
        content: userEditReminder(action, todos, options.removed === true),
        display: false,
      },
      { triggerTurn: false, deliverAs: ctx.isIdle() ? 'nextTurn' : 'steer' },
    )
    ctx.ui.notify(`Todo list updated (${action}).`)
  }

  const resolveTarget = (query: string, ctx: ExtensionCommandContext): Todo | undefined => {
    if (query.trim().length === 0) {
      ctx.ui.notify('Name a task by id or by part of its text.', 'warning')
      return undefined
    }
    const match = matchTodo(todos, query)
    if (match.kind === 'found') {
      return match.todo
    }
    if (match.kind === 'ambiguous') {
      ctx.ui.notify(
        `Ambiguous task "${query}": ${match.todos.map((item) => `#${item.id}`).join(', ')}`,
        'warning',
      )
      return undefined
    }
    ctx.ui.notify(`No task matches "${query}".`, 'warning')
    return undefined
  }

  const mutateStatus = (
    query: string,
    status: TodoStatus,
    ctx: ExtensionCommandContext,
    blocker?: string,
  ) => {
    const target = resolveTarget(query, ctx)
    if (target === undefined) {
      return
    }
    commitUserEdit(
      setStatus(todos, target.id, status, Date.now(), blocker),
      `/todo ${status === 'cancelled' ? 'drop' : status === 'in_progress' ? 'start' : status === 'completed' ? 'done' : status === 'blocked' ? 'block' : 'unblock'} #${target.id}`,
      ctx,
    )
  }

  const showList = (ctx: ExtensionCommandContext) => {
    if (todos.length === 0) {
      ctx.ui.notify('No to-dos.')
      return
    }
    ctx.ui.notify(todosToMarkdown(todos).trimEnd())
  }

  const editInEditor = async (ctx: ExtensionCommandContext) => {
    const edited = await ctx.ui.editor('Todo list (Markdown checklist)', todosToMarkdown(todos))
    if (edited === undefined) {
      return
    }
    const parsed = markdownToTodos(edited, todos, Date.now())
    if (parsed.errors.length > 0) {
      ctx.ui.notify(`Todo edit rejected:\n${parsed.errors.join('\n')}`, 'error')
      return
    }
    const removed = todos.some((item) => !parsed.todos.some((next) => next.id === item.id))
    commitUserEdit(parsed.todos, '/todo edit', ctx, { removed })
  }

  const exportToFile = async (rest: string, ctx: ExtensionCommandContext) => {
    const path = resolveMarkdownPath(rest, ctx.cwd)
    await writeFile(path, todosToMarkdown(todos), 'utf8')
    ctx.ui.notify(`Todo list exported to ${path}.`)
  }

  const importFromFile = async (rest: string, ctx: ExtensionCommandContext) => {
    const path = resolveMarkdownPath(rest, ctx.cwd)
    let markdown: string
    try {
      markdown = await readFile(path, 'utf8')
    } catch (error) {
      ctx.ui.notify(
        `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      )
      return
    }
    const parsed = markdownToTodos(markdown, todos, Date.now())
    if (parsed.errors.length > 0) {
      ctx.ui.notify(`Todo import rejected:\n${parsed.errors.join('\n')}`, 'error')
      return
    }
    const removed = todos.some((item) => !parsed.todos.some((next) => next.id === item.id))
    commitUserEdit(parsed.todos, `/todo import ${path}`, ctx, { removed })
  }

  const appendTask = (rest: string, ctx: ExtensionCommandContext) => {
    const content = rest.trim()
    if (content.length === 0) {
      ctx.ui.notify('Usage: /todo append <text>', 'warning')
      return
    }
    const id = slugId(content, new Set(todos.map((item) => item.id)))
    const timestamp = String(Date.now())
    commitUserEdit(
      [
        ...todos,
        {
          id,
          content,
          status: 'pending',
          createdAt: timestamp,
          updatedAt: timestamp,
          dependencies: [],
        },
      ],
      `/todo append #${id}`,
      ctx,
    )
  }

  const removeTask = async (rest: string, ctx: ExtensionCommandContext) => {
    if (rest.trim().length === 0) {
      if (todos.length === 0) {
        ctx.ui.notify('No to-dos.')
        return
      }
      const confirmed = await ctx.ui.confirm(
        'Clear todo list?',
        `Remove all ${todos.length} to-dos.`,
      )
      if (!confirmed) {
        return
      }
      commitUserEdit([], '/todo rm (all)', ctx, { removed: true })
      return
    }
    const target = resolveTarget(rest, ctx)
    if (target === undefined) {
      return
    }
    const remaining = todos
      .filter((item) => item.id !== target.id)
      .map((item) => ({
        ...item,
        dependencies: item.dependencies.filter((dependency) => dependency !== target.id),
      }))
    commitUserEdit(remaining, `/todo rm #${target.id}`, ctx, { removed: true })
  }

  const setEagerMode = (rest: string, ctx: ExtensionCommandContext) => {
    const mode = parseEagerMode(rest)
    if (mode === undefined) {
      ctx.ui.notify(`Todo eager mode: ${eagerMode}. Use /todo eager <off|preferred|always>.`)
      return
    }
    eagerMode = mode
    pi.appendEntry(eagerEntryType, { mode })
    ctx.ui.notify(`Todo eager mode set to ${mode}.`)
  }

  pi.registerCommand('todo', {
    description: 'Show, edit, export, import, or change the todo list.',
    getArgumentCompletions(prefix) {
      const trimmed = prefix.trim()
      return [
        'show',
        'edit',
        'export',
        'import',
        'append',
        'start',
        'done',
        'drop',
        'block',
        'unblock',
        'rm',
        'eager',
        'help',
      ]
        .filter((value) => value.startsWith(trimmed))
        .map((value) => ({ value, label: value }))
    },
    async handler(args, ctx) {
      const { verb, rest } = parseTodoCommand(args)
      switch (verb) {
        case 'show':
          showList(ctx)
          return
        case 'edit':
          await editInEditor(ctx)
          return
        case 'export':
          await exportToFile(rest, ctx)
          return
        case 'import':
          await importFromFile(rest, ctx)
          return
        case 'append':
          appendTask(rest, ctx)
          return
        case 'start':
          mutateStatus(rest, 'in_progress', ctx)
          return
        case 'done':
          mutateStatus(rest, 'completed', ctx)
          return
        case 'drop':
          mutateStatus(rest, 'cancelled', ctx)
          return
        case 'block': {
          const { query, reason } = splitBlockArguments(rest)
          mutateStatus(query, 'blocked', ctx, reason)
          return
        }
        case 'unblock':
          mutateStatus(rest, 'pending', ctx)
          return
        case 'rm':
          await removeTask(rest, ctx)
          return
        case 'eager':
          setEagerMode(rest, ctx)
          return
        case 'help':
          ctx.ui.notify(todoUsage)
          return
        default:
          ctx.ui.notify(`Unknown /todo verb.\n${todoUsage}`, 'error')
      }
    },
  })
}
