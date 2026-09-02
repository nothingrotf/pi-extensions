import type { Theme } from '@earendil-works/pi-coding-agent'
import { type Component, stripTerminalSequences, truncateToWidth } from '@earendil-works/pi-tui'

import type { SubagentSnapshot } from './runtime.ts'
import type { RunStatus, RunUsage } from './schema.ts'

export type SubagentTheme = Pick<Theme, 'bg' | 'bold' | 'fg' | 'getFgAnsi'>

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
    `${snapshot.usage.toolCalls} tool${snapshot.usage.toolCalls === 1 ? '' : 's'}${usage.length > 0 ? ` · ${usage}` : ''}`,
    intercom.length > 0 ? `parent ↔ ${intercom}` : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')
}

export function taskLine(snapshot: SubagentSnapshot): string {
  return `${statusIcon(snapshot.status)} ${oneLineLabel(snapshot.description)} · ${taskStats(snapshot)} · ${taskDuration(snapshot)}`
}

const WIDGET_VISIBLE_LIMIT = 8
const WIDGET_PREVIEW_WIDTH = 40

function widgetRow(snapshot: SubagentSnapshot, theme: SubagentTheme): string {
  const name = oneLineLabel(snapshot.description)
  const badge =
    snapshot.subagentType === 'task' ? '' : ` ${theme.fg('dim', `⟦${snapshot.subagentType}⟧`)}`
  let line = `${theme.fg('accent', '•')} ${theme.fg('accent', theme.bold(name))}${badge}`
  if (snapshot.lastActivity !== undefined) {
    line += ` ${theme.fg('muted', truncateToWidth(oneLineLabel(snapshot.lastActivity), WIDGET_PREVIEW_WIDTH, '…'))}`
  }
  return line
}

export function renderSubagentHudLines(
  snapshots: readonly SubagentSnapshot[],
  theme: SubagentTheme,
  width: number,
): string[] {
  const running = snapshots.filter((snapshot) => snapshot.running)
  if (running.length === 0) return []
  const visible = running.slice(0, WIDGET_VISIBLE_LIMIT)
  const hidden = running.length - visible.length
  const rows = visible.map(
    (snapshot, index) =>
      `${theme.fg('dim', index === visible.length - 1 ? '└─' : '├─')} ${widgetRow(snapshot, theme)}`,
  )
  if (hidden > 0) rows.push(theme.fg('dim', `… ${hidden} more running`))
  return [
    '',
    ` ${theme.bold(theme.fg('accent', 'Subagents'))}`,
    ...rows.map((row) => `  ${row}`),
  ].map((line) => truncateToWidth(line, width, '…'))
}

export class SubagentsWidget implements Component {
  constructor(
    private readonly getSnapshots: () => SubagentSnapshot[],
    private readonly theme: SubagentTheme,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return renderSubagentHudLines(this.getSnapshots(), this.theme, width)
  }
}
