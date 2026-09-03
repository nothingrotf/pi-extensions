import { type Component, truncateToWidth } from '@earendil-works/pi-tui'

import { oneLineLabel, type SubagentTheme, TREE_BRANCH, TREE_LAST } from './format.ts'
import type { SubagentSnapshot } from './runtime.ts'
import type { RunStatus } from './schema.ts'
import { shimmerText } from './shimmer.ts'

export type JobStatus = RunStatus | 'blocked'

export interface JobContext {
  percent: number | null
  window: number
}

export interface JobSnapshot {
  agentId: string
  context: JobContext | undefined
  cost: number
  description: string
  durationMs: number
  lastActivity: string | undefined
  status: JobStatus
  subagentType: string
  toolCalls: number
}

export interface JobProgressDetails {
  jobs: readonly JobSnapshot[]
  status: 'progress'
}

export const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷']
const SPINNER_ADVANCE_MS = 80
const COLLAPSED_LIMIT = 8
const LABEL_MAX_WIDTH = 60
const BRACKET_LEFT = '⟦'
const BRACKET_RIGHT = '⟧'
const DOT = ' · '

export function toJobSnapshot(snapshot: SubagentSnapshot, now: number): JobSnapshot {
  const end = snapshot.endedAt ?? now
  return {
    agentId: snapshot.agentId,
    context:
      snapshot.contextState === undefined
        ? undefined
        : { percent: snapshot.contextState.percent, window: snapshot.contextState.contextWindow },
    cost: snapshot.usage.cost,
    description: snapshot.description,
    durationMs: Math.max(0, end - snapshot.startedAt),
    lastActivity: snapshot.lastActivity,
    status: snapshot.status,
    subagentType: snapshot.subagentType,
    toolCalls: snapshot.usage.toolCalls,
  }
}

export function formatJobDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0ms'
  if (milliseconds < 1_000) return `${Math.floor(milliseconds)}ms`
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)}s`
  if (milliseconds < 3_600_000) {
    const minutes = Math.floor(milliseconds / 60_000)
    const seconds = Math.floor((milliseconds % 60_000) / 1_000)
    return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
  }
  if (milliseconds < 86_400_000) {
    const hours = Math.floor(milliseconds / 3_600_000)
    const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`
  }
  const days = Math.floor(milliseconds / 86_400_000)
  const hours = Math.floor((milliseconds % 86_400_000) / 3_600_000)
  return hours > 0 ? `${days}d${hours}h` : `${days}d`
}

export function spinnerFrame(now: number): number {
  return Math.floor(now / SPINNER_ADVANCE_MS) % SPINNER_FRAMES.length
}

export type BadgeColor = 'accent' | 'dim' | 'error' | 'muted' | 'success' | 'warning'

export function formatBadge(label: string, color: BadgeColor, theme: SubagentTheme): string {
  return theme.fg(color, `${BRACKET_LEFT}${label}${BRACKET_RIGHT}`)
}

function jobIcon(job: JobSnapshot, frame: number | undefined, theme: SubagentTheme): string {
  if (job.status === 'running') {
    return frame === undefined
      ? theme.fg('accent', '⟳')
      : (SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? '•')
  }
  if (job.status === 'completed') return theme.fg('success', '•')
  if (job.status === 'aborted') return theme.fg('error', '⏹')
  if (job.status === 'blocked') return theme.fg('muted', '⦸')
  return theme.fg('error', '✘')
}

function jobColor(status: JobStatus): BadgeColor {
  if (status === 'running') return 'accent'
  if (status === 'completed') return 'success'
  if (status === 'aborted') return 'warning'
  if (status === 'blocked') return 'muted'
  return 'error'
}

function statusOrder(status: JobStatus): number {
  if (status === 'running') return 0
  if (status === 'failed') return 1
  if (status === 'completed') return 3
  return 2
}

export function sortJobs(jobs: readonly JobSnapshot[]): JobSnapshot[] {
  return [...jobs].sort((left, right) => {
    const order = statusOrder(left.status) - statusOrder(right.status)
    return order !== 0 ? order : right.durationMs - left.durationMs
  })
}

