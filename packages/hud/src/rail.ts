import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { animationTickMs } from './animation-clock.ts'
import { type RailPalette, type RailTint, tint } from './colors.ts'
import { sanitizeScalar } from './format.ts'
import { icon, type IconKey } from './icons.ts'
import type { HudTheme } from './render.ts'

export type RailStatus = 'error' | 'ok' | 'pending'

export type RailCategory = 'edit' | 'meta' | 'other' | 'read' | 'search'

export type RailKind = 'narration' | 'thought' | 'tool'

const pseudoKinds = new Set<RailKind>(['narration', 'thought'])

export function isPseudo(kind: RailKind | undefined): boolean {
  return kind !== undefined && pseudoKinds.has(kind)
}

export type RailAction = {
  category: RailCategory
  children: readonly RailAction[] | undefined
  detail: string
  doneLabel: string
  durationMs: number | undefined
  iconKey: IconKey
  kind: RailKind | undefined
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
const italicOn = '\x1b[3m'
const italicOff = '\x1b[23m'
const spinnerTickMs = 150
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const dotFrames = ['.  ', '.. ', '...'] as const

export const groupCap = 5

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
    if (isPseudo(action.kind) || (action.children?.length ?? 0) > 0) {
      open = undefined
      groups.push({
        actions: [action],
        category: action.category,
        count: 1,
        iconKey: action.iconKey,
        key: action.toolCallId,
        label: action.doneLabel,
        status: action.status,
      })
      continue
    }
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

export type PendingNarrationInput = {
  actions: readonly RailAction[]
  hasFinalText: boolean
  reasoningActive: boolean
  streaming: boolean
}

export function showsPendingNarration(input: PendingNarrationInput): boolean {
  if (!input.streaming || input.hasFinalText || input.reasoningActive) return false
  const tools = input.actions.filter((action) => !isPseudo(action.kind))
  if (tools.length === 0) return false
  return tools.every((action) => action.status !== 'pending')
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

const durationWidth = 8

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return ''
  const seconds = Math.max(0, ms) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds - minutes * 60)
  return remainder > 0 ? `${String(minutes)}m ${String(remainder)}s` : `${String(minutes)}m`
}

function empryoAnimationTick(tick: number): number {
  return Math.floor((tick * animationTickMs) / spinnerTickMs) % spinnerFrames.length
}

export function actionSpinnerFrame(tick: number): string {
  return spinnerFrames[empryoAnimationTick(tick)] ?? spinnerFrames[0]
}

export function pendingDotsFrame(tick: number): string {
  return dotFrames[Math.floor(empryoAnimationTick(tick) / 4)] ?? dotFrames[0]
}

function statusGlyph(status: RailStatus, theme: RailTheme, tick: number): string {
  if (status === 'error') return tint(theme.palette, 'fail', icon('fail'))
  if (status === 'pending') return tint(theme.palette, 'agent', actionSpinnerFrame(tick))
  return tint(theme.palette, 'ok', icon('ok'))
}

export function railHeader(groups: readonly RailGroup[], theme: RailTheme): string {
  const tools = groups.flatMap((group) => group.actions).filter((action) => !isPseudo(action.kind))
  const total = tools.length
  const failed = tools.filter((action) => action.status === 'error').length
  const edits = tools.filter((action) => action.category === 'edit').length
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
  return count > 1 ? `${padLabel(label)}×${count} ` : padLabel(label)
}

type RowParts = {
  arg: string
  branch: string
  count: number
  duration: number | undefined
  iconKey: IconKey
  kind: RailKind | undefined
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
  const budget = Math.max(1, width - durationWidth)
  const body = visibleWidth(left) > budget ? truncateToWidth(left, budget, '') : left
  const gap = Math.max(0, width - visibleWidth(body) - text.length)
  const durationTint = duration !== undefined && duration >= 1000 ? 'duration' : 'dim'
  return `${body}${' '.repeat(gap)}${tint(theme.palette, durationTint, text)}`
}

