import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { sanitizeTerminalText, type Todo } from './domain.ts'

const widgetKey = 'todos'
const activeTaskCap = 5
const collapsedClosedContext = 1
const treeBranch = '├─'
const treeLast = '└─'
const checkboxChecked = '☑'
const checkboxUnchecked = '☐'

export type TodoOverlayTheme = Pick<Theme, 'bold' | 'fg' | 'strikethrough'>

export function isClosedTodo(todo: Pick<Todo, 'status'>): boolean {
  return todo.status === 'completed' || todo.status === 'cancelled'
}

function isActiveTodo(todo: Pick<Todo, 'status'>): boolean {
  return todo.status === 'in_progress'
}

function formatMoreItems(remaining: number, itemType: string): string {
  return `… ${remaining} more ${itemType}${remaining === 1 ? '' : 's'}`
}

export interface CollapsedTodoSelection<T> {
  items: T[]
  summary: string
}

function selectWithinCap<T extends Pick<Todo, 'status'>>(
  base: T[],
  cap: number,
): CollapsedTodoSelection<T> {
  if (base.length <= cap) return { items: base, summary: '' }
  const active = base.filter(isActiveTodo)
  if (active.length > cap) {
    const hiddenActive = active.length - cap
    return {
      items: active.slice(0, cap),
      summary: `… ${hiddenActive} more active todo${hiddenActive === 1 ? '' : 's'}`,
    }
  }
  const first = active[0]
  const firstActiveIndex = first === undefined ? 0 : base.indexOf(first)
  const fill: T[] = []
  for (let index = firstActiveIndex; index < base.length; index += 1) {
    if (active.length + fill.length >= cap) break
    const todo = base[index]
    if (todo === undefined || isActiveTodo(todo)) continue
    fill.push(todo)
  }
  const items = [...active, ...fill]
  const hidden = base.length - items.length
  return { items, summary: hidden > 0 ? formatMoreItems(hidden, 'todo') : '' }
}

export function selectCollapsedTodos<T extends Pick<Todo, 'status'>>(
  todos: T[],
  cap: number,
): CollapsedTodoSelection<T> {
  const open = todos.filter((todo) => !isClosedTodo(todo))
  if (open.length === 0) return selectWithinCap(todos, cap)
  const lead = todos.filter(isClosedTodo).slice(-collapsedClosedContext)
  const selected = selectWithinCap(open, cap)
  return { items: [...lead, ...selected.items], summary: selected.summary }
}

export function formatTodoLine(todo: Todo, theme: TodoOverlayTheme): string {
  const content = sanitizeTerminalText(todo.content)
  switch (todo.status) {
    case 'completed':
      return theme.fg('success', `${checkboxChecked} ${theme.strikethrough(content)}`)
    case 'in_progress':
      return theme.fg('accent', `${checkboxUnchecked} ${content}`)
    case 'cancelled':
      return theme.fg('error', `${checkboxUnchecked} ${theme.strikethrough(content)}`)
    case 'blocked': {
      const note =
        todo.blocker === undefined ? 'blocked' : `blocked: ${sanitizeTerminalText(todo.blocker)}`
      return theme.fg('warning', `${checkboxUnchecked} ${content} (${note})`)
    }
    default:
      return theme.fg('dim', `${checkboxUnchecked} ${content}`)
  }
}

export function renderTodoHudLines(
  todos: readonly Todo[],
  theme: TodoOverlayTheme,
  width: number,
): string[] {
  if (todos.length === 0) return []
  const closedCount = todos.filter(isClosedTodo).length
  const header =
    theme.bold(theme.fg('accent', 'TODO')) + theme.fg('dim', ` · ${closedCount}/${todos.length}`)
  const selection = selectCollapsedTodos([...todos], activeTaskCap)
  const rows = selection.items.map((todo) => formatTodoLine(todo, theme))
  if (selection.summary !== '') rows.push(theme.fg('muted', selection.summary))

  let filled = Math.round((closedCount / todos.length) * rows.length)
  if (closedCount > 0) filled = Math.max(filled, 1)
  if (closedCount < todos.length) filled = Math.min(filled, rows.length - 1)

  const lines = [` ${header}`]
  rows.forEach((row, index) => {
    const last = index === rows.length - 1
    const branch = theme.fg(index < filled ? 'accent' : 'dim', last ? treeLast : treeBranch)
    lines.push(`  ${branch} ${row}`)
  })
  lines.push('')
  return lines.map((line) => truncateToWidth(line, width, '…'))
}

export class TodoOverlay {
  private readonly getTodos: () => readonly Todo[]
  private ui: ExtensionUIContext | undefined
  private widgetRegistered = false
  private tui: TUI | undefined
  private closedIdsPendingHide = new Set<string>()
  private hiddenClosedIds = new Set<string>()

  constructor(getTodos: () => readonly Todo[]) {
    this.getTodos = getTodos
  }

  setUI(ui: ExtensionUIContext): void {
    this.ui = ui
  }

  update(): void {
    if (this.ui === undefined) {
      return
    }
    if (!this.widgetRegistered) {
      this.ui.setWidget(
        widgetKey,
        (tui, theme) => {
          this.tui = tui
          return {
            render: (width: number) => this.renderWidget(this.ui?.theme ?? theme, width),
            invalidate: () => undefined,
          }
        },
        { placement: 'aboveEditor' },
      )
      this.widgetRegistered = true
      return
    }
    this.tui?.requestRender()
  }

  reset(): void {
    this.closedIdsPendingHide.clear()
    this.hiddenClosedIds.clear()
    this.tui?.requestRender()
  }

  hideCompletedFromPreviousRun(): void {
    if (this.closedIdsPendingHide.size === 0) {
      return
    }
    for (const id of this.closedIdsPendingHide) {
      this.hiddenClosedIds.add(id)
    }
    this.closedIdsPendingHide.clear()
    this.tui?.requestRender()
  }

  dispose(): void {
    this.ui?.setWidget(widgetKey, undefined)
    this.widgetRegistered = false
    this.tui = undefined
    this.ui = undefined
    this.reset()
  }

  private visibleTodos(): Todo[] {
    return this.getTodos().filter(
      (todo) => !(isClosedTodo(todo) && this.hiddenClosedIds.has(todo.id)),
    )
  }

  private trackSnapshot(todos: readonly Todo[]): void {
    const closed = new Set(todos.filter(isClosedTodo).map((todo) => todo.id))
    for (const id of this.closedIdsPendingHide) {
      if (!closed.has(id)) {
        this.closedIdsPendingHide.delete(id)
      }
    }
    for (const id of this.hiddenClosedIds) {
      if (!closed.has(id)) {
        this.hiddenClosedIds.delete(id)
      }
    }
    for (const todo of todos) {
      if (isClosedTodo(todo) && !this.hiddenClosedIds.has(todo.id)) {
        this.closedIdsPendingHide.add(todo.id)
      }
    }
  }

  private renderWidget(theme: TodoOverlayTheme, width: number): string[] {
    const todos = this.visibleTodos()
    this.trackSnapshot(todos)
    return renderTodoHudLines(todos, theme, width)
  }
}
