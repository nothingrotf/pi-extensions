import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { sanitizeTerminalText, type Todo } from './domain.ts'

const widgetKey = 'todos'
const collapsedClosedContext = 1
const widgetTaskCap = 6
const settledLingerMs = 3_000
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const spinnerIntervalMs = 80
const taskIcon = ''
export const treeBranch = '├─'
export const treeLast = '╰─'
const checkboxChecked = '☑'
const checkboxUnchecked = '☐'

export type TodoOverlayTheme = Pick<Theme, 'bg' | 'bold' | 'fg' | 'strikethrough'> &
  Partial<Pick<Theme, 'getBgAnsi'>>

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

function dockInset(width: number): number {
  return Math.min(3, Math.max(0, Math.floor(width) - 1))
}

function renderPanel(
  rows: readonly string[],
  title: string,
  active: boolean,
  theme: TodoOverlayTheme,
  width: number,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const inset = dockInset(safeWidth)
  const innerWidth = safeWidth - inset
  const outer = ' '.repeat(inset)
  const line = (text: string) => `${outer}${truncateToWidth(text, innerWidth, '…')}`
  const color = active ? 'accent' : 'muted'
  return [line(theme.bold(theme.fg(color, title))), ...rows.map(line)]
}

function settledSignature(todos: readonly Todo[]): string {
  return JSON.stringify(todos.map((todo) => [todo.id, todo.status, todo.updatedAt]))
}

function settledDeadline(todos: readonly Todo[]): number {
  const updatedAt = Math.max(
    0,
    ...todos.map((todo) => Number(todo.updatedAt)).filter((value) => Number.isFinite(value)),
  )
  return updatedAt + settledLingerMs
}

function widgetTodoLine(todo: Todo, theme: TodoOverlayTheme, frame: number): string {
  const content = sanitizeTerminalText(todo.content)
  if (todo.status === 'in_progress') {
    const spinner = spinnerFrames[frame % spinnerFrames.length] ?? spinnerFrames[0] ?? '⠋'
    return `${theme.fg('accent', spinner)} ${theme.bold(theme.fg('text', content))}`
  }
  if (todo.status === 'blocked') {
    return `${theme.fg('error', '✗')} ${theme.fg('error', content)}`
  }
  return `${theme.fg('muted', '○')} ${theme.fg('muted', content)}`
}

export function renderTodoHudLines(
  todos: readonly Todo[],
  theme: TodoOverlayTheme,
  width: number,
  now = Date.now(),
): string[] {
  if (todos.length === 0) return []
  const completedCount = todos.filter((todo) => todo.status === 'completed').length
  const cancelledCount = todos.filter((todo) => todo.status === 'cancelled').length
  const active = todos.filter(isActiveTodo)
  const queued = todos.filter((todo) => todo.status === 'pending' || todo.status === 'blocked')
  const open = [...active, ...queued]
  const visible = open.slice(0, widgetTaskCap)
  const rows: string[] = []
  if (completedCount > 0) rows.push(theme.fg('success', `+${completedCount} done`))
  if (cancelledCount > 0) rows.push(theme.fg('error', `+${cancelledCount} dropped`))
  const frame = Math.floor(now / spinnerIntervalMs)
  rows.push(...visible.map((todo) => widgetTodoLine(todo, theme, frame)))
  if (open.length > visible.length) {
    rows.push(theme.fg('muted', `+${open.length - visible.length} more`))
  }
  return renderPanel(
    rows,
    `${taskIcon} Tasks ${completedCount}/${todos.length} ▾`,
    active.length > 0,
    theme,
    width,
  )
}

export class TodoOverlay {
  private readonly getTodos: () => readonly Todo[]
  private ui: ExtensionUIContext | undefined
  private widgetRegistered = false
  private tui: TUI | undefined
  private animationTimer: ReturnType<typeof setInterval> | undefined
  private settledTimer: ReturnType<typeof setTimeout> | undefined
  private settledDeadline: number | undefined
  private settledSignature: string | undefined
  private sawOpenTodos = false
  private closedIdsPendingHide = new Set<string>()
  private hiddenClosedIds = new Set<string>()

  constructor(getTodos: () => readonly Todo[]) {
    this.getTodos = getTodos
  }

  setUI(ui: ExtensionUIContext): void {
    this.ui = ui
  }

  update(): void {
    if (this.ui === undefined) return
    this.trackSnapshot(this.getTodos())
    if (!this.widgetRegistered) {
      this.ui.setWidget(
        widgetKey,
        (tui, theme) => {
          this.tui = tui
          this.syncAnimation()
          return {
            render: (width: number) => this.renderWidget(this.ui?.theme ?? theme, width),
            invalidate: () => undefined,
          }
        },
        { placement: 'aboveEditor' },
      )
      this.widgetRegistered = true
      this.syncSettledExpiry()
      return
    }
    this.syncAnimation()
    this.syncSettledExpiry()
    this.tui?.requestRender()
  }

