import { closeSync, openSync, readSync, statSync } from 'node:fs'

import {
  Input,
  Key,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { formatUsage, oneLineLabel, statusIcon, type SubagentTheme } from './format.ts'
import type { SubagentSnapshot } from './runtime.ts'

const TAIL_BYTES = 64 * 1024
const POLL_MS = 700
const TAIL_ROWS = 18

export function peekHeight(rows: number): number {
  return Math.max(1, Math.min(rows - 2, Math.floor(rows * 0.85)))
}

const MessageSchema = Type.Object(
  {
    content: Type.Array(Type.Unknown()),
    isError: Type.Optional(Type.Boolean()),
    role: Type.String(),
    toolName: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const EntrySchema = Type.Object(
  { message: Type.Optional(MessageSchema) },
  { additionalProperties: true },
)

const ToolCallSchema = Type.Object(
  {
    arguments: Type.Optional(Type.Unknown()),
    name: Type.String(),
    type: Type.Literal('toolCall'),
  },
  { additionalProperties: true },
)

const TextBlockSchema = Type.Object(
  { text: Type.String(), type: Type.Literal('text') },
  { additionalProperties: true },
)

const ArgumentSchema = Type.Object(
  {
    command: Type.Optional(Type.String()),
    file: Type.Optional(Type.String()),
    filePath: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    pattern: Type.Optional(Type.String()),
    query: Type.Optional(Type.String()),
    subject: Type.Optional(Type.String()),
    task: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

function readTail(path: string): string {
  const descriptor = openSync(path, 'r')
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(descriptor, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    if (start === 0) return text
    const previous = Buffer.alloc(1)
    readSync(descriptor, previous, 0, 1, start - 1)
    if (previous[0] === 0x0a) return text
    const firstCompleteEntry = text.indexOf('\n')
    return firstCompleteEntry < 0 ? '' : text.slice(firstCompleteEntry + 1)
  } finally {
    closeSync(descriptor)
  }
}

function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, ' ')
    .replace(/<\/?(?:think|thinking|reasoning)>/g, ' ')
    .trim()
}

function removeControlCharacters(text: string): string {
  return Array.from(stripTerminalSequences(text))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      return code >= 32 && code !== 127 ? character : ' '
    })
    .join('')
}

function clean(text: string): string {
  return removeControlCharacters(text).replace(/\s+/g, ' ').trim()
}

function cleanBody(text: string): string {
  return text
    .split('\n')
    .map((line) => removeControlCharacters(line).trimEnd())
    .join('\n')
    .trim()
}

function shortenPath(text: string): string {
  return text.replace(/(?:\/[\w.@+-]+){3,}/g, (path) => {
    const parts = path.split('/').filter(Boolean)
    return parts.length <= 3 ? path : `…/${parts.slice(-3).join('/')}`
  })
}

function callSummary(args: Static<typeof ArgumentSchema>): string {
  return (
    args.path ??
    args.file ??
    args.filePath ??
    args.command ??
    args.pattern ??
    args.query ??
    args.url ??
    args.task ??
    args.subject ??
    ''
  )
}

export type PeekLine = {
  gutter: string
  kind: 'call' | 'error' | 'result' | 'say'
  text: string
}

export function eventLines(raw: string): PeekLine[] {
  let input: unknown
  try {
    input = JSON.parse(raw)
  } catch {
    return []
  }
  let entry: Static<typeof EntrySchema>
  try {
    entry = Value.Decode(EntrySchema, input)
  } catch {
    return []
  }
  const message = entry.message
  if (message === undefined) return []
  const output: PeekLine[] = []
  const isResult = message.role === 'toolResult'
  for (const block of message.content) {
    if (Value.Check(ToolCallSchema, block)) {
      const decoded = Value.Decode(ToolCallSchema, block)
      const argument = Value.Check(ArgumentSchema, decoded.arguments)
        ? callSummary(Value.Decode(ArgumentSchema, decoded.arguments))
        : ''
      output.push({
        gutter: '→',
        kind: 'call',
        text: `${decoded.name}${argument.length > 0 ? ` ${shortenPath(clean(argument))}` : ''}`,
      })
      continue
    }
    if (!Value.Check(TextBlockSchema, block)) continue
    const decoded = Value.Decode(TextBlockSchema, block)
    const text = stripThinking(decoded.text)
    if (text.length === 0) continue
    if (isResult) {
      const kind = message.isError === true ? 'error' : 'result'
      const name = message.toolName === undefined ? '' : `${message.toolName}: `
      output.push({
        gutter: message.isError === true ? '✗' : '←',
        kind,
        text: `${name}${cleanBody(text)}`,
      })
    } else {
      output.push({ gutter: '·', kind: 'say', text: cleanBody(text) })
    }
  }
  return output
}

function tailLines(path: string): PeekLine[] {
  let text: string
  try {
    text = readTail(path)
  } catch {
    return [{ gutter: '·', kind: 'say', text: '(session file not readable yet)' }]
  }
  return text.split('\n').flatMap(eventLines)
}

function renderLine(line: PeekLine, theme: SubagentTheme): string {
  if (line.kind === 'error') {
    return `${theme.fg('error', line.gutter)} ${theme.fg('error', line.text)}`
  }
  if (line.kind === 'call') {
    const space = line.text.indexOf(' ')
    const name = space === -1 ? line.text : line.text.slice(0, space)
    const argument = space === -1 ? '' : line.text.slice(space + 1)
    return `${theme.fg('accent', line.gutter)} ${theme.fg('toolTitle', name)}${argument.length > 0 ? ` ${theme.fg('text', argument)}` : ''}`
  }
  if (line.kind === 'result') {
    return `${theme.fg('muted', line.gutter)} ${theme.fg('toolOutput', line.text)}`
  }
  return `${theme.fg('muted', line.gutter)} ${theme.fg('text', line.text)}`
}

function statusTag(status: string, theme: SubagentTheme, label = status): string {
  if (status === 'failed') return theme.fg('error', label)
  if (status === 'completed') return theme.fg('success', label)
  if (status === 'aborted') return theme.fg('warning', label)
  return theme.fg('accent', label)
}

export interface PeekPane {
  dispose(): void
  handleInput(data: string): void
  invalidate(): void
  render(width: number): string[]
}

export function createPeekPane(
  getSnapshots: () => SubagentSnapshot[],
  theme: SubagentTheme,
  requestRender: () => void,
  close: () => void,
  abort: (snapshot: SubagentSnapshot) => void,
  getHeight: () => number = () => 28,
): PeekPane {
  let selected = 0
  let selectedAgentId: string | undefined
  let tailing = false
  let confirmingAgentId: string | undefined
  let scrollback = 0
  let viewport = TAIL_ROWS
  let lastTotal = 0
  let lastWidth = 80
  let listStart = 0
  let listPage = TAIL_ROWS
  let searching = false
  let activeOnly = false
  const search = new Input()
  const filteredSnapshots = () => {
    const query = search.getValue().toLocaleLowerCase().trim()
    return getSnapshots().filter(
      (item) =>
        (!activeOnly || item.running) &&
        `${item.description} ${item.agentId} ${item.model} ${item.status}`
          .toLocaleLowerCase()
          .includes(query),
    )
  }
  const timer = setInterval(requestRender, POLL_MS)

  const clamp = (value: number, length: number) =>
    length === 0 ? 0 : Math.max(0, Math.min(length - 1, value))

  const syncSelection = (snapshots: SubagentSnapshot[]): SubagentSnapshot | undefined => {
    if (selectedAgentId !== undefined) {
      const matched = snapshots.findIndex((snapshot) => snapshot.agentId === selectedAgentId)
      if (matched >= 0) selected = matched
    }
    selected = clamp(selected, snapshots.length)
    const snapshot = snapshots[selected]
    selectedAgentId = snapshot?.agentId
    return snapshot
  }

  const physicalTail = (path: string, width: number): string[] =>
    tailLines(path).flatMap((line) =>
      wrapTextWithAnsi(renderLine(line, theme), Math.max(1, width - 4)),
    )

  const physicalContent = (snapshot: SubagentSnapshot, width: number): string[] => {
    const details = [
      theme.fg('text', theme.bold(oneLineLabel(snapshot.description, Infinity))),
      `${statusTag(snapshot.status, theme)} · ${theme.fg('muted', oneLineLabel(snapshot.model, Infinity))}`,
      theme.fg('muted', `${snapshot.usage.toolCalls} tools · ${formatUsage(snapshot.usage)}`),
      '',
    ].flatMap((line) => wrapTextWithAnsi(line, Math.max(1, width - 4)))
    return [...details, ...physicalTail(snapshot.sessionFile, width)]
  }

  const scrollBy = (rows: number) => {
    const snapshots = filteredSnapshots()
    const snapshot = syncSelection(snapshots)
    if (!tailing || snapshot?.sessionFile === undefined) return
    viewport = Math.max(1, Math.floor(getHeight()) - 7)
    const total = physicalContent(snapshot, lastWidth).length
    lastTotal = total
    scrollback = Math.max(0, Math.min(Math.max(0, total - viewport), scrollback + rows))
  }

  const move = (value: number, snapshots: SubagentSnapshot[]) => {
    selected = clamp(value, snapshots.length)
    selectedAgentId = snapshots[selected]?.agentId
  }

  const row = (content: string, width: number, highlighted = false): string => {
    const inner = Math.max(0, width - 4)
    const text = truncateToWidth(content, Math.max(0, inner), '…')
    const padding = Math.max(0, inner - visibleWidth(text))
    const edge = theme.fg('border', '│')
    const body = `${edge} ${text}${' '.repeat(padding)} ${edge}`
    return highlighted ? theme.bg('selectedBg', body) : `\u001b[49m${body}`
  }

  const edgeRow = (width: number, left: string, right: string): string =>
    `\u001b[49m${theme.fg('borderAccent', `${left}${'─'.repeat(Math.max(0, width - 2))}${right}`)}`

  return {
    render(width: number): string[] {
      lastWidth = width
      const height = Math.max(1, Math.floor(getHeight()))
      if (width < 8 || height < 9) {
        return [truncateToWidth(theme.fg('muted', 'Enlarge terminal · Esc close'), width, '')]
      }
      const snapshots = filteredSnapshots()
      const snapshot = syncSelection(snapshots)
      const hint =
        confirmingAgentId !== undefined
          ? theme.fg(
              'error',
              `abort ${oneLineLabel(snapshot?.description ?? '', Infinity)}?  y / n`,
            )
          : theme.fg(
              'muted',
              tailing
                ? '↑↓/jk scroll · PgUp/PgDn · g/G top/live · Esc back'
                : '↑↓/jk move · Enter open · / search · Tab filter · Esc close',
            )
      const crumb = theme.fg('accent', theme.bold(tailing ? 'Subagents › Activity' : 'Subagents'))
      const title = `${crumb} ${theme.fg('text', `${snapshots.length === 0 ? 0 : selected + 1}/${snapshots.length}`)}  ${theme.fg('muted', tailing ? oneLineLabel(snapshot?.description ?? '', Infinity) : activeOnly ? 'Active' : 'All')}`
      const lines = [
        edgeRow(width, '╭', '╮'),
        row(title, width),
        row(searching ? (search.render(Math.max(1, width - 4))[0] ?? '') : hint, width),
        edgeRow(width, '├', '┤'),
      ]

      if (!tailing || snapshot === undefined) {
        listPage = Math.max(1, height - 8)
        listStart = Math.max(0, Math.min(listStart, snapshots.length - listPage))
        if (selected < listStart) listStart = selected
        if (selected >= listStart + listPage) listStart = selected - listPage + 1
        const window = snapshots.slice(listStart, listStart + listPage)
        for (const [offset, item] of window.entries()) {
          const highlighted = listStart + offset === selected
          const marker = highlighted ? theme.fg('accent', '❯ ') : '  '
          const status = statusTag(item.status, theme)
          const labelWidth = Math.max(1, width - 9 - visibleWidth(item.status))
          const label = truncateToWidth(oneLineLabel(item.description, Infinity), labelWidth, '…')
          const padded = label + ' '.repeat(Math.max(0, labelWidth - visibleWidth(label)))
          lines.push(
            row(
              `${marker}${statusTag(item.status, theme, statusIcon(item.status))} ${theme.fg('text', highlighted ? theme.bold(padded) : padded)} ${status}`,
              width,
              highlighted,
            ),
          )
        }
        if (window.length === 0)
          lines.push(row(theme.fg('muted', 'No matching subagents. / search · Tab all'), width))
        lines.push(edgeRow(width, '├', '┤'))
        const summary =
          snapshot === undefined
            ? 'Change the search or filter to show agents.'
            : `${snapshot.usage.toolCalls} tools · ${formatUsage(snapshot.usage)}`
        lines.push(row(theme.fg('muted', summary), width))
        lines.push(
          row(
            theme.fg(
              'muted',
              `${window.length === 0 ? 0 : listStart + 1}-${listStart + window.length} of ${snapshots.length} · PgUp/PgDn · g/G first/last${snapshot?.running ? ' · x abort' : ''}${search.getValue() ? ` · Search: ${search.getValue()}` : ''}`,
            ),
            width,
          ),
        )
      } else {
        const tail = physicalContent(snapshot, width)
        viewport = Math.max(1, height - 7)
        if (scrollback > 0 && lastTotal > 0 && tail.length > lastTotal) {
          scrollback += tail.length - lastTotal
        }
        lastTotal = tail.length
        scrollback = Math.max(0, Math.min(Math.max(0, tail.length - viewport), scrollback))
        const end = tail.length - scrollback
        const window = tail.slice(Math.max(0, end - viewport), end)
        if (window.length === 0) {
          lines.push(row(theme.fg('dim', '(no activity yet)'), width))
        }
        for (const line of window) lines.push(row(line, width))
        lines.push(edgeRow(width, '├', '┤'))
        lines.push(
          row(
            theme.fg(
              scrollback > 0 ? 'warning' : 'muted',
              `${scrollback > 0 ? `↑ ${scrollback} rows below · G / end → live` : snapshot.running ? 'Live · follows new activity' : 'End of activity'}${snapshot.running ? ' · x abort' : ''} · recent 64 KiB`,
            ),
            width,
          ),
        )
      }
      lines.push(edgeRow(width, '╰', '╯'))
      return lines
    },
    handleInput(data: string): void {
      if (searching) {
        if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) searching = false
        else search.handleInput(data)
        selected = 0
        selectedAgentId = undefined
        listStart = 0
        requestRender()
        return
      }
      const snapshots = filteredSnapshots()
      const snapshot = syncSelection(snapshots)
      if (confirmingAgentId !== undefined) {
        const target = snapshots.find((item) => item.agentId === confirmingAgentId)
        confirmingAgentId = undefined
        if ((data === 'y' || data === 'Y') && target !== undefined) abort(target)
        requestRender()
        return
      }
      if (data === '/' && !tailing) {
        searching = true
      } else if (matchesKey(data, Key.tab) && !tailing) {
        activeOnly = !activeOnly
        move(0, filteredSnapshots())
      } else if (data === 'x' || data === 'X') {
        if (snapshot?.running === true) confirmingAgentId = snapshot.agentId
      } else if (matchesKey(data, Key.escape)) {
        if (tailing) {
          tailing = false
          scrollback = 0
        } else {
          close()
        }
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
      } else if (matchesKey(data, 'shift+up') || matchesKey(data, Key.up) || data === 'k') {
        if (tailing) scrollBy(1)
        else {
          selected = clamp(selected - 1, snapshots.length)
          selectedAgentId = snapshots[selected]?.agentId
        }
      } else if (matchesKey(data, 'shift+down') || matchesKey(data, Key.down) || data === 'j') {
        if (tailing) scrollBy(-1)
        else {
          selected = clamp(selected + 1, snapshots.length)
          selectedAgentId = snapshots[selected]?.agentId
        }
      }
      requestRender()
    },
    invalidate(): void {},
    dispose(): void {
      clearInterval(timer)
    },
  }
}
