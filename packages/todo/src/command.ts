import type { Todo, TodoStatus } from './domain.ts'
import { todosToMarkdown } from './markdown.ts'

export { slugId } from './markdown.ts'

export type TodoVerb =
  | 'show'
  | 'edit'
  | 'export'
  | 'import'
  | 'append'
  | 'start'
  | 'done'
  | 'drop'
  | 'block'
  | 'unblock'
  | 'rm'
  | 'eager'
  | 'help'

const verbs: readonly TodoVerb[] = [
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

export const todoUsage = [
  '/todo                     show the list',
  '/todo edit                edit the list as Markdown in the editor',
  '/todo export [path]       write the list as Markdown (default TODO.md)',
  '/todo import [path]       replace the list from a Markdown file',
  '/todo append <text>       add a pending task',
  '/todo start <id|text>     mark a task in progress',
  '/todo done <id|text>      mark a task completed',
  '/todo drop <id|text>      mark a task cancelled',
  '/todo block <id|text> [: reason]',
  '/todo unblock <id|text>   set a blocked task back to pending',
  '/todo rm [id|text]        remove one task, or clear the list',
  '/todo eager <off|preferred|always>',
].join('\n')

export function parseTodoCommand(args: string): { verb: TodoVerb | undefined; rest: string } {
  const trimmed = args.trim()
  if (trimmed.length === 0) {
    return { verb: 'show', rest: '' }
  }
  const space = trimmed.search(/\s/)
  const head = (space === -1 ? trimmed : trimmed.slice(0, space)).toLowerCase()
  const rest = space === -1 ? '' : trimmed.slice(space + 1).trim()
  const verb = verbs.find(
    (candidate) => candidate === head || (candidate === 'help' && head === '?'),
  )
  return { verb, rest }
}

export type TodoMatch =
  | { kind: 'found'; todo: Todo }
  | { kind: 'none' }
  | { kind: 'ambiguous'; todos: Todo[] }

export function matchTodo(todos: readonly Todo[], query: string): TodoMatch {
  const trimmed = query.trim()
  const byId = todos.find((todo) => todo.id === trimmed || `#${todo.id}` === trimmed)
  if (byId !== undefined) {
    return { kind: 'found', todo: byId }
  }
  const needle = trimmed.toLowerCase()
  if (needle.length === 0) {
    return { kind: 'none' }
  }
  const matches = todos.filter((todo) => todo.content.toLowerCase().includes(needle))
  if (matches.length === 1 && matches[0] !== undefined) {
    return { kind: 'found', todo: matches[0] }
  }
  if (matches.length === 0) {
    return { kind: 'none' }
  }
  const active = matches.filter(
    (todo) => todo.status === 'in_progress' || todo.status === 'pending',
  )
  if (active.length === 1 && active[0] !== undefined) {
    return { kind: 'found', todo: active[0] }
  }
  return { kind: 'ambiguous', todos: matches }
}

export function setStatus(
  todos: readonly Todo[],
  id: string,
  status: TodoStatus,
  now: number,
  blocker?: string,
): Todo[] {
  return todos.map((todo) => {
    if (todo.id !== id) {
      return { ...todo, dependencies: [...todo.dependencies] }
    }
    const { blocker: _previous, ...rest } = todo
    const next: Todo = {
      ...rest,
      status,
      updatedAt: String(now),
      dependencies: [...todo.dependencies],
    }
    if (status === 'blocked' && blocker !== undefined && blocker.trim().length > 0) {
      next.blocker = blocker.trim()
    }
    return next
  })
}

export function splitBlockArguments(rest: string): { query: string; reason: string | undefined } {
  const separator = rest.indexOf(':')
  if (separator === -1) {
    return { query: rest.trim(), reason: undefined }
  }
  const reason = rest.slice(separator + 1).trim()
  return {
    query: rest.slice(0, separator).trim(),
    reason: reason.length === 0 ? undefined : reason,
  }
}

export function userEditReminder(action: string, todos: readonly Todo[], removed: boolean): string {
  const markdown = todos.length === 0 ? '(empty)' : todosToMarkdown(todos).trimEnd()
  const lines = ['<system-reminder>', `The user manually modified the todo list (${action}).`]
  if (removed) {
    lines.push(
      todos.length === 0
        ? 'The user intentionally cleared the todo list. Do NOT recreate or re-populate it unless the user explicitly asks; continue the current request without a todo list.'
        : 'The user intentionally removed the entries no longer shown below. Do NOT re-add them unless the user explicitly asks.',
    )
  }
  lines.push('Current todo list:', '', markdown, '</system-reminder>')
  return lines.join('\n')
}

export type EagerMode = 'off' | 'preferred' | 'always'

export function parseEagerMode(value: string): EagerMode | undefined {
  const trimmed = value.trim().toLowerCase()
  return trimmed === 'off' || trimmed === 'preferred' || trimmed === 'always' ? trimmed : undefined
}
