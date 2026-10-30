import {
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import { newestFirst, type CommandsView, type PanelTheme } from './dock.ts'
import { elapsed, isActive, logLines, oneLine, runTime, statusStyle } from './format.ts'
import type { CommandOutput, CommandSnapshot } from './schema.ts'

const POLL_MS = 700

export function peekHeight(rows: number): number {
  return Math.max(1, Math.min(rows - 2, Math.floor(rows * 0.85)))
}

export interface CommandsPaneOptions {
  readonly view: CommandsView
  readonly theme: PanelTheme
  requestRender(): void
  close(): void
  stop(snapshot: CommandSnapshot): void
  height?(): number
  now?(): number
}

export interface CommandsPane {
  dispose(): void
  handleInput(data: string): void
  invalidate(): void
  render(width: number): string[]
}

interface LogCache {
  readonly id: string
  readonly text: string | undefined
  readonly width: number
  readonly lines: string[]
}

export function createCommandsPane(options: CommandsPaneOptions): CommandsPane {
  const { view, theme } = options
  const height = () => Math.max(1, Math.floor(options.height?.() ?? 28))
  const now = () => options.now?.() ?? Date.now()
  let selected = 0
  let selectedId: string | undefined
  let tailing = false
  let confirmingId: string | undefined
  let scrollback = 0
  let viewport = 1
  let lastTotal = 0
  let lastWidth = 80
  let listStart = 0
  let listPage = 1
  let searching = false
  let activeOnly = false
  let cache: LogCache | undefined
  const search = new Input()
  const timer = setInterval(() => options.requestRender(), POLL_MS)
  timer.unref?.()

  const filtered = () => {
    const query = search.getValue().toLocaleLowerCase().trim()
    return newestFirst(view.list()).filter(
      (item) =>
        (!activeOnly || isActive(item)) &&
        `${item.name} ${item.command} ${item.id} ${item.status}`
          .toLocaleLowerCase()
          .includes(query),
    )
  }

  const clamp = (value: number, length: number) =>
    length === 0 ? 0 : Math.max(0, Math.min(length - 1, value))

  const sync = (snapshots: CommandSnapshot[]): CommandSnapshot | undefined => {
    if (selectedId !== undefined) {
      const matched = snapshots.findIndex((snapshot) => snapshot.id === selectedId)
      if (matched >= 0) selected = matched
    }
    selected = clamp(selected, snapshots.length)
    const snapshot = snapshots[selected]
    selectedId = snapshot?.id
    return snapshot
  }

  const move = (value: number, snapshots: CommandSnapshot[]) => {
    selected = clamp(value, snapshots.length)
    selectedId = snapshots[selected]?.id
  }

  const wrap = (line: string, width: number) => wrapTextWithAnsi(line, Math.max(1, width - 4))

  const outputLines = (
    snapshot: CommandSnapshot,
    output: CommandOutput | undefined,
    width: number,
  ): string[] => {
    if (cache?.id === snapshot.id && cache.text === output?.text && cache.width === width)
      return cache.lines
    const lines =
      output === undefined
        ? [theme.fg('dim', '(logs are no longer retained)')]
        : output.text.length === 0
          ? [theme.fg('dim', '(no output yet)')]
          : logLines(output.text).flatMap((line) =>
              wrap(line, width).map((part) => theme.fg('toolOutput', part)),
            )
    cache = { id: snapshot.id, text: output?.text, width, lines }
    return lines
  }

  const content = (snapshot: CommandSnapshot, width: number): string[] => {
    const style = statusStyle(snapshot)
    const output = view.output(snapshot.id)
    const header = [
      theme.bold(theme.fg('text', oneLine(snapshot.name))),
      `${theme.fg(style.tone, `${style.glyph} ${style.label}`)} ${theme.fg('muted', `· ${elapsed(runTime(snapshot, now()))}`)}`,
      theme.fg('muted', `$ ${oneLine(snapshot.command)}`),
      snapshot.status === 'error' ? theme.fg('error', oneLine(snapshot.errorMessage)) : '',
      theme.fg('dim', snapshot.id),
    ]
      .filter((line) => line.length > 0)
      .flatMap((line) => wrap(line, width))
    return [...header, '', ...outputLines(snapshot, output, width)]
  }

  const scrollBy = (rows: number) => {
    const snapshot = sync(filtered())
    if (!tailing || snapshot === undefined) return
    viewport = Math.max(1, height() - 7)
    const total = content(snapshot, lastWidth).length
    lastTotal = total
    scrollback = Math.max(0, Math.min(Math.max(0, total - viewport), scrollback + rows))
  }

  const row = (text: string, width: number, highlighted = false): string => {
    const inner = Math.max(0, width - 4)
    const clipped = truncateToWidth(text, inner, '…')
    const padding = Math.max(0, inner - visibleWidth(clipped))
    const edge = theme.fg('border', '│')
    const body = `${edge} ${clipped}${' '.repeat(padding)} ${edge}`
    return highlighted ? theme.bg('selectedBg', body) : `\u001b[49m${body}`
  }

  const edge = (width: number, left: string, right: string): string =>
    `\u001b[49m${theme.fg('borderAccent', `${left}${'─'.repeat(Math.max(0, width - 2))}${right}`)}`

  const listRows = (
    snapshots: CommandSnapshot[],
    snapshot: CommandSnapshot | undefined,
    width: number,
    rows: number,
  ): string[] => {
    listPage = Math.max(1, rows - 8)
    listStart = Math.max(0, Math.min(listStart, snapshots.length - listPage))
    if (selected < listStart) listStart = selected
    if (selected >= listStart + listPage) listStart = selected - listPage + 1
    const window = snapshots.slice(listStart, listStart + listPage)
    const lines = window.map((item, offset) => {
      const highlighted = listStart + offset === selected
      const style = statusStyle(item)
      const marker = highlighted ? theme.fg('accent', '❯ ') : '  '
      const right = `${theme.fg(style.tone, style.label)} ${theme.fg('dim', elapsed(runTime(item, now())))}`
      const labelWidth = Math.max(1, width - 9 - visibleWidth(right))
      const label = truncateToWidth(oneLine(item.name), labelWidth, '…')
      const padded = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)))
      return row(
        `${marker}${theme.fg(style.tone, style.glyph)} ${theme.fg('text', highlighted ? theme.bold(padded) : padded)} ${right}`,
        width,
        highlighted,
      )
    })
    if (window.length === 0)
      lines.push(row(theme.fg('muted', 'No matching commands. / search · Tab all'), width))
    lines.push(edge(width, '├', '┤'))
    lines.push(
      row(
        theme.fg(
          'muted',
          snapshot === undefined
            ? 'Change the search or filter to show commands.'
            : `$ ${oneLine(snapshot.command)}`,
        ),
        width,
      ),
    )
    const query = search.getValue()
    lines.push(
      row(
        theme.fg(
          'muted',
          `${window.length === 0 ? 0 : listStart + 1}-${listStart + window.length} of ${snapshots.length} · PgUp/PgDn · g/G first/last${snapshot?.status === 'running' ? ' · x stop' : ''}${query ? ` · Search: ${query}` : ''}`,
        ),
        width,
      ),
    )
    return lines
  }

  const tailRows = (snapshot: CommandSnapshot, width: number, rows: number): string[] => {
    const lines = content(snapshot, width)
    viewport = Math.max(1, rows - 7)
    if (scrollback > 0 && lastTotal > 0 && lines.length > lastTotal)
      scrollback += lines.length - lastTotal
    lastTotal = lines.length
    scrollback = Math.max(0, Math.min(Math.max(0, lines.length - viewport), scrollback))
    const end = lines.length - scrollback
    const window = lines.slice(Math.max(0, end - viewport), end).map((line) => row(line, width))
    const truncated = view.output(snapshot.id)?.truncated === true
    const position =
      scrollback > 0
        ? `↑ ${scrollback} rows below · G / end → live`
        : isActive(snapshot)
          ? 'Live · follows new output'
          : 'End of output'
    window.push(edge(width, '├', '┤'))
    window.push(
      row(
        theme.fg(
          scrollback > 0 ? 'warning' : 'muted',
          `${position}${snapshot.status === 'running' ? ' · x stop' : ''}${truncated ? ' · retained tail only' : ''}`,
        ),
        width,
      ),
    )
    return window
  }

  return {
    render(width: number): string[] {
      lastWidth = width
      const rows = height()
      if (width < 8 || rows < 9)
        return [truncateToWidth(theme.fg('muted', 'Enlarge terminal · Esc close'), width, '')]
      const snapshots = filtered()
      const snapshot = sync(snapshots)
      const hint =
        confirmingId !== undefined
          ? theme.fg('error', `stop ${oneLine(snapshot?.name ?? '')}?  y / n`)
          : theme.fg(
              'muted',
              tailing
                ? '↑↓/jk scroll · PgUp/PgDn · g/G top/live · Esc back'
                : '↑↓/jk move · Enter logs · / search · Tab filter · Esc close',
            )
      const crumb = theme.fg(
        'accent',
        theme.bold(tailing ? 'Background commands › Log' : 'Background commands'),
      )
      const scope = tailing ? oneLine(snapshot?.name ?? '') : activeOnly ? 'Active' : 'All'
      const title = `${crumb} ${theme.fg('text', `${snapshots.length === 0 ? 0 : selected + 1}/${snapshots.length}`)}  ${theme.fg('muted', scope)}`
      const lines = [
        edge(width, '╭', '╮'),
        row(title, width),
        row(searching ? (search.render(Math.max(1, width - 4))[0] ?? '') : hint, width),
        edge(width, '├', '┤'),
        ...(tailing && snapshot !== undefined
          ? tailRows(snapshot, width, rows)
          : listRows(snapshots, snapshot, width, rows)),
        edge(width, '╰', '╯'),
      ]
      return lines
    },
    handleInput(data: string): void {
      if (searching) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) searching = false
        else search.handleInput(data)
        selected = 0
        selectedId = undefined
        listStart = 0
        options.requestRender()
        return
      }
      const snapshots = filtered()
      const snapshot = sync(snapshots)
      if (confirmingId !== undefined) {
        const target = snapshots.find((item) => item.id === confirmingId)
        confirmingId = undefined
        if ((data === 'y' || data === 'Y') && target?.status === 'running') options.stop(target)
        options.requestRender()
        return
      }
      if (data === '/' && !tailing) {
        searching = true
      } else if (matchesKey(data, Key.tab) && !tailing) {
        activeOnly = !activeOnly
        move(0, filtered())
      } else if (data === 'x' || data === 'X') {
        if (snapshot?.status === 'running') confirmingId = snapshot.id
      } else if (matchesKey(data, Key.escape)) {
        if (tailing) {
          tailing = false
          scrollback = 0
        } else options.close()
      } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
        tailing = snapshot !== undefined
        scrollback = 0
      } else if (matchesKey(data, Key.left)) {
        tailing = false
        scrollback = 0
      } else if (matchesKey(data, Key.pageUp)) {
        if (tailing) scrollBy(viewport)
        else move(selected - listPage, snapshots)
      } else if (matchesKey(data, Key.pageDown)) {
        if (tailing) scrollBy(-viewport)
        else move(selected + listPage, snapshots)
      } else if (data === 'g' || matchesKey(data, Key.home)) {
        if (tailing) scrollBy(Number.MAX_SAFE_INTEGER)
        else move(0, snapshots)
      } else if (data === 'G' || matchesKey(data, Key.end)) {
        if (tailing) scrollback = 0
        else move(snapshots.length - 1, snapshots)
      } else if (matchesKey(data, Key.up) || data === 'k') {
        if (tailing) scrollBy(1)
        else move(selected - 1, snapshots)
      } else if (matchesKey(data, Key.down) || data === 'j') {
        if (tailing) scrollBy(-1)
        else move(selected + 1, snapshots)
      }
      options.requestRender()
    },
    invalidate(): void {
      cache = undefined
    },
    dispose(): void {
      clearInterval(timer)
    },
  }
}
