import { StringEnum } from '@earendil-works/pi-ai'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

export const TodoStatusSchema = StringEnum([
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'blocked',
])

const blockerDescription =
  'Note on what a blocked TODO waits for. Only meaningful with status blocked'

export const TodoInputSchema = Type.Object(
  {
    id: Type.String({ description: 'Unique identifier for the TODO item' }),
    content: Type.String({ description: 'The description/content of the TODO item' }),
    status: TodoStatusSchema,
    dependencies: Type.Optional(
      Type.Array(Type.String(), {
        description: 'IDs that must complete before this TODO is ready',
      }),
    ),
    blocker: Type.Optional(Type.String({ description: blockerDescription })),
  },
  { additionalProperties: false },
)

export const TodoSchema = Type.Object(
  {
    id: Type.String(),
    content: Type.String(),
    status: TodoStatusSchema,
    createdAt: Type.String(),
    updatedAt: Type.String(),
    dependencies: Type.Array(Type.String()),
    blocker: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

const TodoProtocolItemSchema = Type.Object(
  {
    id: Type.String(),
    content: Type.String(),
    status: TodoStatusSchema,
    dependencies: Type.Array(Type.String()),
    blocker: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

const NudgeMessageSchema = Type.Object(
  { rawMessage: Type.String() },
  { additionalProperties: false },
)

const TodoReminderTypeSchema = StringEnum(['unspecified', 'every_10_turns', 'after_edit'])

const ToolResultAttachmentsSchema = Type.Object(
  {
    originalTodos: Type.Array(TodoProtocolItemSchema),
    updatedTodos: Type.Array(TodoProtocolItemSchema),
    nudgeMessages: Type.Array(NudgeMessageSchema),
    shouldShowTodoWriteReminder: Type.Boolean(),
    todoReminderType: TodoReminderTypeSchema,
  },
  { additionalProperties: false },
)

const PersistedTodoWriteDetailsSchema = Type.Object(
  {
    todos: Type.Array(TodoSchema),
    totalCount: Type.Integer({ minimum: 0 }),
    wasMerge: Type.Boolean(),
    success: Type.Optional(Type.Literal(true)),
    readyTaskIds: Type.Optional(Type.Array(Type.String())),
    needsInProgressTodos: Type.Optional(Type.Boolean()),
    initialTodos: Type.Optional(Type.Array(TodoProtocolItemSchema)),
    finalTodos: Type.Optional(Type.Array(TodoProtocolItemSchema)),
    attachments: Type.Optional(ToolResultAttachmentsSchema),
  },
  { additionalProperties: false },
)

export const TodoReadSchema = Type.Object(
  {
    statusFilter: Type.Optional(
      Type.Array(TodoStatusSchema, { description: 'Return only these TODO statuses' }),
    ),
    idFilter: Type.Optional(
      Type.Array(Type.String(), { description: 'Return only these TODO IDs' }),
    ),
  },
  { additionalProperties: false },
)

const TodoReadDetailsSchema = Type.Object(
  {
    todos: Type.Array(TodoSchema),
    totalCount: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export type TodoStatus = Static<typeof TodoStatusSchema>
export type TodoInput = Static<typeof TodoInputSchema>
export type Todo = Static<typeof TodoSchema>
export type TodoProtocolItem = Static<typeof TodoProtocolItemSchema>
export type NudgeMessage = Static<typeof NudgeMessageSchema>
export type TodoReminderType = Static<typeof TodoReminderTypeSchema>
export type ToolResultAttachments = Static<typeof ToolResultAttachmentsSchema>
export type TodoReadInput = Static<typeof TodoReadSchema>

export type TodoWriteDetails = {
  todos: Todo[]
  totalCount: number
  wasMerge: boolean
  success: true
  readyTaskIds: string[]
  needsInProgressTodos: boolean
  initialTodos: TodoProtocolItem[]
  finalTodos: TodoProtocolItem[]
  attachments: ToolResultAttachments
}

export type TodoReadDetails = {
  todos: Todo[]
  totalCount: number
}

function cloneTodo(todo: Todo): Todo {
  return { ...todo, dependencies: [...todo.dependencies] }
}

export function cloneTodos(todos: readonly Todo[]): Todo[] {
  return todos.map(cloneTodo)
}

function toProtocolItem(todo: Todo): TodoProtocolItem {
  const item: TodoProtocolItem = {
    id: todo.id,
    content: todo.content,
    status: todo.status,
    dependencies: [...todo.dependencies],
  }
  if (todo.blocker !== undefined) {
    item.blocker = todo.blocker
  }
  return item
}

function blockerFor(status: TodoStatus, blocker: string | undefined): string | undefined {
  if (status !== 'blocked' || blocker === undefined) {
    return undefined
  }
  const trimmed = blocker.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function toProtocolItems(todos: readonly Todo[]): TodoProtocolItem[] {
  return todos.map(toProtocolItem)
}

export function readyTaskIds(todos: readonly Todo[]): string[] {
  const completedIds = new Set(
    todos.filter((todo) => todo.status === 'completed').map((todo) => todo.id),
  )
  return todos
    .filter(
      (todo) =>
        todo.status === 'pending' &&
        todo.dependencies.every((dependency) => completedIds.has(dependency)),
    )
    .map((todo) => todo.id)
}

export function needsInProgressTodos(todos: readonly Todo[]): boolean {
  return (
    todos.some((todo) => todo.status === 'pending') &&
    !todos.some((todo) => todo.status === 'in_progress')
  )
}

function createAttachments(
  initialTodos: readonly Todo[],
  finalTodos: readonly Todo[],
): ToolResultAttachments {
  return {
    originalTodos: toProtocolItems(initialTodos),
    updatedTodos: toProtocolItems(finalTodos),
    nudgeMessages: [],
    shouldShowTodoWriteReminder: false,
    todoReminderType: 'unspecified',
  }
}

function createDetails(
  initialTodos: readonly Todo[],
  finalTodos: readonly Todo[],
  wasMerge: boolean,
): TodoWriteDetails {
  const todos = cloneTodos(finalTodos)
  return {
    todos,
    totalCount: todos.length,
    wasMerge,
    success: true,
    readyTaskIds: readyTaskIds(todos),
    needsInProgressTodos: needsInProgressTodos(todos),
    initialTodos: toProtocolItems(initialTodos),
    finalTodos: toProtocolItems(todos),
    attachments: createAttachments(initialTodos, todos),
  }
}

export function decodeTodoWriteDetails<Input>(value: Input): TodoWriteDetails | null {
  try {
    const decoded = Value.Decode(PersistedTodoWriteDetailsSchema, value)
    if (decoded.totalCount !== decoded.todos.length) {
      return null
    }
    const initialTodos = decoded.initialTodos ?? []
    const finalTodos = decoded.finalTodos ?? toProtocolItems(decoded.todos)
    return {
      todos: cloneTodos(decoded.todos),
      totalCount: decoded.totalCount,
      wasMerge: decoded.wasMerge,
      success: true,
      readyTaskIds: decoded.readyTaskIds ?? readyTaskIds(decoded.todos),
      needsInProgressTodos: decoded.needsInProgressTodos ?? needsInProgressTodos(decoded.todos),
      initialTodos: initialTodos.map((todo) => ({
        ...todo,
        dependencies: [...todo.dependencies],
      })),
      finalTodos: finalTodos.map((todo) => ({
        ...todo,
        dependencies: [...todo.dependencies],
      })),
      attachments: decoded.attachments ?? createAttachments([], decoded.todos),
    }
  } catch {
    return null
  }
}

function createTodo(input: TodoInput, now: number): Todo {
  const timestamp = String(now)
  const todo: Todo = {
    id: input.id,
    content: input.content,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencies: [...(input.dependencies ?? [])],
  }
  const blocker = blockerFor(input.status, input.blocker)
  if (blocker !== undefined) {
    todo.blocker = blocker
  }
  return todo
}

function updateTodo(current: Todo, input: TodoInput, now: number): Todo {
  const todo: Todo = {
    id: input.id,
    content: input.content,
    status: input.status,
    createdAt: current.createdAt,
    updatedAt: String(now),
    dependencies: [...(input.dependencies ?? current.dependencies)],
  }
  const blocker = blockerFor(input.status, input.blocker ?? current.blocker)
  if (blocker !== undefined) {
    todo.blocker = blocker
  }
  return todo
}

function mergedTodos(
  current: readonly Todo[],
  incoming: readonly TodoInput[],
  merge: boolean,
  now: number,
): Todo[] {
  if (!merge) {
    return incoming.map((todo) => createTodo(todo, now))
  }
  const byId = new Map<string, Todo>()
  for (const todo of current) {
    byId.set(todo.id, cloneTodo(todo))
  }
  for (const todo of incoming) {
    const existing = byId.get(todo.id)
    byId.set(
      todo.id,
      existing === undefined ? createTodo(todo, now) : updateTodo(existing, todo, now),
    )
  }
  return [...byId.values()]
}

export function validateTodoWrite(
  current: readonly Todo[],
  incoming: readonly TodoInput[],
  merge: boolean,
): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const todo of incoming) {
    if (todo.id.trim().length === 0) {
      errors.push('Todo id cannot be blank')
    }
    if (todo.content.trim().length === 0) {
      errors.push(`Todo "${todo.id}" has blank content`)
    }
    if (seen.has(todo.id)) {
      errors.push(`Duplicate id "${todo.id}" in todos`)
    }
    seen.add(todo.id)
  }
  const known = new Set(merge ? current.map((todo) => todo.id) : [])
  for (const id of seen) {
    known.add(id)
  }
  for (const todo of incoming) {
    for (const dependency of todo.dependencies ?? []) {
      if (dependency === todo.id) {
        errors.push(`Todo "${todo.id}" depends on itself`)
      } else if (!known.has(dependency)) {
        errors.push(`Todo "${todo.id}" depends on unknown id "${dependency}"`)
      }
    }
  }
  return errors
}

export function normalizeInProgress(todos: Todo[], now: number): Todo[] {
  const inProgress = todos.filter((todo) => todo.status === 'in_progress')
  for (const todo of inProgress.slice(1)) {
    todo.status = 'pending'
    todo.updatedAt = String(now)
  }
  if (inProgress.length > 0) {
    return todos
  }
  const ready = new Set(readyTaskIds(todos))
  const next = todos.find((todo) => ready.has(todo.id))
  if (next !== undefined) {
    next.status = 'in_progress'
    next.updatedAt = String(now)
  }
  return todos
}

export function snapshotTodoDetails(todos: readonly Todo[]): TodoWriteDetails {
  return createDetails(todos, todos, true)
}

export function updateTodos(
  current: readonly Todo[],
  incoming: readonly TodoInput[],
  merge: boolean,
  now: number,
): TodoWriteDetails {
  const todos = normalizeInProgress(mergedTodos(current, incoming, merge, now), now)
  return createDetails(current, todos, merge)
}

function dependencyNote(todo: Todo, byId: ReadonlyMap<string, Todo>): string {
  const unmet = todo.dependencies.filter((id) => byId.get(id)?.status !== 'completed')
  return unmet.length === 0 ? '' : ` needs: ${unmet.join(', ')}`
}

export function formatTodoSummary(todos: readonly Todo[], errors: readonly string[]): string {
  const lines: string[] = []
  if (errors.length > 0) {
    lines.push(`Errors: ${errors.join('; ')}`)
  }
  if (todos.length === 0) {
    lines.push(errors.length > 0 ? 'Todo list unchanged (empty).' : 'Todo list cleared.')
    return lines.join('\n')
  }
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  const remaining = todos.filter((todo) => isRemindableStatus(todo.status))
  if (remaining.length === 0) {
    lines.push('Remaining items: none.')
  } else {
    lines.push(`Remaining items (${remaining.length}):`)
    for (const todo of remaining) {
      lines.push(
        `  - ${todo.content} [${todo.status}] (id: ${todo.id})${dependencyNote(todo, byId)}`,
      )
    }
  }
  const completed = todos.filter((todo) => todo.status === 'completed').length
  const cancelled = todos.filter((todo) => todo.status === 'cancelled').length
  const blocked = todos.filter((todo) => todo.status === 'blocked')
  lines.push(`Closed: ${completed} completed, ${cancelled} cancelled. Blocked: ${blocked.length}.`)
  for (const todo of blocked) {
    const note = todo.blocker === undefined ? '' : ` (${todo.blocker})`
    lines.push(`  - ${todo.content} [blocked] (id: ${todo.id})${note}`)
  }
  if (remaining.length > 0 && !remaining.some((todo) => todo.status === 'in_progress')) {
    lines.push('No task is in progress: every pending task waits on a dependency.')
  }
  return lines.join('\n')
}

export function formatTodoWriteResult(todos: readonly Todo[]): string {
  return formatTodoSummary(todos, [])
}

function formatTodoLine(todo: Todo): string {
  const blocker = todo.blocker === undefined ? '' : ` [blocked on: ${todo.blocker}]`
  const deps = todo.dependencies.length === 0 ? '' : ` needs: ${todo.dependencies.join(', ')}`
  return `- **${todo.status.toUpperCase()}**: ${todo.content} (id: ${todo.id})${blocker}${deps}`
}

export function decodeTodoReadDetails<Input>(value: Input): TodoReadDetails | null {
  try {
    const details = Value.Decode(TodoReadDetailsSchema, value)
    return details.totalCount === details.todos.length ? details : null
  } catch {
    return null
  }
}

export function readTodos(todos: readonly Todo[], input: TodoReadInput): TodoReadDetails {
  const statuses = input.statusFilter === undefined ? null : new Set(input.statusFilter)
  const ids = input.idFilter === undefined ? null : new Set(input.idFilter)
  const filtered = todos.filter(
    (todo) =>
      (statuses === null || statuses.has(todo.status)) && (ids === null || ids.has(todo.id)),
  )
  return { todos: cloneTodos(filtered), totalCount: filtered.length }
}

export function formatTodoReadResult(todos: readonly Todo[]): string {
  const lines = todos.map(formatTodoLine)
  return ['Here are the latest contents of your todo list:', ...lines].join('\n')
}

export function isOpenStatus(status: TodoStatus): boolean {
  return status === 'pending' || status === 'in_progress' || status === 'blocked'
}

export function isRemindableStatus(status: TodoStatus): boolean {
  return status === 'pending' || status === 'in_progress'
}

export function activeTodoCount(todos: readonly Todo[]): number {
  return todos.filter((todo) => isOpenStatus(todo.status)).length
}

export function remindableTodos(todos: readonly Todo[]): Todo[] {
  return todos.filter((todo) => isRemindableStatus(todo.status))
}

export function completedTodoCount(todos: readonly Todo[]): number {
  return todos.filter((todo) => todo.status === 'completed').length
}

function skipControlSequence(value: string, start: number): number {
  let index = start
  while (index < value.length) {
    const code = value.charCodeAt(index)
    if (code >= 0x40 && code <= 0x7e) {
      return index
    }
    index += 1
  }
  return value.length - 1
}

function skipOperatingSystemCommand(value: string, start: number): number {
  let index = start
  while (index < value.length) {
    const code = value.charCodeAt(index)
    if (code === 0x07 || code === 0x9c) {
      return index
    }
    if (code === 0x1b && value.charCodeAt(index + 1) === 0x5c) {
      return index + 1
    }
    index += 1
  }
  return value.length - 1
}

function isBidirectionalControl(code: number): boolean {
  return (
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  )
}

export function sanitizeTerminalText(value: string): string {
  let result = ''
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code === 0x1b) {
      const next = value.charCodeAt(index + 1)
      if (next === 0x5b) {
        index = skipControlSequence(value, index + 2)
      } else if (next === 0x5d) {
        index = skipOperatingSystemCommand(value, index + 2)
      } else {
        index += 1
      }
      continue
    }
    if (code === 0x9b) {
      index = skipControlSequence(value, index + 1)
      continue
    }
    if (code === 0x9d) {
      index = skipOperatingSystemCommand(value, index + 1)
      continue
    }
    if (code === 0x2028 || code === 0x2029) {
      result += ' '
      continue
    }
    if (isBidirectionalControl(code)) {
      continue
    }
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) {
      if (code === 0x09 || code === 0x0a || code === 0x0d) {
        result += ' '
      }
      continue
    }
    result += value[index]
  }
  return result
}
