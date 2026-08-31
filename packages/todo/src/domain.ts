import { StringEnum } from '@earendil-works/pi-ai'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

export const TodoStatusSchema = StringEnum(['pending', 'in_progress', 'completed', 'cancelled'])

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
  },
  { additionalProperties: false },
)

const TodoProtocolItemSchema = Type.Object(
  {
    id: Type.String(),
    content: Type.String(),
    status: TodoStatusSchema,
    dependencies: Type.Array(Type.String()),
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
  return {
    id: todo.id,
    content: todo.content,
    status: todo.status,
    dependencies: [...todo.dependencies],
  }
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
  return {
    id: input.id,
    content: input.content,
    status: input.status,
    createdAt: timestamp,
    updatedAt: timestamp,
    dependencies: [...(input.dependencies ?? [])],
  }
}

function updateTodo(current: Todo, input: TodoInput, now: number): Todo {
  return {
    id: input.id,
    content: input.content,
    status: input.status,
    createdAt: current.createdAt,
    updatedAt: String(now),
    dependencies: [...(input.dependencies ?? current.dependencies)],
  }
}

export function updateTodos(
  current: readonly Todo[],
  incoming: readonly TodoInput[],
  merge: boolean,
  now: number,
): TodoWriteDetails {
  if (!merge) {
    const todos = incoming.map((todo) => createTodo(todo, now))
    return createDetails(current, todos, false)
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
  return createDetails(current, [...byId.values()], true)
}

const successPrefix =
  'Successfully updated TODOs. Make sure to follow and update your TODO list as you make progress. Cancel and add new TODO tasks as needed when the user makes a correction or follow-up request.'

const needsProgressSuffix =
  ' No TODOs are marked in-progress, make sure to mark them before starting the next.'

export function formatTodoWriteResult(todos: readonly Todo[]): string {
  const prefix = needsInProgressTodos(todos)
    ? `${successPrefix}${needsProgressSuffix}`
    : successPrefix
  const lines = todos.map(
    (todo) => `- **${todo.status.toUpperCase()}**: ${todo.content} (id: ${todo.id})`,
  )
  return [prefix, '', 'Here are the latest contents of your todo list:', ...lines].join('\n')
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
  const lines = todos.map(
    (todo) => `- **${todo.status.toUpperCase()}**: ${todo.content} (id: ${todo.id})`,
  )
  return ['Here are the latest contents of your todo list:', ...lines].join('\n')
}

export function activeTodoCount(todos: readonly Todo[]): number {
  return todos.filter((todo) => todo.status === 'in_progress' || todo.status === 'pending').length
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