export function jobTitle(jobs: readonly JobSnapshot[]): string {
  const running = jobs.filter((job) => job.status === 'running').length
  const noun = jobs.length === 1 ? 'job' : 'jobs'
  if (running === 0) return `${jobs.length} ${noun} settled`
  if (running === jobs.length) return `waiting on ${jobs.length} ${noun}`
  return `waiting on ${running} of ${jobs.length} ${noun}`
}

function jobMeta(jobs: readonly JobSnapshot[], theme: SubagentTheme): string[] {
  const parts: string[] = []
  const completed = jobs.filter((job) => job.status === 'completed').length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const aborted = jobs.filter((job) => job.status === 'aborted').length
  const blocked = jobs.filter((job) => job.status === 'blocked').length
  if (completed > 0) parts.push(theme.fg('success', `${completed} done`))
  if (failed > 0) parts.push(theme.fg('error', `${failed} failed`))
  if (aborted > 0) parts.push(theme.fg('warning', `${aborted} cancelled`))
  if (blocked > 0) parts.push(theme.fg('muted', `${blocked} blocked`))
  return parts
}

export function formatMoreItems(remaining: number, itemType: string): string {
  return `… ${remaining} more ${itemType}${remaining === 1 ? '' : 's'}`
}

export interface JobTreeOptions {
  expanded: boolean
  isPartial: boolean
  now: number
  retainRunning?: boolean
  width: number
}

function jobLine(job: JobSnapshot, frame: number | undefined, theme: SubagentTheme): string {
  const live = job.status === 'running' && frame !== undefined
  const label = truncateToWidth(oneLineLabel(job.description) || '(no label)', LABEL_MAX_WIDTH, '…')
  const head = live ? shimmerText(label, theme) : theme.fg('toolOutput', label)
  return `${jobIcon(job, frame, theme)} ${formatBadge('task', jobColor(job.status), theme)} ${head} ${theme.fg('dim', formatJobDuration(job.durationMs))}`
}

export function renderJobTree(
  jobs: readonly JobSnapshot[],
  options: JobTreeOptions,
  theme: SubagentTheme,
): string[] {
  const visible =
    options.isPartial || options.retainRunning === true
      ? jobs
      : jobs.filter((job) => job.status !== 'running')
  if (visible.length === 0) return []
  const running = visible.filter((job) => job.status === 'running').length
  const failed = visible.some((job) => job.status === 'failed')
  const headIcon = failed
    ? theme.fg('warning', '⚠')
    : running > 0
      ? theme.fg('accent', 'ⓘ')
      : theme.fg('success', '✔')
  const meta = jobMeta(visible, theme)
  const title = theme.fg('accent', jobTitle(visible))
  const lines = [
    `${headIcon} ${title}${meta.length > 0 ? ` ${theme.fg('dim', meta.join(DOT))}` : ''}`,
  ]
  const frame = options.isPartial && running > 0 ? spinnerFrame(options.now) : undefined
  const sorted = sortJobs(visible)
  const shown = options.expanded ? sorted : sorted.slice(0, COLLAPSED_LIMIT)
  const hidden = sorted.length - shown.length
  shown.forEach((job, index) => {
    const last = index === shown.length - 1 && hidden === 0
    lines.push(`${theme.fg('dim', last ? TREE_LAST : TREE_BRANCH)} ${jobLine(job, frame, theme)}`)
  })
  if (hidden > 0) {
    lines.push(`${theme.fg('dim', TREE_LAST)} ${theme.fg('muted', formatMoreItems(hidden, 'job'))}`)
  }
  return lines.map((line) => truncateToWidth(line, options.width, '…'))
}

export class JobTree implements Component {
  constructor(
    private readonly jobs: readonly JobSnapshot[],
    private readonly options: Omit<JobTreeOptions, 'now' | 'width'>,
    private readonly theme: SubagentTheme,
    private readonly header?: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = renderJobTree(this.jobs, { ...this.options, now: Date.now(), width }, this.theme)
    return this.header === undefined ? lines : [this.header, ...lines]
  }
}
