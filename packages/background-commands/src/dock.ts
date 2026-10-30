import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { elapsed, isActive, lastLogLine, oneLine, runTime, statusStyle } from './format.ts'
import { isTerminal, type CommandOutput, type CommandSnapshot } from './schema.ts'

export type PanelTheme = Pick<Theme, 'bg' | 'bold' | 'fg'>

export interface CommandsView {
  list(): CommandSnapshot[]
  output(id: string): CommandOutput | undefined
}

export const SETTLE_LINGER_MS = 1_400
export const PEEK_SHORTCUT = 'ctrl+shift+b'

const visibleLimit = 5
const BRANCH = '├─'
const LAST = '╰─'

export function newestFirst(snapshots: readonly CommandSnapshot[]): CommandSnapshot[] {
  return [...snapshots].sort((left, right) => right.startedAt - left.startedAt)
}

export function dockSnapshots(
  snapshots: readonly CommandSnapshot[],
  now: number,
): CommandSnapshot[] {
  return newestFirst(
    snapshots.filter(
      (snapshot) => !isTerminal(snapshot) || now - snapshot.finishedAt < SETTLE_LINGER_MS,
    ),
  )
}

function dockInset(width: number): number {
  return Math.min(3, Math.max(0, Math.floor((width - 1) / 2)))
}

function commandRow(
  snapshot: CommandSnapshot,
  output: CommandOutput | undefined,
  connector: string,
  theme: PanelTheme,
  width: number,
  now: number,
): string {
  const style = statusStyle(snapshot)
  const active = isActive(snapshot)
  const name = oneLine(snapshot.name)
  const detail = lastLogLine(output?.text ?? '') || `$ ${oneLine(snapshot.command)}`
  const parts = [
    active ? theme.bold(theme.fg('text', name)) : theme.fg('muted', name),
    snapshot.status === 'running' ? '' : theme.fg(style.tone, style.label),
    theme.fg('dim', elapsed(runTime(snapshot, now))),
    width >= 56 ? theme.fg('dim', detail) : '',
  ].filter((part) => part.length > 0)
  const prefix = `${theme.fg('dim', `${connector} `)}${theme.fg(style.tone, style.glyph)} `
  return truncateToWidth(`${prefix}${parts.join('  ')}`, width, '…')
}

function panelTone(snapshots: readonly CommandSnapshot[]): ThemeColor {
  if (snapshots.some((snapshot) => snapshot.status === 'error')) return 'error'
  if (snapshots.some((snapshot) => snapshot.status === 'running')) return 'accent'
  if (snapshots.some((snapshot) => snapshot.status === 'stopping')) return 'warning'
  return 'success'
}

function columns(left: string, right: string, width: number): string {
  const clippedLeft = truncateToWidth(left, width, '…')
  const rightWidth = Math.max(0, width - visibleWidth(clippedLeft) - 2)
  const clippedRight = truncateToWidth(right, rightWidth, '')
  if (clippedRight.length === 0) return clippedLeft
  const gap = width - visibleWidth(clippedLeft) - visibleWidth(clippedRight)
  return `${clippedLeft}${' '.repeat(Math.max(0, gap))}${clippedRight}`
}

export function renderCommandsDock(
  view: CommandsView,
  theme: PanelTheme,
  width: number,
  now: number,
): string[] {
  const snapshots = dockSnapshots(view.list(), now)
  if (snapshots.length === 0) return []
  const safeWidth = Math.max(1, Math.floor(width))
  const inset = dockInset(safeWidth)
  const inner = safeWidth - inset * 2
  const outer = ' '.repeat(inset)
  const visible = snapshots.slice(0, visibleLimit)
  const hidden = snapshots.length - visible.length
  const rows = visible.map((snapshot, index) =>
    commandRow(
      snapshot,
      view.output(snapshot.id),
      index === visible.length - 1 && hidden === 0 ? LAST : BRANCH,
      theme,
      inner,
      now,
    ),
  )
  if (hidden > 0) rows.push(theme.fg('dim', `${LAST} +${hidden} more`))
  const active = snapshots.filter(isActive)
  const right =
    active.length > 0
      ? elapsed(now - Math.min(...active.map((snapshot) => snapshot.startedAt)))
      : ''
  const title = theme.bold(theme.fg(panelTone(snapshots), `⚙ bg · ${snapshots.length} ▾`))
  const footer =
    active.length > 0
      ? columns(
          theme.fg('dim', '↯ logs and stop in the panel'),
          theme.fg('dim', PEEK_SHORTCUT),
          inner,
        )
      : truncateToWidth(theme.fg('dim', 'settled'), inner, '…')
  return [
    columns(title, theme.fg('dim', right), inner),
    ...rows.map((row) => truncateToWidth(row, inner, '…')),
    footer,
  ]
    .map((line) => `${outer}${line}`)
    .concat('')
}

export class CommandsDock implements Component {
  constructor(
    private readonly view: CommandsView,
    private readonly theme: PanelTheme,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return renderCommandsDock(this.view, this.theme, width, this.now())
  }
}
