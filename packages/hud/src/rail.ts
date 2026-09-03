import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { type RailPalette, type RailTint, tint } from './colors.ts'
import { sanitizeScalar } from './format.ts'
import { icon, type IconKey } from './icons.ts'
import type { HudTheme } from './render.ts'

export type RailStatus = 'error' | 'ok' | 'pending'

export type RailCategory = 'edit' | 'meta' | 'other' | 'read' | 'search'

export type RailAction = {
  category: RailCategory
  detail: string
  doneLabel: string
  durationMs: number | undefined
  iconKey: IconKey
  output: string
  runningLabel: string
  startedAt: number | undefined
  status: RailStatus
  summary: string
  toolCallId: string
}

export type RailGroup = {
  actions: RailAction[]
  category: RailCategory
  count: number
  iconKey: IconKey
  key: string
  label: string
  status: RailStatus
}

export type RailTheme = HudTheme & { palette: RailPalette }

export const separator = ' · '

export const treeBranch = '├─'
export const treeLast = '╰─'
export const treeSpine = '│'

const detailCap = 96
const outputLineCap = 6
const outputWidthCap = 120
const childCap = 8

export function tintFor(key: IconKey): RailTint {
  switch (key) {
    case 'agent':
      return 'agent'
    case 'ask':
      return 'ask'
    case 'web':
      return 'web'
    case 'todo':
      return 'native'
    case 'read':
    case 'search':
    case 'find':
      return 'read'
    case 'edit':
    case 'shell':
      return 'shell'
    default:
      return 'neutral'
  }
}

function actionLabel(action: RailAction): string {
  return action.status === 'pending' ? action.runningLabel : action.doneLabel
}

function mergeMeta(groups: RailGroup[], action: RailAction): boolean {
  const existing = groups.find(
    (group) => group.category === 'meta' && group.key === action.doneLabel,
  )
  if (existing === undefined) return false
  existing.actions.push(action)
  existing.count += 1
  existing.status = action.status === 'error' ? 'error' : existing.status
  return true
}

export function groupActions(actions: readonly RailAction[]): RailGroup[] {
  const groups: RailGroup[] = []
  let open: RailGroup | undefined
  for (const action of actions) {
    if (action.category === 'meta') {
      if (mergeMeta(groups, action)) continue
      groups.push({
        actions: [action],
        category: 'meta',
        count: 1,
        iconKey: action.iconKey,
        key: action.doneLabel,
        label: action.doneLabel,
        status: action.status,
      })
      continue
    }
    const joinable =
      open !== undefined &&
      open.key === action.doneLabel &&
      open.status !== 'error' &&
      action.status !== 'error'
    if (open !== undefined && joinable) {
      open.actions.push(action)
      open.count += 1
      continue
    }
    open = {
      actions: [action],
      category: action.category,
      count: 1,
      iconKey: action.iconKey,
      key: action.doneLabel,
      label: action.doneLabel,
      status: action.status,
    }
    groups.push(open)
  }
  return groups
}

export function groupLabel(group: RailGroup): string {
  const only = group.actions[0]
  if (group.count === 1 && only !== undefined) return actionLabel(only)
  return group.label
}

export type DetailParts = { arg: string; summary: string }

export function combineDetail(arg: string, summary: string): string {
  if (arg.length > 0 && summary.length > 0) return `${arg}${separator}${summary}`
  if (summary.length > 0) return `· ${summary}`
  return arg
}

export function actionParts(action: RailAction): DetailParts {
  return { arg: action.detail, summary: action.summary }
}

export function actionDetail(action: RailAction): string {
  return combineDetail(action.detail, action.summary)
}

export function groupParts(group: RailGroup): DetailParts {
  if (group.category === 'meta') {
    const latest = group.actions.at(-1)
    return latest === undefined ? { arg: '', summary: '' } : actionParts(latest)
  }
  if (group.count === 1) {
    const only = group.actions[0]
    return only === undefined ? { arg: '', summary: '' } : actionParts(only)
  }
  const seen: string[] = []
  for (const action of group.actions) {
    if (action.detail.length > 0 && !seen.includes(action.detail)) seen.push(action.detail)
  }
  return { arg: seen.join(separator), summary: '' }
}

export function groupDetail(group: RailGroup): string {
  const parts = groupParts(group)
  return combineDetail(parts.arg, parts.summary)
}

function groupDuration(group: RailGroup): number | undefined {
  if (group.count !== 1) return undefined
  return group.actions[0]?.durationMs
}

const durationFloorMs = 500
const durationGap = 4

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < durationFloorMs) return ''
  return `${(ms / 1000).toFixed(1)}s`
}

function statusGlyph(status: RailStatus, theme: RailTheme): string {
  if (status === 'error') return tint(theme.palette, 'fail', icon('fail'))
  if (status === 'pending') return tint(theme.palette, 'dim', icon('pending'))
  return tint(theme.palette, 'ok', icon('ok'))
}

