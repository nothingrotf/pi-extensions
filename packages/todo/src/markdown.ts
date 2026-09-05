import { validateTodoWrite, type Todo, type TodoStatus } from './domain.ts'

function statusToMarker(status: TodoStatus): string {
  switch (status) {
    case 'pending':
      return ' '
    case 'in_progress':
      return '/'
    case 'completed':
      return 'x'
    case 'cancelled':
      return '-'
    case 'blocked':
      return '!'
    default:
      return ' '
  }
}

function markerToStatus(marker: string): TodoStatus | undefined {
  switch (marker.toLowerCase()) {
    case ' ':
    case '':
      return 'pending'
    case '/':
      return 'in_progress'
    case 'x':
      return 'completed'
    case '-':
      return 'cancelled'
    case '!':
      return 'blocked'
    default:
      return undefined
  }
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function todosToMarkdown(todos: readonly Todo[]): string {
  const lines = ['# Todos']
  for (const todo of todos) {
    const notes: string[] = []
    if (todo.dependencies.length > 0) {
      notes.push(`deps: ${todo.dependencies.join(', ')}`)
    }
    if (todo.status === 'blocked' && todo.blocker !== undefined) {
      notes.push(`blocker: ${oneLine(todo.blocker)}`)
    }
    const note = notes.length === 0 ? '' : ` <!-- ${notes.join('; ')} -->`
    lines.push(`- [${statusToMarker(todo.status)}] #${todo.id} ${oneLine(todo.content)}${note}`)
  }
  return `${lines.join('\n')}\n`
}

const itemLine = /^\s*[-*+]\s*\\?\[\s*([^\]\\]?)\s*\\?\]\s*(.*)$/
const idPrefix = /^#(\S+)\s+(.*)$/
const trailingComment = /\s*<!--\s*(.*?)\s*-->\s*$/

export function slugId(content: string, taken: ReadonlySet<string>): string {
  const base =
    content
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'task'
  if (!taken.has(base)) {
    return base
  }
  let counter = 2
  while (taken.has(`${base}-${counter}`)) {
    counter += 1
  }
  return `${base}-${counter}`
}

function parseNotes(raw: string): { dependencies: string[]; blocker: string | undefined } {
  let dependencies: string[] = []
  let blocker: string | undefined
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith('deps:')) {
      dependencies = trimmed
        .slice(5)
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    } else if (trimmed.startsWith('blocker:')) {
      const note = trimmed.slice(8).trim()
      blocker = note.length === 0 ? undefined : note
    }
  }
  return { dependencies, blocker }
}

export function markdownToTodos(
  markdown: string,
  previous: readonly Todo[],
  now: number,
): { todos: Todo[]; errors: string[] } {
  const errors: string[] = []
  const todos: Todo[] = []
  const previousById = new Map(previous.map((todo) => [todo.id, todo]))
  const taken = new Set<string>()
  const timestamp = String(now)
  for (const [index, rawLine] of markdown.split(/\r?\n/).entries()) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) {
      continue
    }
    const match = itemLine.exec(line)
    if (match === null) {
      errors.push(`Line ${index + 1}: not a checklist item`)
      continue
    }
    const status = markerToStatus(match[1] ?? '')
    if (status === undefined) {
      errors.push(`Line ${index + 1}: unknown marker "[${match[1] ?? ''}]"`)
      continue
    }
    let body = match[2] ?? ''
    let notes: { dependencies: string[]; blocker: string | undefined } = {
      dependencies: [],
      blocker: undefined,
    }
    const comment = trailingComment.exec(body)
    if (comment !== null) {
      notes = parseNotes(comment[1] ?? '')
      body = body.slice(0, comment.index)
    }
    let id: string | undefined
    const prefixed = idPrefix.exec(body.trim())
    if (prefixed !== null) {
      id = prefixed[1]
      body = prefixed[2] ?? ''
    }
    const content = oneLine(body)
    if (content.length === 0) {
      errors.push(`Line ${index + 1}: empty task`)
      continue
    }
    const resolvedId = id ?? slugId(content, taken)
    if (taken.has(resolvedId)) {
      errors.push(`Line ${index + 1}: duplicate id "${resolvedId}"`)
      continue
    }
    taken.add(resolvedId)
    const existing = previousById.get(resolvedId)
    const todo: Todo = {
      id: resolvedId,
      content,
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt:
        existing !== undefined &&
        existing.content === content &&
        existing.status === status &&
        existing.blocker === notes.blocker &&
        existing.dependencies.join(',') === notes.dependencies.join(',')
          ? existing.updatedAt
          : timestamp,
      dependencies: notes.dependencies,
    }
    if (status === 'blocked' && notes.blocker !== undefined) {
      todo.blocker = notes.blocker
    }
    todos.push(todo)
  }
  errors.push(...validateTodoWrite([], todos, false))
  return { todos, errors }
}
