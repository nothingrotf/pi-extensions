import { getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { type Component, Markdown, Text, truncateToWidth } from '@earendil-works/pi-tui'

import type { BatchItemResult } from './coordinator.ts'
import { oneLineLabel, type SubagentTheme, TREE_TAIL } from './format.ts'
import {
  type BadgeColor,
  formatBadge,
  formatJobDuration,
  formatMoreItems,
  type JobContext,
  type JobSnapshot,
} from './jobs.ts'
import type { RuntimeCompletedDetails, RuntimeFailedDetails } from './runtime.ts'
import { shimmerText } from './shimmer.ts'

export const TASK_ICON = '⇶'
const DOT = ' · '
const TOOL_ICON = '🛠'
const COLLAPSED_AGENT_LIMIT = 4
const OUTPUT_COLLAPSED = 3
const OUTPUT_EXPANDED = 10
const TASK_LINES_EXPANDED = 20
const BRIEF_WIDTH = 64
const LINE_WIDTH = 70

export type AgentRowStatus = 'aborted' | 'blocked' | 'completed' | 'failed' | 'pending' | 'running'

export interface AgentRow {
  activity: string | undefined
  agentType: string
  background: boolean
  context: JobContext | undefined
  cost: number
  durationMs: number | undefined
  error: string | undefined
  label: string
  output: string | undefined
  status: AgentRowStatus
  task: string | undefined
  toolCalls: number
}

export interface TaskRenderState {
  hasResult?: boolean
}

export interface TaskCallArgs {
  context?: string | undefined
  description?: string | undefined
  isolation?: unknown
  prompt?: string | undefined
  readonly?: boolean | undefined
  run_in_background?: boolean | undefined
  subagent_type?: string | undefined
  tasks?: readonly TaskCallItem[] | undefined
}

export interface TaskCallItem {
  description?: string | undefined
  id?: string | undefined
  isolation?: unknown
  prompt?: string | undefined
  subagent_type?: string | undefined
}

function trim1(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

export function formatCount(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 10_000) return `${trim1(value / 1_000)}K`
  if (value < 1_000_000) return `${Math.round(value / 1_000)}K`
  return `${trim1(value / 1_000_000)}M`
}

function firstLine(text: string | undefined): string {
  if (text === undefined) return ''
  const trimmed = text.trim()
  const newline = trimmed.indexOf('\n')
  return oneLineLabel(newline === -1 ? trimmed : trimmed.slice(0, newline), BRIEF_WIDTH)
}

export function agentTypeBadge(agentType: string | undefined, theme: SubagentTheme): string {
  const trimmed = agentType?.trim()
  if (trimmed === undefined || trimmed.length === 0 || trimmed === 'task') return ''
  return ` ${theme.fg('dim', `⟦${trimmed}⟧`)}`
}

export function renderStatusHeader(
  options: {
    description?: string | undefined
    icon: string
    meta?: readonly string[] | undefined
    title: string
  },
  theme: SubagentTheme,
): string {
  let line = `${options.icon} ${theme.fg('accent', options.title)}`
  if (options.description !== undefined && options.description.length > 0) {
    line += `: ${theme.fg('muted', options.description)}`
  }
  const meta = (options.meta ?? []).filter((part) => part.trim().length > 0)
  if (meta.length > 0) line += ` ${theme.fg('dim', meta.join(DOT))}`
  return line
}

function appendStats(line: string, row: AgentRow, theme: SubagentTheme): string {
  let result = line
  if (row.toolCalls > 0) {
    result += `${DOT}${theme.fg('dim', `${formatCount(row.toolCalls)} ${TOOL_ICON}`)}`
  }
  if (row.context !== undefined && row.context.percent !== null && row.context.percent > 0) {
    result += `${DOT}${theme.fg('dim', `${row.context.percent.toFixed(1)}%/${formatCount(row.context.window)}`)}`
  }
  if (row.cost > 0) result += `${DOT}${theme.fg('muted', `$${row.cost.toFixed(2)}`)}`
  return result
}

function statusBadge(row: AgentRow, theme: SubagentTheme): string {
  const badge = (label: string, color: BadgeColor): string => ` ${formatBadge(label, color, theme)}`
  switch (row.status) {
    case 'aborted':
      return badge('aborted', 'error')
    case 'blocked':
      return badge('blocked', 'muted')
    case 'completed':
      return badge('done', 'success')
    case 'failed':
      return badge('failed', 'error')
    default:
      return ''
  }
}

function rowTitle(row: AgentRow, live: boolean, theme: SubagentTheme): string {
  const label = oneLineLabel(row.label, BRIEF_WIDTH)
  if (row.status === 'running' || row.status === 'pending') {
    const name = live ? shimmerText(label, theme) : theme.fg('accent', theme.bold(label))
    return `${theme.fg('accent', '•')} ${name}`
  }
  if (row.status === 'completed')
    return `${theme.fg('text', '•')} ${theme.fg('text', theme.bold(label))}`
  const icon = row.status === 'aborted' ? '⏹' : row.status === 'blocked' ? '⦸' : '✘'
  const color = row.status === 'blocked' ? 'muted' : 'error'
  return `${theme.fg(color, icon)} ${theme.fg('accent', theme.bold(label))}`
}

function outputLines(
  text: string,
  expanded: boolean,
  theme: SubagentTheme,
  tone: 'dim' | 'error',
): string[] {
  const trimmed = text.trim()
  if (trimmed.length === 0) return []
  const lines = trimmed.split('\n')
  const count = expanded ? OUTPUT_EXPANDED : OUTPUT_COLLAPSED
  const result = [`  ${theme.fg('dim', 'Output')}`]
  for (const line of lines.slice(0, count)) {
    result.push(
      `    ${theme.fg(tone, truncateToWidth(oneLineLabel(line, LINE_WIDTH + 1), LINE_WIDTH, '…'))}`,
    )
  }
  if (lines.length > count) {
    result.push(`    ${theme.fg('dim', formatMoreItems(lines.length - count, 'line'))}`)
  }
  return result
}

function taskLines(task: string | undefined, expanded: boolean, theme: SubagentTheme): string[] {
  if (!expanded || task === undefined) return []
  const trimmed = task.trim()
  if (trimmed.length === 0) return []
  const lines = trimmed.split('\n')
  const result = [`  ${theme.fg('dim', 'Task')}`]
  for (const line of lines.slice(0, TASK_LINES_EXPANDED)) {
    result.push(
      `    ${theme.fg('dim', truncateToWidth(oneLineLabel(line, LINE_WIDTH + 1), LINE_WIDTH, '…'))}`,
    )
  }
  if (lines.length > TASK_LINES_EXPANDED) {
    result.push(
      `    ${theme.fg('dim', formatMoreItems(lines.length - TASK_LINES_EXPANDED, 'line'))}`,
    )
  }
  return result
}

export function renderAgentRow(
  row: AgentRow,
  options: { expanded: boolean; live: boolean },
  theme: SubagentTheme,
): string[] {
  let line = `${rowTitle(row, options.live && row.status === 'running', theme)}${agentTypeBadge(row.agentType, theme)}${statusBadge(row, theme)}`
  if (row.background && (row.status === 'pending' || row.status === 'running')) {
    line += ` ${formatBadge('background', 'dim', theme)}`
  }
  if (row.status === 'running' || row.status === 'completed') line = appendStats(line, row, theme)
  if (row.durationMs !== undefined && row.status !== 'pending' && row.status !== 'running') {
    line += `${DOT}${theme.fg('dim', formatJobDuration(row.durationMs))}`
  }
  const lines = [line, ...taskLines(row.task, options.expanded, theme)]
  if (row.status === 'running' && row.activity !== undefined) {
    lines.push(
      `  ${theme.fg('dim', TREE_TAIL)} ${theme.fg('muted', oneLineLabel(row.activity, LINE_WIDTH))}`,
    )
  }
  if (row.error !== undefined) {
    lines.push(`  ${theme.fg('error', '✘')} ${theme.fg('dim', oneLineLabel(row.error, 80))}`)
  } else if (row.output !== undefined && row.status !== 'running' && row.status !== 'pending') {
    lines.push(...outputLines(row.output, options.expanded, theme, 'dim'))
  }
  return lines
}

export function rowFromJob(job: JobSnapshot, background: boolean): AgentRow {
  return {
    activity: job.lastActivity,
    agentType: job.subagentType,
    background,
    context: job.context,
    cost: job.cost,
    durationMs: job.durationMs,
    error: undefined,
    label: job.description,
    output: undefined,
    status: job.status,
    task: undefined,
    toolCalls: job.toolCalls,
  }
}

export function rowFromCompleted(
  details: RuntimeCompletedDetails,
  label: string,
  agentType: string,
): AgentRow {
  return {
    activity: undefined,
    agentType,
    background: false,
    context: undefined,
    cost: details.usage.cost,
    durationMs: details.durationMs,
    error: undefined,
    label,
    output: details.finalMessage,
    status: 'completed',
    task: undefined,
    toolCalls: details.toolCallCount,
  }
}

export function rowFromFailed(
  details: RuntimeFailedDetails,
  label: string,
  agentType: string,
  aborted: boolean,
): AgentRow {
  return {
    activity: undefined,
    agentType,
    background: false,
    context: undefined,
    cost: 0,
    durationMs: undefined,
    error: details.error,
    label,
    output: details.finalMessage,
    status: aborted ? 'aborted' : 'failed',
    task: undefined,
    toolCalls: 0,
  }
}

export function rowFromBatchItem(
  item: BatchItemResult,
  job: JobSnapshot | undefined,
  agentType: string,
): AgentRow {
  const base: AgentRow =
    job === undefined
      ? {
          activity: undefined,
          agentType,
          background: false,
          context: undefined,
          cost: 0,
          durationMs: undefined,
          error: undefined,
          label: item.taskId,
          output: undefined,
          status: item.status,
          task: undefined,
          toolCalls: 0,
        }
      : rowFromJob(job, false)
  return { ...base, error: item.error, output: item.output, status: item.status }
}

function markdownLines(text: string | undefined, width: number, theme: SubagentTheme): string[] {
  const trimmed = text?.trim() ?? ''
  if (trimmed.length === 0) return []
  return new Markdown(trimmed, 0, 0, getMarkdownTheme(), {
    color: (line) => theme.fg('muted', line),
  }).render(Math.max(1, width))
}

function callRows(args: TaskCallArgs, theme: SubagentTheme): string[] {
  const bullet = theme.fg('dim', '•')
  const lines: string[] = []
  const items: TaskCallItem[] =
    args.tasks === undefined ? [{ ...args }] : args.tasks.map((item) => ({ ...item }))
  const cap = Math.min(items.length, COLLAPSED_AGENT_LIMIT)
  items.slice(0, cap).forEach((item, index) => {
    const label = item.description?.trim() || item.id?.trim() || `#${index + 1}`
    let line = `${bullet} ${theme.fg('accent', theme.bold(oneLineLabel(label, BRIEF_WIDTH)))}`
    const brief = firstLine(item.prompt)
    if (brief.length > 0) line += `: ${theme.fg('muted', brief)}`
    line += agentTypeBadge(item.subagent_type ?? args.subagent_type, theme)
    if (item.isolation !== undefined) line += theme.fg('dim', ' [isolated]')
    lines.push(line)
  })
  if (cap < items.length) {
    lines.push(`${bullet} ${theme.fg('dim', formatMoreItems(items.length - cap, 'agent'))}`)
  }
  return lines
}

export function taskCallHeader(args: TaskCallArgs, theme: SubagentTheme): string {
  const meta: string[] = []
  if (args.run_in_background === true) meta.push('background')
  if (args.readonly === true) meta.push('read-only')
  return renderStatusHeader(
    {
      description: args.tasks === undefined ? args.subagent_type : undefined,
      icon: theme.fg('accent', TASK_ICON),
      meta,
      title: 'Task',
    },
    theme,
  )
}

export class TaskCall implements Component {
  constructor(
    private readonly args: TaskCallArgs,
    private readonly theme: SubagentTheme,
    private readonly state: TaskRenderState,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = [taskCallHeader(this.args, this.theme)]
    const context = markdownLines(this.args.context, width, this.theme)
    const brief = markdownLines(this.args.prompt, width, this.theme)
    if (context.length > 0) lines.push('', ...context)
    if (brief.length > 0) lines.push('', ...brief)
    if (this.state.hasResult !== true) {
      const rows = callRows(this.args, this.theme)
      if (rows.length > 0) lines.push('', ...rows)
    }
    return lines.map((line) => truncateToWidth(line, width, '…'))
  }
}

export interface TaskResultOptions {
  expanded: boolean
  live: boolean
}

export function renderAgentRows(
  rows: readonly AgentRow[],
  options: TaskResultOptions,
  theme: SubagentTheme,
): string[] {
  const finished = rows.filter((row) => row.status !== 'pending' && row.status !== 'running')
  const unfinished = rows.filter((row) => row.status === 'pending' || row.status === 'running')
  const ordered = [...finished, ...unfinished]
  const visible = options.expanded
    ? ordered
    : ordered.slice(Math.max(0, ordered.length - COLLAPSED_AGENT_LIMIT))
  const lines: string[] = []
  if (visible.length < ordered.length) {
    lines.push(theme.fg('dim', formatMoreItems(ordered.length - visible.length, 'agent')))
  }
  for (const row of visible) lines.push(...renderAgentRow(row, options, theme))
  return lines
}

export function summaryLine(
  rows: readonly AgentRow[],
  durationMs: number,
  theme: SubagentTheme,
): string {
  const parts: string[] = []
  const count = (status: AgentRowStatus) => rows.filter((row) => row.status === status).length
  if (count('aborted') > 0) parts.push(theme.fg('error', `${count('aborted')} aborted`))
  if (count('completed') > 0) parts.push(theme.fg('success', `${count('completed')} succeeded`))
  if (count('failed') > 0) parts.push(theme.fg('error', `${count('failed')} failed`))
  if (count('blocked') > 0) parts.push(theme.fg('muted', `${count('blocked')} blocked`))
  parts.push(theme.fg('dim', formatJobDuration(durationMs)))
  return `${theme.fg('dim', '⟦')}${parts.join(theme.fg('dim', DOT))}${theme.fg('dim', '⟧')}`
}

export class TaskResult implements Component {
  constructor(
    private readonly rows: readonly AgentRow[],
    private readonly options: TaskResultOptions,
    private readonly theme: SubagentTheme,
    private readonly summary?: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = renderAgentRows(this.rows, this.options, this.theme)
    if (this.summary !== undefined) lines.push(this.summary)
    return lines.map((line) => truncateToWidth(line, width, '…'))
  }
}

export function plainText(text: string): Component {
  return new Text(text, 0, 0)
}