export function railHeader(groups: readonly RailGroup[], theme: RailTheme): string {
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  const failed = groups.reduce(
    (sum, group) => sum + (group.status === 'error' ? group.count : 0),
    0,
  )
  const edits = groups.reduce(
    (sum, group) => sum + (group.category === 'edit' ? group.count : 0),
    0,
  )
  const noun = total === 1 ? 'action' : 'actions'
  const parts = [tint(theme.palette, 'head', `${total} ${noun}`)]
  if (edits > 0)
    parts.push(tint(theme.palette, 'head', `${edits} ${edits === 1 ? 'edit' : 'edits'}`))
  if (failed > 0) parts.push(tint(theme.palette, 'headFail', `${failed} failed`))
  return `${parts.join(tint(theme.palette, 'dim', separator))} ${tint(theme.palette, 'caret', '▾')}`
}

export const labelWidth = 12

export function padLabel(label: string): string {
  const width = visibleWidth(label)
  return width >= labelWidth ? `${label} ` : label + ' '.repeat(labelWidth - width)
}

function countCell(label: string, count: number): string {
  return count > 1 ? `${padLabel(label)}×${count}` : padLabel(label)
}

type RowParts = {
  arg: string
  branch: string
  count: number
  duration: number | undefined
  iconKey: IconKey
  label: string
  padding: string
  status: RailStatus
  summary: string
}

function alignDuration(
  left: string,
  duration: number | undefined,
  theme: RailTheme,
  width: number,
): string {
  const text = formatDuration(duration)
  if (text.length === 0) {
    return visibleWidth(left) > width ? truncateToWidth(left, width, '') : left
  }
  const budget = Math.max(1, width - text.length - durationGap)
  const body = visibleWidth(left) > budget ? truncateToWidth(left, budget, '') : left
  const gap = Math.max(durationGap, width - visibleWidth(body) - text.length)
  return `${body}${' '.repeat(gap)}${tint(theme.palette, 'dim', text)}`
}

function row(parts: RowParts, theme: RailTheme, caret: string, width: number): string {
  const kind = tintFor(parts.iconKey)
  const glyph = tint(theme.palette, kind, icon(parts.iconKey))
  const gap = padLabel(parts.label).slice(parts.label.length)
  const label = `${tint(theme.palette, kind, parts.label)}${gap}`
  const count = parts.count > 1 ? tint(theme.palette, 'dim', `×${parts.count}`) : ''
  const head = `${tint(theme.palette, 'branch', parts.branch)} ${statusGlyph(parts.status, theme)} ${glyph} ${label}${count}`
  const pieces: string[] = []
  if (parts.arg.length > 0) pieces.push(tint(theme.palette, 'arg', parts.arg))
  if (parts.summary.length > 0) {
    const tone: RailTint = parts.status === 'error' ? 'fail' : 'dim'
    const lead = tint(theme.palette, 'dim', separator)
    pieces.push(`${lead}${tint(theme.palette, tone, parts.summary)}`)
  }
  const body = pieces.join('')
  const gutter =
    parts.padding.length > 0 && body.startsWith(' ') ? parts.padding.slice(1) : parts.padding
  const left = body.length > 0 ? `${head}${gutter}${body}${caret}` : `${head}${caret}`
  return alignDuration(left, parts.duration, theme, width)
}

function trimBlankEdges(value: string): string[] {
  const lines = value.split('\n')
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim().length === 0) start += 1
  while (end > start && (lines[end - 1] ?? '').trim().length === 0) end -= 1
  return lines.slice(start, end)
}

function outputLines(group: RailGroup, theme: RailTheme, indent: string): string[] {
  const lines: string[] = []
  for (const action of group.actions) {
    for (const line of trimBlankEdges(action.output)) {
      if (lines.length >= outputLineCap) {
        lines.push(`${indent}${tint(theme.palette, 'dim', '…')}`)
        return lines
      }
      lines.push(
        `${indent}${tint(theme.palette, 'dim', truncateToWidth(line, outputWidthCap, '…'))}`,
      )
    }
  }
  return lines
}

function parentParts(group: RailGroup): DetailParts {
  const parts = groupParts(group)
  if (group.count > 1 && visibleWidth(parts.arg) > detailCap) return { arg: '', summary: '' }
  return {
    arg: truncateToWidth(parts.arg, detailCap, ''),
    summary: truncateToWidth(parts.summary, detailCap, ''),
  }
}

export function labelColumn(groups: readonly RailGroup[]): number {
  let width = 0
  for (const group of groups) {
    width = Math.max(width, visibleWidth(countCell(groupLabel(group), group.count)))
    if (group.count === 1) continue
    for (const action of group.actions) {
      width = Math.max(width, visibleWidth(padLabel(actionLabel(action))))
    }
  }
  return width
}

