import type { ThemeColor } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'

import { isTerminal, type CommandSnapshot } from './schema.ts'

export interface StatusStyle {
  readonly glyph: string
  readonly tone: ThemeColor
  readonly label: string
}

export interface StatusState {
  readonly status: CommandSnapshot['status']
  readonly exitCode?: number | null
}

export function statusStyle(state: StatusState): StatusStyle {
  switch (state.status) {
    case 'running':
      return { glyph: '●', tone: 'accent', label: 'running' }
    case 'stopping':
      return { glyph: '◌', tone: 'warning', label: 'stopping' }
    case 'completed':
      return { glyph: '✓', tone: 'success', label: 'done' }
    case 'error':
      return {
        glyph: '✗',
        tone: 'error',
        label:
          state.exitCode === undefined || state.exitCode === null
            ? 'failed'
            : `exit ${state.exitCode}`,
      }
    case 'stopped':
      return { glyph: '■', tone: 'warning', label: 'stopped' }
  }
}

export function isActive(snapshot: CommandSnapshot): boolean {
  return !isTerminal(snapshot)
}

export function runTime(snapshot: CommandSnapshot, now: number): number {
  return (isTerminal(snapshot) ? snapshot.finishedAt : now) - snapshot.startedAt
}

export function elapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return seconds % 60 > 0 ? `${minutes}m${seconds % 60}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 > 0 ? `${hours}h${minutes % 60}m` : `${hours}h`
}

function visibleCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0
  if (code === 9) return '  '
  if (code < 32 || (code >= 127 && code <= 159)) return ' '
  if (code === 0x061c || code === 0xfeff) return ''
  if (code >= 0xd800 && code <= 0xdfff) return ''
  if (code >= 0x200b && code <= 0x200f) return ''
  if (code >= 0x202a && code <= 0x202e) return ''
  if (code >= 0x2060 && code <= 0x206f) return ''
  return character
}

function visibleText(text: string): string {
  return Array.from(stripTerminalSequences(text), visibleCharacter).join('')
}

export function oneLine(text: string): string {
  return visibleText(text).replace(/\s+/gu, ' ').trim()
}

function displayLine(raw: string): string {
  const segments = raw.split('\r')
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = visibleText(segments[index] ?? '').trimEnd()
    if (segment.trim().length > 0) return segment
  }
  return ''
}

export function logLines(text: string): string[] {
  const lines = text.split('\n').map(displayLine)
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines
}

export function lastLogLine(text: string): string {
  const lines = text.slice(-4096).split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = displayLine(lines[index] ?? '')
      .replace(/\s+/gu, ' ')
      .trim()
    if (line.length > 0) return line
  }
  return ''
}