function row(
  parts: RowParts,
  theme: RailTheme,
  caret: string,
  width: number,
  tick: number,
): string {
  const pseudo = isPseudo(parts.kind)
  const kind = pseudo ? 'pseudo' : tintFor(parts.iconKey)
  const labelKind: RailTint = parts.status === 'pending' ? 'agent' : pseudo ? 'arg' : kind
  const glyph = tint(theme.palette, kind, icon(parts.iconKey))
  const gap = padLabel(parts.label).slice(parts.label.length)
  const label = `${tint(theme.palette, labelKind, parts.label)}${gap}`
  const count = parts.count > 1 ? tint(theme.palette, 'dim', `×${parts.count}`) : ''
  const mark = pseudo && parts.status !== 'pending' ? ' ' : statusGlyph(parts.status, theme, tick)
  const head = `${tint(theme.palette, 'branch', parts.branch)} ${mark} ${glyph} ${label}${count}`
  const pieces: string[] = []
  if (pseudo) {
    const detail = combineDetail(parts.arg, parts.summary)
    if (detail.length > 0) {
      const colored = tint(theme.palette, 'pseudoBody', detail)
      pieces.push(
        theme.palette.pseudoBody.length === 0 ? colored : `${italicOn}${colored}${italicOff}`,
      )
    }
  } else {
    if (parts.arg.length > 0) pieces.push(tint(theme.palette, 'arg', parts.arg))
    if (parts.summary.length > 0) {
      const tone: RailTint = parts.status === 'error' ? 'fail' : 'dim'
      const lead = tint(theme.palette, 'dim', separator)
      pieces.push(`${lead}${tint(theme.palette, tone, parts.summary)}`)
    }
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
  options: {
    expanded: boolean
    pending?: boolean
    tick?: number | undefined
    usage?: string
    width?: number
  },
): string[] {
  if (groups.length === 0) return []
  const width = options.width ?? 120
  const tick = options.tick ?? 0
  const column = labelColumn(groups)
  const lines = [railHeader(groups, theme)]
  const dropped = Math.max(0, groups.length - groupCap)
  const shownGroups = dropped > 0 ? groups.slice(dropped) : groups
  if (dropped > 0) {
    const completed = groups.slice(0, dropped).reduce((total, group) => total + group.count, 0)
    const mark = tint(theme.palette, 'dim', icon('ok'))
    lines.push(
      `${tint(theme.palette, 'branch', treeBranch)} ${mark}   ${tint(theme.palette, 'dim', `${completed} completed`)}`,
    )
  }
  const pending = options.pending === true
  shownGroups.forEach((group, index) => {
    const last = index === shownGroups.length - 1 && !pending
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
          kind: group.actions[0]?.kind,
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
        tick,
      ),
    )
    const stem = last ? '   ' : `${tint(theme.palette, 'branch', treeSpine)}  `
    if (group.count === 1) {
      const only = group.actions[0]
      const nested = only?.children ?? []
      if (nested.length > 0) {
        const inner = railLines(groupActions(nested), theme, {
          expanded: options.expanded,
          tick,
          width: Math.max(1, width - visibleWidth(stem)),
        })
        for (const line of inner.slice(1)) lines.push(`${stem}${line}`)
        return
      }
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
            kind: action.kind,
            label,
            padding: '',
            status: action.status,
            summary: action.summary,
          },
          theme,
          '',
          Math.max(1, width - visibleWidth(stem)),
          tick,
        )}`,
      )
    })
    if (hidden > 0) {
      const branch = tint(theme.palette, 'branch', treeLast)
      lines.push(`${stem}${branch} ${tint(theme.palette, 'dim', `+${hidden} completed`)}`)
    }
  })
  if (pending) {
    const branch = tint(theme.palette, 'branch', treeLast)
    const status = tint(theme.palette, 'arg', actionSpinnerFrame(tick))
    const glyph = tint(theme.palette, 'pseudo', icon('thought'))
    const label = tint(theme.palette, 'pseudoBody', 'Thinking')
    const dots = tint(theme.palette, 'arg', pendingDotsFrame(tick))
    lines.push(`${branch} ${status} ${glyph} ${label}${dots}`)
  }
  const usage = options.usage
  if (usage !== undefined && usage.length > 0) {
    lines.push('', usage)
  }
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
  children?: readonly RailAction[]
  detail?: string
  doneLabel?: string
  durationMs?: number
  iconKey?: IconKey
  kind?: RailKind
  measureDuration?: boolean
  output?: string
  resetDerived?: boolean
  runningLabel?: string
  status?: RailStatus
  summary?: string
}

export class RailStore {
  private actions: RailAction[] = []
  private readonly index = new Map<string, number>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  private rebuildIndex(): void {
    this.index.clear()
    this.actions.forEach((action, index) => this.index.set(action.toolCallId, index))
  }

  reset(): void {
    this.actions = []
    this.index.clear()
  }

  has(toolCallId: string): boolean {
    return this.index.has(toolCallId)
  }

  status(toolCallId: string): RailStatus | undefined {
    const position = this.index.get(toolCallId)
    if (position !== undefined) return this.actions[position]?.status
    for (const action of this.actions) {
      const child = action.children?.find((candidate) => candidate.toolCallId === toolCallId)
      if (child !== undefined) return child.status
    }
    return undefined
  }

  remove(toolCallId: string): void {
    const position = this.index.get(toolCallId)
    if (position === undefined) return
    this.actions.splice(position, 1)
    this.rebuildIndex()
  }

  reorder(toolCallIds: readonly string[]): void {
    const byId = new Map(this.actions.map((action) => [action.toolCallId, action]))
    const seen = new Set<string>()
    const ordered: RailAction[] = []
    for (const toolCallId of toolCallIds) {
      const action = byId.get(toolCallId)
      if (action === undefined || seen.has(toolCallId)) continue
      seen.add(toolCallId)
      ordered.push(action)
    }
    for (const action of this.actions) {
      if (seen.has(action.toolCallId)) continue
      seen.add(action.toolCallId)
      ordered.push(action)
    }
    this.actions = ordered
    this.rebuildIndex()
  }

  reportChild(parentToolCallId: string, toolCallId: string, patch: RailPatch): void {
    const position = this.index.get(parentToolCallId)
    if (position === undefined) {
      this.report(toolCallId, patch)
      return
    }
    const parent = this.actions[position]
    if (parent === undefined) return
    const children = [...(parent.children ?? [])]
    const existing = children.findIndex((child) => child.toolCallId === toolCallId)
    const base: RailAction = {
      category: patch.category ?? 'other',
      children: undefined,
      detail: patch.detail ?? '',
      doneLabel: patch.doneLabel ?? 'Tool',
      durationMs: patch.durationMs,
      iconKey: patch.iconKey ?? 'tool',
      kind: patch.kind,
      output: patch.output ?? '',
      runningLabel: patch.runningLabel ?? patch.doneLabel ?? 'Tool',
      startedAt: this.now(),
      status: patch.status ?? 'pending',
      summary:
        patch.summary ??
        (patch.output === undefined
          ? ''
          : summarizeOutput(patch.output, patch.status ?? 'pending')),
      toolCallId,
    }
    if (existing < 0) children.push(base)
    else {
      const current = children[existing]
      if (current === undefined) return
      const status = patch.status ?? current.status
      children[existing] = {
        ...current,
        category: patch.category ?? current.category,
        detail: patch.detail ?? current.detail,
        doneLabel: patch.doneLabel ?? current.doneLabel,
        durationMs:
          patch.resetDerived === true ? patch.durationMs : (patch.durationMs ?? current.durationMs),
        iconKey: patch.iconKey ?? current.iconKey,
        kind: patch.kind ?? current.kind,
        output: patch.output ?? current.output,
        runningLabel: patch.runningLabel ?? current.runningLabel,
        status,
        summary:
          patch.summary ??
          (patch.output === undefined
            ? patch.resetDerived === true
              ? ''
              : current.summary
            : summarizeOutput(patch.output, status)),
      }
    }
    this.actions[position] = { ...parent, children }
  }

  report(toolCallId: string, patch: RailPatch): void {
    const position = this.index.get(toolCallId)
    if (position === undefined) {
      const status = patch.status ?? 'pending'
      this.index.set(toolCallId, this.actions.length)
      this.actions.push({
        category: patch.category ?? 'other',
        children: patch.children,
        detail: patch.detail ?? '',
        doneLabel: patch.doneLabel ?? 'Tool',
        durationMs: patch.durationMs,
        iconKey: patch.iconKey ?? 'tool',
        kind: patch.kind,
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
      patch.measureDuration !== false &&
      patch.resetDerived !== true &&
      settled &&
      current.durationMs === undefined &&
      current.startedAt !== undefined
        ? Math.max(0, this.now() - current.startedAt)
        : current.durationMs
    const durationMs =
      patch.resetDerived === true ? patch.durationMs : (patch.durationMs ?? measured)
    this.actions[position] = {
      category: patch.category ?? current.category,
      children: patch.children ?? current.children,
      detail: patch.detail ?? current.detail,
      doneLabel: patch.doneLabel ?? current.doneLabel,
      durationMs,
      iconKey: patch.iconKey ?? current.iconKey,
      kind: patch.kind ?? current.kind,
      output: patch.output ?? current.output,
      runningLabel: patch.runningLabel ?? current.runningLabel,
      startedAt: current.startedAt,
      status,
      summary:
        patch.summary ??
        (patch.output === undefined
          ? patch.resetDerived === true
            ? ''
            : current.summary
          : summarizeOutput(patch.output, status)),
      toolCallId,
    }
  }

  groups(): RailGroup[] {
    return groupActions(this.actions)
  }

  size(): number {
    return this.actions.length
  }

  values(): readonly RailAction[] {
    return this.actions
  }
}