export function railLines(
  groups: readonly RailGroup[],
  theme: RailTheme,
  options: { expanded: boolean; width?: number },
): string[] {
  if (groups.length === 0) return []
  const width = options.width ?? 120
  const column = labelColumn(groups)
  const lines = [railHeader(groups, theme)]
  groups.forEach((group, index) => {
    const last = index === groups.length - 1
    const parentCell = countCell(groupLabel(group), group.count)
    const caret = group.count > 1 ? ` ${tint(theme.palette, 'caret', '▾')}` : ''
    const parent = parentParts(group)
    lines.push(
      row(
        {
          arg: parent.arg,
          branch: last ? treeLast : treeBranch,
          count: group.count,
          duration: groupDuration(group),
          iconKey: group.iconKey,
          label: groupLabel(group),
          padding: ' '.repeat(
            Math.max(0, column - visibleWidth(parentCell)) + (group.count > 1 ? 1 : 0),
          ),
          status: group.status,
          summary: parent.summary,
        },
        theme,
        caret,
        width,
      ),
    )
    const stem = last ? '   ' : `${tint(theme.palette, 'branch', treeSpine)}  `
    if (group.count === 1) {
      if (options.expanded) lines.push(...outputLines(group, theme, `${stem}   `))
      return
    }
    const shown = group.actions.slice(0, childCap)
    const hidden = group.actions.length - shown.length
    shown.forEach((action, childIndex) => {
      const childLast = hidden === 0 && childIndex === shown.length - 1
      const label = actionLabel(action)
      lines.push(
        `${stem}${row(
          {
            arg: action.detail,
            branch: childLast ? treeLast : treeBranch,
            count: 1,
            duration: action.durationMs,
            iconKey: action.iconKey,
            label,
            padding: '',
            status: action.status,
            summary: action.summary,
          },
          theme,
          '',
          Math.max(1, width - visibleWidth(stem)),
        )}`,
      )
    })
    if (hidden > 0) {
      const branch = tint(theme.palette, 'branch', treeLast)
      lines.push(`${stem}${branch} ${tint(theme.palette, 'dim', `+${hidden} completed`)}`)
    }
  })
  return lines
}

export function summarizeOutput(text: string, status: RailStatus = 'ok'): string {
  const trimmed = text.trimEnd()
  if (trimmed.length === 0) return ''
  if (status === 'error') {
    const first = trimmed.split('\n').find((line) => line.trim().length > 0) ?? ''
    const single = sanitizeScalar(first)
    return single.length === 0 ? '' : truncateToWidth(single, detailCap, '…')
  }
  const lines = trimmed.split('\n')
  if (lines.length > 1) return `${lines.length} lines`
  const single = sanitizeScalar(trimmed)
  return single.length === 0 ? '' : truncateToWidth(single, detailCap, '…')
}

export type RailPatch = {
  category?: RailCategory
  detail?: string
  doneLabel?: string
  durationMs?: number
  iconKey?: IconKey
  output?: string
  runningLabel?: string
  status?: RailStatus
  summary?: string
}

export class RailStore {
  private actions: RailAction[] = []
  private readonly index = new Map<string, number>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  reset(): void {
    this.actions = []
    this.index.clear()
  }

  report(toolCallId: string, patch: RailPatch): void {
    const position = this.index.get(toolCallId)
    if (position === undefined) {
      const status = patch.status ?? 'pending'
      this.index.set(toolCallId, this.actions.length)
      this.actions.push({
        category: patch.category ?? 'other',
        detail: patch.detail ?? '',
        doneLabel: patch.doneLabel ?? 'Tool',
        durationMs: patch.durationMs,
        iconKey: patch.iconKey ?? 'tool',
        output: patch.output ?? '',
        runningLabel: patch.runningLabel ?? patch.doneLabel ?? 'Tool',
        startedAt: this.now(),
        status,
        summary:
          patch.summary ??
          (patch.output === undefined ? '' : summarizeOutput(patch.output, status)),
        toolCallId,
      })
      return
    }
    const current = this.actions[position]
    if (current === undefined) return
    const status = patch.status ?? current.status
    const settled = status === 'ok' || status === 'error'
    const measured =
      settled && current.durationMs === undefined && current.startedAt !== undefined
        ? Math.max(0, this.now() - current.startedAt)
        : current.durationMs
    const durationMs = patch.durationMs ?? measured
    this.actions[position] = {
      category: patch.category ?? current.category,
      detail: patch.detail ?? current.detail,
      doneLabel: patch.doneLabel ?? current.doneLabel,
      durationMs,
      iconKey: patch.iconKey ?? current.iconKey,
      output: patch.output ?? current.output,
      runningLabel: patch.runningLabel ?? current.runningLabel,
      startedAt: current.startedAt,
      status,
      summary:
        patch.summary ??
        (patch.output === undefined ? current.summary : summarizeOutput(patch.output, status)),
      toolCallId,
    }
  }

  groups(): RailGroup[] {
    return groupActions(this.actions)
  }

  size(): number {
    return this.actions.length
  }
}
