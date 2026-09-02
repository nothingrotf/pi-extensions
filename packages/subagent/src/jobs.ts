import { type Component, truncateToWidth } from '@earendil-works/pi-tui'

import { oneLineLabel, type SubagentTheme } from './format.ts'
import type { SubagentSnapshot } from './runtime.ts'
import type { RunStatus } from './schema.ts'

export type JobStatus = RunStatus | 'blocked'

export interface JobSnapshot {
  agentId: string
  description: string
  durationMs: number
  lastActivity: string | undefined
  status: JobStatus
}

export interface JobProgressDetails {
  jobs: readonly JobSnapshot[]
  status: 'progress'
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const COLLAPSED_LIMIT = 8

export function toJobSnapshot(snapshot: SubagentSnapshot, now: number): JobSnapshot {
  const end = snapshot.endedAt ?? now
  return {
    agentId: snapshot.agentId,
    description: snapshot.description,
    durationMs: Math.max(0, end - snapshot.startedAt),
    lastActivity: snapshot.lastActivity,
    status: snapshot.status,
  }
}

export function formatJobDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

function jobIcon(job: JobSnapshot, frame: number, theme: SubagentTheme): string {
  if (job.status === 'running') {
    return theme.fg('accent', SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? '•')
  }
  if (job.status === 'completed') return theme.fg('success', '✓')
  if (job.status === 'aborted') return theme.fg('warning', '⏹')
  if (job.status === 'blocked') return theme.fg('muted', '⊘')
  return theme.fg('error', '✗')
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

function jobMeta(jobs: readonly JobSnapshot[], theme: SubagentTheme): string {
  const parts: string[] = []
  const completed = jobs.filter((job) => job.status === 'completed').length
  const failed = jobs.filter((job) => job.status === 'failed').length
  const aborted = jobs.filter((job) => job.status === 'aborted').length
  if (completed > 0) parts.push(theme.fg('success', `${completed} done`))
  if (failed > 0) parts.push(theme.fg('error', `${failed} failed`))
  if (aborted > 0) parts.push(theme.fg('warning', `${aborted} aborted`))
  const blocked = jobs.filter((job) => job.status === 'blocked').length
  if (blocked > 0) parts.push(theme.fg('muted', `${blocked} blocked`))
  return parts.join(theme.fg('dim', ' · '))
}

export interface JobTreeOptions {
  expanded: boolean
  isPartial: boolean
  now: number
  width: number
}

function jobLine(job: JobSnapshot, frame: number, theme: SubagentTheme): string {
  const live = job.status === 'running'
  const badge = theme.fg(live ? 'accent' : 'muted', '[task]')
  const label = live
    ? theme.fg('accent', oneLineLabel(job.description, 80))
    : theme.fg('muted', oneLineLabel(job.description, 80))
  const activity =
    live && job.lastActivity !== undefined
      ? ` ${theme.fg('dim', `→ ${oneLineLabel(job.lastActivity, 60)}`)}`
      : ''
  return `${jobIcon(job, frame, theme)} ${badge} ${label} ${theme.fg('dim', formatJobDuration(job.durationMs))}${activity}`
}

export function renderJobTree(
  jobs: readonly JobSnapshot[],
  options: JobTreeOptions,
  theme: SubagentTheme,
): string[] {
  const visible = options.isPartial ? jobs : jobs.filter((job) => job.status !== 'running')
  if (visible.length === 0) return []
  const running = visible.some((job) => job.status === 'running')
  const failed = visible.some((job) => job.status === 'failed')
  const headIcon = failed
    ? theme.fg('error', '✗')
    : running
      ? theme.fg('accent', 'ⓘ')
      : theme.fg('success', '✓')
  const meta = jobMeta(visible, theme)
  const title = theme.fg(running ? 'accent' : 'text', jobTitle(visible))
  const lines = [
    truncateToWidth(
      `${headIcon} ${title}${meta.length > 0 ? `${theme.fg('dim', ' · ')}${meta}` : ''}`,
      options.width,
      '…',
    ),
  ]
  const frame = Math.floor(options.now / 250)
  const sorted = sortJobs(visible)
  const shown = options.expanded ? sorted : sorted.slice(0, COLLAPSED_LIMIT)
  const hidden = sorted.length - shown.length
  shown.forEach((job, index) => {
    const last = index === shown.length - 1 && hidden === 0
    lines.push(
      truncateToWidth(
        `${theme.fg('dim', last ? '└─' : '├─')} ${jobLine(job, frame, theme)}`,
        options.width,
        '…',
      ),
    )
  })
  if (hidden > 0) {
    lines.push(`${theme.fg('dim', '└─')} ${theme.fg('dim', `+${hidden} more`)}`)
  }
  return lines
}

export class JobTree implements Component {
  constructor(
    private readonly jobs: readonly JobSnapshot[],
    private readonly options: Omit<JobTreeOptions, 'width'>,
    private readonly theme: SubagentTheme,
    private readonly header?: string,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    const lines = renderJobTree(this.jobs, { ...this.options, width }, this.theme)
    return this.header === undefined ? lines : [this.header, ...lines]
  }
}
