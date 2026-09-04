import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent'
import {
  type Component,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui'

import type { SubagentSnapshot } from './runtime.ts'
import type { RunStatus, RunUsage } from './schema.ts'

export type SubagentTheme = Pick<Theme, 'bg' | 'bold' | 'fg' | 'getFgAnsi'> &
  Partial<Pick<Theme, 'getBgAnsi'>>

export const TREE_BRANCH = '├─'
export const TREE_LAST = '╰─'
export const TREE_TAIL = '╰'
export const SUBAGENT_SETTLE_LINGER_MS = 1_400

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
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

function taskDuration(snapshot: SubagentSnapshot): string {
  const end = snapshot.endedAt ?? Date.now()
  const value = formatDuration(end - snapshot.startedAt)
  return snapshot.running ? `running ${value}` : value
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

const widgetVisibleLimit = 5

function dockInset(width: number): number {
  if (width >= 110) return 4
  if (width >= 80) return 3
  if (width >= 56) return 2
  return width >= 12 ? 1 : 0
}

function fitLine(line: string, width: number): string {
  const fitted = truncateToWidth(line, width, '…')
  return `${fitted}${' '.repeat(Math.max(0, width - visibleWidth(fitted)))}`
}

function modelName(model: string): string {
  const value = model.split('/').at(-1) ?? model
  if (value.includes('opus')) return 'opus'
  if (value.includes('sonnet')) return 'sonnet'
  if (value.includes('haiku')) return 'haiku'
  return value.replace(/^gpt-/, '')
}

function roleSigil(type: string): string {
  if (type === 'explore') return '✧'
  if (type === 'shell') return '✦'
  if (type === 'debug') return '⊙'
  return '❖'
}

const thinkingFaces = ['(◔‿◔)', '(◑‿◑)', '(◕‿◕)', '(●‿●)']

function stableHash(value: string): number {
  let hash = 0
  for (const character of value) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) | 0
  return Math.abs(hash)
}

function face(snapshot: SubagentSnapshot, now: number): string {
  if (snapshot.status === 'completed') return '(✓‿✓)'
  if (snapshot.status === 'failed') return '(✗‿✗)'
  if (snapshot.status === 'aborted') return '(─‿─)'
  const tick = Math.floor(now / 160)
  if (snapshot.lastActivity?.toLowerCase() === 'thinking') {
    return thinkingFaces[Math.floor(tick / 3) % thinkingFaces.length] ?? thinkingFaces[0] ?? '(◔‿◔)'
  }
  const phase = (tick + stableHash(snapshot.agentId)) % 28
  if (phase === 0) return '(─‿─)'
  if (phase === 14) return '(─‿◉)'
  return '(◉‿◉)'
}

function rowTone(snapshot: SubagentSnapshot): ThemeColor {
  if (snapshot.status === 'completed') return 'success'
  if (snapshot.status === 'failed') return 'error'
  if (snapshot.status === 'aborted') return 'warning'
  return 'accent'
}

function activity(snapshot: SubagentSnapshot): { detail: string; tool: string } {
  if (!snapshot.running) {
    if (snapshot.status === 'completed') return { detail: '', tool: '✓ done' }
    if (snapshot.status === 'failed')
      return { detail: oneLineLabel(snapshot.error ?? ''), tool: '✗ failed' }
    return { detail: '', tool: '─ aborted' }
  }
  const value = oneLineLabel(snapshot.lastActivity ?? 'queued')
  const separator = value.indexOf(' ')
  return separator < 0
    ? { detail: '', tool: value.toLowerCase() }
    : { detail: value.slice(separator + 1), tool: value.slice(0, separator).toLowerCase() }
}

function rowColumns(width: number): {
  detail: boolean
  model: number
  name: number
  sigil: boolean
  tokens: boolean
  tool: number
} {
  if (width >= 96) return { detail: true, model: 12, name: 12, sigil: true, tokens: true, tool: 20 }
  if (width >= 76)
    return { detail: false, model: 11, name: 11, sigil: false, tokens: true, tool: 16 }
  if (width >= 56)
    return { detail: false, model: 0, name: 10, sigil: false, tokens: true, tool: 14 }
  return { detail: false, model: 0, name: 9, sigil: false, tokens: false, tool: 8 }
}

function agentRow(
  snapshot: SubagentSnapshot,
  connector: string,
  width: number,
  theme: SubagentTheme,
  now: number,
): string {
  const columns = rowColumns(width)
  const current = activity(snapshot)
  const name = truncateToWidth(oneLineLabel(snapshot.description), columns.name, '…').padEnd(
    columns.name,
  )
  const model =
    columns.model === 0
      ? ''
      : ` ${truncateToWidth(modelName(snapshot.model), columns.model - 1, '…').padEnd(columns.model - 1)}`
  const tool = truncateToWidth(current.tool, Math.max(1, columns.tool - 1), '…').padEnd(
    Math.max(1, columns.tool - 1),
  )
  const tokens = snapshot.usage.input + snapshot.usage.output
  const tokenText = columns.tokens && tokens > 0 ? ` ${formatTokens(tokens).padStart(6)}` : ''
  const detail = columns.detail && current.detail.length > 0 ? `   ${current.detail}` : ''
  const tone = rowTone(snapshot)
  const sigil = columns.sigil ? `${theme.fg(tone, roleSigil(snapshot.subagentType))} ` : ''
  const nameText = snapshot.running ? theme.bold(theme.fg('text', name)) : theme.fg('muted', name)
  return [
    theme.fg('dim', `${connector} `),
    sigil,
    theme.fg(tone, face(snapshot, now)),
    ' ',
    nameText,
    theme.fg('dim', model),
    theme.fg(tone, ` ${tool}`),
    theme.fg('dim', tokenText),
    detail.length > 0 ? theme.fg('dim', detail) : '',
  ].join('')
}

function panelTone(snapshots: readonly SubagentSnapshot[], background: boolean): ThemeColor {
  if (snapshots.some((snapshot) => snapshot.status === 'failed')) return 'error'
  if (snapshots.every((snapshot) => !snapshot.running)) return 'success'
  return background ? 'mdLink' : 'accent'
}

function renderPanel(
  rows: readonly string[],
  title: string,
  titleRight: string,
  footer: string,
  footerRight: string,
  tone: ThemeColor,
  theme: SubagentTheme,
  width: number,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const inset = dockInset(safeWidth)
  const panelWidth = Math.max(1, safeWidth - inset * 2)
  const outer = ' '.repeat(inset)
  const border = (text: string) => theme.fg(tone, text)
  const background = theme.getBgAnsi?.('toolPendingBg') ?? ''
  const surface = (content: string) =>
    `${outer}${theme.bg('toolPendingBg', content.replaceAll('\u001B[0m', `\u001B[0m${background}`))}`
  if (panelWidth < 8) return rows.map((row) => surface(truncateToWidth(row, panelWidth, '…')))

  const maxTitleWidth = Math.max(1, Math.floor(panelWidth * 0.62))
  const titleText = truncateToWidth(` ${title} `, maxTitleWidth, '')
  const titleChip = theme.bold(theme.fg(tone, titleText))
  const rightBudget = Math.max(0, panelWidth - visibleWidth(titleText) - 8)
  const rightText = truncateToWidth(titleRight, rightBudget, '')
  const right = rightText.length === 0 ? '' : ` ${theme.fg('dim', rightText)} `
  const topFill = '─'.repeat(
    Math.max(
      0,
      panelWidth - visibleWidth(titleText) - visibleWidth(right) - (right === '' ? 3 : 4),
    ),
  )
  const top =
    right === ''
      ? surface(`${border('╭─')}${titleChip}${border(`${topFill}╮`)}`)
      : surface(`${border('╭─')}${titleChip}${border(topFill)}${right}${border('─╮')}`)

  const innerWidth = Math.max(1, panelWidth - 6)
  const body = rows.map((row) =>
    surface(`${border('│')}  ${fitLine(row, innerWidth)}  ${border('│')}`),
  )
  const leftText = truncateToWidth(
    footer,
    Math.max(0, Math.min(Math.floor(panelWidth * 0.62), panelWidth - 5)),
    '',
  )
  const left = leftText.length === 0 ? '' : ` ${theme.fg('dim', leftText)} `
  const footerRightBudget = Math.max(0, panelWidth - visibleWidth(left) - 8)
  const clippedFooterRight = truncateToWidth(footerRight, footerRightBudget, '')
  const rightFooter =
    clippedFooterRight.length === 0 ? '' : ` ${theme.fg('dim', clippedFooterRight)} `
  const bottomFill = '─'.repeat(
    Math.max(
      0,
      panelWidth - visibleWidth(left) - visibleWidth(rightFooter) - (rightFooter === '' ? 3 : 4),
    ),
  )
  const bottom =
    rightFooter === ''
      ? surface(`${border('╰─')}${left}${border(`${bottomFill}╯`)}`)
      : surface(`${border('╰─')}${left}${border(bottomFill)}${rightFooter}${border('─╯')}`)
  return [top, ...body, bottom]
}

function groupLines(
  snapshots: readonly SubagentSnapshot[],
  background: boolean,
  theme: SubagentTheme,
  width: number,
  now: number,
  parentModel: string | undefined,
): string[] {
  const visible = snapshots.slice(0, widgetVisibleLimit)
  const inset = dockInset(width)
  const panelWidth = Math.max(1, width - inset * 2)
  const rows: string[] = []
  if (!background && parentModel !== undefined && panelWidth >= 56) {
    rows.push(`${theme.fg('accent', '◉')} ${theme.fg('muted', modelName(parentModel))}`)
  }
  visible.forEach((snapshot, index) => {
    const connector =
      index === visible.length - 1 && snapshots.length <= visible.length ? TREE_LAST : TREE_BRANCH
    rows.push(agentRow(snapshot, connector, panelWidth - 6, theme, now))
  })
  if (snapshots.length > visible.length) {
    rows.push(theme.fg('dim', `${TREE_LAST} +${snapshots.length - visible.length} more`))
  }
  const active = snapshots.some((snapshot) => snapshot.running)
  const beganAt = Math.min(...snapshots.map((snapshot) => snapshot.startedAt))
  const elapsed = formatDuration(Math.max(0, now - beganAt))
  const done = snapshots.filter((snapshot) => snapshot.status === 'completed').length
  const right = active || done === 0 ? elapsed : `${done} done · ${elapsed}`
  const title = background
    ? `◌ background · ${snapshots.length} ▾`
    : `󰚩 dispatch · ${snapshots.length} ▾`
  const footer = active
    ? background
      ? 'they outlive this turn'
      : '↯ inspect in the panel'
    : 'folding into the transcript'
  const footerRight = active ? (background ? '/subagents' : 'ctrl+shift+a') : ''
  return renderPanel(
    rows,
    title,
    right,
    footer,
    footerRight,
    panelTone(snapshots, background),
    theme,
    width,
  )
}

export function renderSubagentHudLines(
  snapshots: readonly SubagentSnapshot[],
  theme: SubagentTheme,
  width: number,
  now = Date.now(),
  parentModel?: string,
): string[] {
  const visible = snapshots.filter(
    (snapshot) =>
      snapshot.running ||
      (snapshot.endedAt !== undefined && now - snapshot.endedAt < SUBAGENT_SETTLE_LINGER_MS),
  )
  const foreground = visible.filter((snapshot) => !snapshot.background)
  const background = visible.filter((snapshot) => snapshot.background)
  return [
    ...(foreground.length === 0
      ? []
      : groupLines(foreground, false, theme, width, now, parentModel)),
    ...(background.length === 0
      ? []
      : groupLines(background, true, theme, width, now, parentModel)),
  ]
}

export class SubagentsWidget implements Component {
  constructor(
    private readonly getSnapshots: () => SubagentSnapshot[],
    private readonly theme: SubagentTheme,
    private readonly getParentModel: () => string | undefined = () => undefined,
  ) {}

  invalidate(): void {}

  render(width: number): string[] {
    return renderSubagentHudLines(
      this.getSnapshots(),
      this.theme,
      width,
      Date.now(),
      this.getParentModel(),
    )
  }
}
