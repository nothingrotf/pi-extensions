import type { Theme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, truncateToWidth, type Component } from '@earendil-works/pi-tui'

import type { SubagentSnapshot } from './runtime.ts'
import type { RunStatus, RunUsage } from './schema.ts'

export type SubagentTheme = Pick<Theme, 'bg' | 'bold' | 'fg'>

export function oneLineLabel(text: string, maxLength = 160): string {
  const visible = Array.from(stripTerminalSequences(text))
    .map((character) => {
      const code = character.codePointAt(0) ?? 0
      if (code < 32 || (code >= 127 && code <= 159)) return ' '
      if (code === 0x061c) return ''
      if (code >= 0xd800 && code <= 0xdfff) return ''
      if (code >= 0x200b && code <= 0x200f) return ''
      if (code >= 0x202a && code <= 0x202e) return ''
      if (code >= 0x2060 && code <= 0x206f) return ''
      return code === 0xfeff ? '' : character
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const characters = Array.from(visible)
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('')}…` : visible
}

export interface ToolActivityArguments {
  command?: string
  file_path?: string
  filePath?: string
  name?: string
  path?: string
  pattern?: string
  query?: string
  subject?: string
  task?: string
  url?: string
}

export function describeCall(toolName: string, args: ToolActivityArguments, cwd: string): string {
  const verb = toolName.charAt(0).toUpperCase() + toolName.slice(1)
  const value =
    args.pattern ??
    args.query ??
    args.command ??
    args.path ??
    args.file_path ??
    args.filePath ??
    args.url ??
    args.name ??
    args.subject ??
    args.task
  if (value === undefined) return verb
  let text = oneLineLabel(value, 61)
  if (text.startsWith(`${cwd}/`)) text = text.slice(cwd.length + 1)
  return `${verb} ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`
}

export function activitySnippet(text: string): string {
  return oneLineLabel(text, 90)
}

function formatTokens(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value)
}

export function formatUsage(usage: RunUsage): string {
  const parts: string[] = []
  if (usage.turns > 0) parts.push(`${usage.turns} turn${usage.turns === 1 ? '' : 's'}`)
  if (usage.input > 0) parts.push(`↑ ${formatTokens(usage.input)}`)
  if (usage.output > 0) parts.push(`↓ ${formatTokens(usage.output)}`)
  if (usage.cost > 0) parts.push(usage.cost >= 0.0001 ? `$${usage.cost.toFixed(4)}` : '$<0.0001')
  return parts.join(' · ')
}

export function statusIcon(status: RunStatus): string {
  if (status === 'completed') return '✓'
  if (status === 'failed') return '✗'
  if (status === 'aborted') return '⏹'
  return '•'
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`
}

function taskDuration(snapshot: SubagentSnapshot): string {
  const end = snapshot.endedAt ?? Date.now()
  const duration = formatDuration(end - snapshot.startedAt)
  return snapshot.running ? `running ${duration}` : duration
}

function taskStats(snapshot: SubagentSnapshot): string {
  const usage = formatUsage(snapshot.usage)
  const intercom = formatUsage(snapshot.intercomUsage)
  return [
    `${snapshot.usage.toolCalls} tools${usage.length > 0 ? ` · ${usage}` : ''}`,
    intercom.length > 0 ? `parent ↔ ${intercom}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}

export function taskLine(snapshot: SubagentSnapshot): string {
  return `${statusIcon(snapshot.status)} ${oneLineLabel(snapshot.description)} · ${taskStats(snapshot)} · ${taskDuration(snapshot)}`
}

function colorNumbers(text: string, theme: SubagentTheme): string {
  return text.replace(
    /((?:\d+(?:\.\d+)?[a-zA-Z]*)+)|([^\d]+)/g,
    (_match, number?: string, rest?: string) =>
      number === undefined ? theme.fg('muted', rest ?? '') : theme.fg('syntaxNumber', number),
  )
}

function themedTaskLine(snapshot: SubagentSnapshot, theme: SubagentTheme): string {
  const tail = `${taskStats(snapshot)} · ${taskDuration(snapshot)}`
  if (!snapshot.running) {
    return theme.fg(
      'dim',
      `${statusIcon(snapshot.status)} ${oneLineLabel(snapshot.description)} · ${tail}`,
    )
  }
  const activity =
    snapshot.lastActivity === undefined ? '' : `${theme.fg('dim', `→ ${snapshot.lastActivity}`)} · `
  return `${theme.fg('accent', statusIcon(snapshot.status))} ${theme.fg('accent', theme.bold(oneLineLabel(snapshot.description)))} · ${activity}${colorNumbers(tail, theme)}`
}

const WIDGET_MAX_LINES = 10

export class SubagentsWidget implements Component {
  constructor(
    private readonly getSnapshots: () => SubagentSnapshot[],
    private readonly theme: SubagentTheme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const snapshots = this.getSnapshots()
    if (snapshots.length === 0) return []
    const done = snapshots.filter((snapshot) => !snapshot.running).length
    const live = snapshots.length - done
    const head = live > 0 ? 'accent' : 'dim'
    const lines = [
      truncateToWidth(
        `${this.theme.bold(this.theme.fg(head, 'Subagents'))} ${this.theme.fg('dim', `${done}/${snapshots.length}`)}`,
        width,
        '…',
      ),
    ]
    const budget = WIDGET_MAX_LINES - 1
    const shown = Math.min(snapshots.length, budget)
    for (let index = 0; index < shown; index += 1) {
      const snapshot = snapshots[index]
      if (snapshot === undefined) continue
      lines.push(
        truncateToWidth(
          ` ${this.theme.fg('dim', index === shown - 1 && shown === snapshots.length ? '└─' : '├─')} ${themedTaskLine(snapshot, this.theme)}`,
          width,
          '…',
        ),
      )
    }
    const hidden = snapshots.length - shown
    if (hidden > 0) {
      lines.push(` ${this.theme.fg('dim', '└─')} ${this.theme.fg('dim', `+${hidden} more`)}`)
    }
    return lines
  }
}
