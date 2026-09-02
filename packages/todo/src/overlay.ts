import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'

import { isOpenStatus, sanitizeTerminalText, type Todo } from './domain.ts'

const maximumRows = 12
const widgetKey = 'todos'

export class TodoOverlay {
  private readonly getTodos: () => readonly Todo[]
  private ui: ExtensionUIContext | undefined
  private widgetRegistered = false
  private tui: TUI | undefined
  private completedIdsPendingHide = new Set<string>()
  private hiddenCompletedIds = new Set<string>()

  constructor(getTodos: () => readonly Todo[]) {
    this.getTodos = getTodos
  }

  setUI(ui: ExtensionUIContext): void {
    if (ui === this.ui) {
      return
    }
    this.ui = ui
    this.widgetRegistered = false
    this.tui = undefined
  }

  update(): void {
    if (this.ui === undefined) {
      return
    }
    const visible = this.visibleTodos()
    if (visible.length === 0) {
      if (this.widgetRegistered) {
        this.ui.setWidget(widgetKey, undefined)
        this.widgetRegistered = false
        this.tui = undefined
      }
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
    this.completedIdsPendingHide.clear()
    this.hiddenCompletedIds.clear()
    this.tui?.requestRender()
  }

  hideCompletedFromPreviousRun(): void {
    if (this.completedIdsPendingHide.size === 0) {
      return
    }
    for (const id of this.completedIdsPendingHide) {
      this.hiddenCompletedIds.add(id)
    }
    this.completedIdsPendingHide.clear()
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
      (todo) =>
        todo.status !== 'cancelled' &&
        !(todo.status === 'completed' && this.hiddenCompletedIds.has(todo.id)),
    )
  }

  private trackSnapshot(todos: readonly Todo[]): void {
    const completed = new Set(
      todos.filter((todo) => todo.status === 'completed').map((todo) => todo.id),
    )
    for (const id of this.completedIdsPendingHide) {
      if (!completed.has(id)) {
        this.completedIdsPendingHide.delete(id)
      }
    }
    for (const id of this.hiddenCompletedIds) {
      if (!completed.has(id)) {
        this.hiddenCompletedIds.delete(id)
      }
    }
  }

  private renderWidget(theme: Theme, width: number): string[] {
    const todos = this.visibleTodos()
    this.trackSnapshot(todos)
    if (todos.length === 0) {
      return []
    }

    const truncate = (line: string): string => truncateToWidth(line, width, '…')
    const hasActive = todos.some((todo) => isOpenStatus(todo.status))
    const completedCount = todos.filter((todo) => todo.status === 'completed').length
    const showIds = todos.some((todo) => todo.dependencies.length > 0)
    const headingColor = hasActive ? 'accent' : 'dim'
    const lines = [
      truncate(
        `${theme.fg(headingColor, hasActive ? '●' : '○')} ${theme.fg(headingColor, `Todos (${completedCount}/${todos.length})`)}`,
      ),
    ]

    let rows: Todo[]
    let hiddenCompleted = 0
    let truncatedPending = 0
    if (todos.length <= maximumRows) {
      rows = todos
    } else {
      const budget = maximumRows - 1
      const active = todos.filter((todo) => todo.status !== 'completed')
      const totalCompleted = todos.length - active.length
      if (active.length <= budget) {
        rows = [...active, ...todos.filter((todo) => todo.status === 'completed')].slice(0, budget)
        hiddenCompleted = totalCompleted - (rows.length - active.length)
      } else {
        rows = active.slice(0, budget)
        truncatedPending = active.length - budget
        hiddenCompleted = totalCompleted
      }
    }

    rows.forEach((todo, index) => {
      const last = index === rows.length - 1 && hiddenCompleted === 0 && truncatedPending === 0
      lines.push(
        truncate(`${theme.fg('dim', last ? '└─' : '├─')} ${this.renderTodo(todo, theme, showIds)}`),
      )
    })

    for (const todo of rows) {
      if (
        todo.status === 'completed' &&
        !this.completedIdsPendingHide.has(todo.id) &&
        !this.hiddenCompletedIds.has(todo.id)
      ) {
        this.completedIdsPendingHide.add(todo.id)
      }
    }

    const hiddenTotal = hiddenCompleted + truncatedPending
    if (hiddenTotal > 0) {
      const parts: string[] = []
      if (hiddenCompleted > 0) {
        parts.push(`${hiddenCompleted} completed`)
      }
      if (truncatedPending > 0) {
        parts.push(`${truncatedPending} pending`)
      }
      lines.push(
        truncate(
          `${theme.fg('dim', '└─')} ${theme.fg('dim', `+${hiddenTotal} more (${parts.join(', ')})`)}`,
        ),
      )
    }

    lines.push('')
    return lines
  }

  private renderTodo(todo: Todo, theme: Theme, showId: boolean): string {
    const glyph =
      todo.status === 'in_progress'
        ? theme.fg('warning', '◐')
        : todo.status === 'completed'
          ? theme.fg('success', '✓')
          : todo.status === 'blocked'
            ? theme.fg('muted', '⊘')
            : theme.fg('dim', '○')
    const subjectColor =
      todo.status === 'in_progress'
        ? 'accent'
        : todo.status === 'completed' || todo.status === 'blocked'
          ? 'muted'
          : 'text'
    let subject = theme.fg(subjectColor, sanitizeTerminalText(todo.content))
    if (todo.status === 'completed') {
      subject = theme.strikethrough(subject)
    }
    let line = glyph
    if (showId) {
      line += ` ${theme.fg('dim', `#${sanitizeTerminalText(todo.id)}`)}`
    }
    line += ` ${subject}`
    if (todo.status === 'blocked' && todo.blocker !== undefined) {
      line += ` ${theme.fg('dim', `(${sanitizeTerminalText(todo.blocker)})`)}`
    }
    if (todo.dependencies.length > 0) {
      line += ` ${theme.fg(
        'muted',
        `⛓ ${todo.dependencies.map((id) => `#${sanitizeTerminalText(id)}`).join(',')}`,
      )}`
    }
    return line
  }
}