  reset(): void {
    this.closedIdsPendingHide.clear()
    this.hiddenClosedIds.clear()
    this.sawOpenTodos = false
    this.settledSignature = undefined
    this.stopSettledTimer()
    this.syncAnimation()
    this.syncSettledExpiry()
    this.tui?.requestRender()
  }

  hideCompletedFromPreviousRun(): void {
    if (this.closedIdsPendingHide.size === 0) return
    for (const id of this.closedIdsPendingHide) this.hiddenClosedIds.add(id)
    this.closedIdsPendingHide.clear()
    this.syncAnimation()
    this.syncSettledExpiry()
    this.tui?.requestRender()
  }

  dispose(): void {
    this.stopAnimation()
    this.stopSettledTimer()
    this.ui?.setWidget(widgetKey, undefined)
    this.widgetRegistered = false
    this.tui = undefined
    this.ui = undefined
    this.sawOpenTodos = false
    this.settledSignature = undefined
    this.closedIdsPendingHide.clear()
    this.hiddenClosedIds.clear()
  }

  private visibleTodos(): Todo[] {
    return this.getTodos().filter(
      (todo) => !(isClosedTodo(todo) && this.hiddenClosedIds.has(todo.id)),
    )
  }

  private trackSnapshot(todos: readonly Todo[]): void {
    const closed = new Set(todos.filter(isClosedTodo).map((todo) => todo.id))
    for (const id of this.closedIdsPendingHide) {
      if (!closed.has(id)) this.closedIdsPendingHide.delete(id)
    }
    for (const id of this.hiddenClosedIds) {
      if (!closed.has(id)) this.hiddenClosedIds.delete(id)
    }
    for (const todo of todos) {
      if (isClosedTodo(todo) && !this.hiddenClosedIds.has(todo.id)) {
        this.closedIdsPendingHide.add(todo.id)
      }
    }
  }

  private syncAnimation(): void {
    const animating = this.tui !== undefined && this.visibleTodos().some(isActiveTodo)
    if (!animating) {
      this.stopAnimation()
      return
    }
    if (this.animationTimer !== undefined) return
    this.animationTimer = setInterval(() => this.tui?.requestRender(), spinnerIntervalMs)
    this.animationTimer.unref()
  }

  private stopAnimation(): void {
    if (this.animationTimer === undefined) return
    clearInterval(this.animationTimer)
    this.animationTimer = undefined
  }

  private syncSettledExpiry(): void {
    const todos = this.visibleTodos()
    if (todos.length === 0) {
      this.sawOpenTodos = false
      this.settledSignature = undefined
      this.stopSettledTimer()
      return
    }
    if (todos.some((todo) => !isClosedTodo(todo))) {
      this.sawOpenTodos = true
      this.settledSignature = undefined
      this.stopSettledTimer()
      return
    }
    const signature = settledSignature(todos)
    if (signature !== this.settledSignature) {
      const changedSettledSnapshot = this.settledSignature !== undefined
      this.stopSettledTimer()
      this.settledDeadline =
        this.sawOpenTodos || changedSettledSnapshot
          ? Date.now() + settledLingerMs
          : settledDeadline(todos)
      this.settledSignature = signature
    }
    const deadline = this.settledDeadline ?? settledDeadline(todos)
    this.sawOpenTodos = false
    if (deadline <= Date.now()) {
      this.stopSettledTimer()
      this.settledDeadline = deadline
      return
    }
    if (this.settledTimer !== undefined && this.settledDeadline === deadline) return
    this.stopSettledTimer()
    this.settledDeadline = deadline
    this.settledTimer = setTimeout(() => {
      this.settledTimer = undefined
      this.tui?.requestRender()
    }, deadline - Date.now())
    this.settledTimer.unref()
  }

  private stopSettledTimer(): void {
    if (this.settledTimer !== undefined) clearTimeout(this.settledTimer)
    this.settledTimer = undefined
    this.settledDeadline = undefined
  }

  private renderWidget(theme: TodoOverlayTheme, width: number): string[] {
    const allTodos = this.getTodos()
    this.trackSnapshot(allTodos)
    const todos = this.visibleTodos()
    if (
      todos.length > 0 &&
      todos.every(isClosedTodo) &&
      Date.now() >= (this.settledDeadline ?? settledDeadline(todos))
    ) {
      return []
    }
    return renderTodoHudLines(todos, theme, width)
  }
}
