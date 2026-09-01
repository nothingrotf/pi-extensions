import { closeSync, openSync, readSync, statSync } from 'node:fs'

import {
  Key,
  matchesKey,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { taskLine, type SubagentTheme } from './format.ts'
import type { SubagentSnapshot } from './runtime.ts'

const TAIL_BYTES = 64 * 1024
const POLL_MS = 700
const TAIL_ROWS = 18

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
        text: `${name}${shortenPath(clean(text))}`,
      })
    } else {
      output.push({ gutter: '·', kind: 'say', text: clean(text) })
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
    return `${theme.fg('accent', line.gutter)} ${theme.fg('toolTitle', name)}${argument.length > 0 ? ` ${theme.fg('muted', argument)}` : ''}`
  }
  if (line.kind === 'result') {
    return `${theme.fg('dim', line.gutter)} ${theme.fg('dim', line.text)}`
  }
  return `${theme.fg('dim', line.gutter)} ${line.text}`
}

function statusTag(status: string, theme: SubagentTheme): string {
  if (status === 'failed') return theme.fg('error', status)
  if (status === 'completed') return theme.fg('success', status)
  if (status === 'aborted') return theme.fg('warning', status)
  return theme.fg('muted', status)
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
): PeekPane {
  let selected = 0
  let selectedAgentId: string | undefined
  let tailing = false
  let confirmingAgentId: string | undefined
  let scrollback = 0
  let viewport = TAIL_ROWS
  let lastTotal = 0
  let lastWidth = 80
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

  const scrollBy = (rows: number) => {
    const snapshots = getSnapshots()
    const snapshot = syncSelection(snapshots)
    if (!tailing || snapshot?.sessionFile === undefined) return
    const total = physicalTail(snapshot.sessionFile, lastWidth).length
    lastTotal = total
    scrollback = Math.max(0, Math.min(Math.max(0, total - viewport), scrollback + rows))
  }

  const row = (content: string, width: number): string => {
    const inner = width - 4
    const text = truncateToWidth(content, Math.max(0, inner), '…')
    const padding = Math.max(0, inner - visibleWidth(text))
    const edge = theme.fg('border', '│')
    return theme.bg('selectedBg', `${edge} ${text}${' '.repeat(padding)} ${edge}`)
  }

  const edgeRow = (width: number, left: string, right: string): string =>
    theme.bg(
      'selectedBg',
      theme.fg('border', `${left}${'─'.repeat(Math.max(0, width - 2))}${right}`),
    )

  return {
    render(width: number): string[] {
      lastWidth = width
      const snapshots = getSnapshots()
      const snapshot = syncSelection(snapshots)
      if (snapshots.length === 0) {
        return [
          edgeRow(width, '╭', '╮'),
          row(theme.fg('dim', 'No subagents in this session.'), width),
          edgeRow(width, '╰', '╯'),
        ]
      }
      if (snapshot === undefined) return []
      const hint =
        confirmingAgentId !== undefined
          ? theme.fg('error', `abort ${snapshot.description}?  y / n`)
          : theme.fg(
              'dim',
              tailing
                ? '↑↓ / jk scroll · ⇧ page · g/G top·live · esc back · x abort'
                : 'shift+↑↓ / jk move · enter tail · x abort · esc close',
            )
      const crumb = tailing
        ? `${theme.fg('muted', 'Subagents')}${theme.fg('dim', ' › ')}${theme.fg('accent', theme.bold(snapshot.description))} ${statusTag(snapshot.status, theme)}`
        : theme.fg('accent', theme.bold('Subagents'))
      const title = `${crumb} ${theme.fg('muted', `${selected + 1}/${snapshots.length}`)}`
      const lines = [
        edgeRow(width, '╭', '╮'),
        row(title, width),
        row(hint, width),
        edgeRow(width, '├', '┤'),
      ]

      if (!tailing) {
        for (const [index, item] of snapshots.entries()) {
          const marker = index === selected ? theme.fg('accent', '❯ ') : '  '
          lines.push(row(`${marker}${taskLine(item)}`, width))
        }
      } else {
        const tail = physicalTail(snapshot.sessionFile, width)
        viewport = TAIL_ROWS
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
        if (scrollback > 0) {
          lines.push(edgeRow(width, '├', '┤'))
          lines.push(row(theme.fg('warning', `↑ ${scrollback} older · G / end → live`), width))
        }
      }
      lines.push(edgeRow(width, '╰', '╯'))
      return lines
    },
    handleInput(data: string): void {
      const snapshots = getSnapshots()
      const snapshot = syncSelection(snapshots)
      if (confirmingAgentId !== undefined) {
        const target = snapshots.find((item) => item.agentId === confirmingAgentId)
        confirmingAgentId = undefined
        if ((data === 'y' || data === 'Y') && target !== undefined) abort(target)
        requestRender()
        return
      }
      if (data === 'x' || data === 'X') {
        if (snapshot?.running === true) confirmingAgentId = snapshot.agentId
      } else if (matchesKey(data, Key.escape)) {
        if (tailing) {
          tailing = false
          scrollback = 0
        } else {
          close()
        }
      } else if (matchesKey(data, Key.enter) || matchesKey(data, Key.right)) {
        tailing = true
        scrollback = 0
      } else if (matchesKey(data, Key.left)) {
        tailing = false
        scrollback = 0
      } else if (matchesKey(data, Key.pageUp)) {
        scrollBy(viewport)
      } else if (matchesKey(data, Key.pageDown)) {
        scrollBy(-viewport)
      } else if (data === 'g') {
        scrollBy(Number.MAX_SAFE_INTEGER)
      } else if (data === 'G' || matchesKey(data, Key.end)) {
        scrollback = 0
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
