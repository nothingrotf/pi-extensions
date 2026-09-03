import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import { formatCwd, sanitizeScalar } from './format.ts'
import type { GitStatus } from './git.ts'
import type { UsageSnapshot, UsageWindow } from './usage.ts'

export type ThinkingColor =
  | 'thinkingHigh'
  | 'thinkingLow'
  | 'thinkingMax'
  | 'thinkingMedium'
  | 'thinkingMinimal'
  | 'thinkingOff'
  | 'thinkingXhigh'

export type HudColor =
  | 'accent'
  | 'dim'
  | 'error'
  | 'muted'
  | 'success'
  | 'text'
  | 'warning'
  | ThinkingColor

export type HudTheme = {
  fg: (color: HudColor, text: string) => string
}

export type HudState = {
  cwd: string
  git: GitStatus
  providerLabel: string
  modelLabel: string
  effortLabel: string
  effortLevel: string
  contextLabel: string
  contextPercent: number | null
  usage: UsageSnapshot | null
}

export const goalStatusKey = 'pi-goal'

function color(theme: HudTheme, token: HudColor, text: string): string {
  try {
    return theme.fg(token, text)
  } catch {
    return text
  }
}

const thinkingColors: ReadonlyMap<string, ThinkingColor> = new Map([
  ['minimal', 'thinkingMinimal'],
  ['low', 'thinkingLow'],
  ['medium', 'thinkingMedium'],
  ['high', 'thinkingHigh'],
  ['xhigh', 'thinkingXhigh'],
  ['max', 'thinkingMax'],
])

export function effortColor(level: string): ThinkingColor {
  return thinkingColors.get(sanitizeScalar(level).toLowerCase()) ?? 'thinkingOff'
}

function loadColor(percent: number): HudColor {
  const value = Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
  if (value >= 90) {
    return 'error'
  }
  if (value >= 70) {
    return 'warning'
  }
  if (value >= 50) {
    return 'accent'
  }
  return 'success'
}

function justify(left: string, right: string, width: number): string {
  const available = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
  const leftWidth = visibleWidth(left)
  const rightWidth = visibleWidth(right)
  if (leftWidth + 1 + rightWidth <= available) {
    return `${left}${' '.repeat(Math.max(0, available - leftWidth - rightWidth))}${right}`
  }
  if (rightWidth + 2 <= available) {
    return justify(truncateToWidth(left, available - rightWidth - 1, '…'), right, available)
  }
  return truncateToWidth(right || left, available, '')
}

function row(theme: HudTheme, width: number, left: string, right: string): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
  if (safeWidth === 0) {
    return ''
  }
  const outer = safeWidth >= 2 ? 1 : 0
  const inner = Math.max(0, safeWidth - outer * 2)
  const line = `${' '.repeat(outer)}${justify(left, right, inner)}${' '.repeat(outer)}`
  return truncateToWidth(line.replace(/[\r\n]/gu, ' '), safeWidth, '')
}

export function branchSegment(theme: HudTheme, git: GitStatus): string {
  if (!git.branch) {
    return ''
  }
  const flags: string[] = []
  if (git.conflicted) flags.push(`=${git.conflicted}`)
  if (git.staged) flags.push(`+${git.staged}`)
  if (git.modified) flags.push(`!${git.modified}`)
  if (git.added) flags.push(`A${git.added}`)
  if (git.deleted) flags.push(`D${git.deleted}`)
  if (git.renamed) flags.push(`R${git.renamed}`)
  if (git.copied) flags.push(`C${git.copied}`)
  if (git.untracked) flags.push(`?${git.untracked}`)
  if (git.ahead) flags.push(`↑${git.ahead}`)
  if (git.behind) flags.push(`↓${git.behind}`)
  const token = git.dirty ? 'warning' : 'success'
  const branch = color(theme, token, sanitizeScalar(git.branch))
  return flags.length > 0 ? `${branch} ${color(theme, 'dim', `[${flags.join(' ')}]`)}` : branch
}

export const loopStatusKey = 'pi-loop'

export function goalSegment(theme: HudTheme, statuses: ReadonlyMap<string, string>): string {
  const text = sanitizeScalar(statuses.get(goalStatusKey))
  if (!text) {
    return ''
  }
  const glyph = /achieved|complete/iu.test(text)
    ? '✔'
    : /paused/iu.test(text)
      ? '⏸'
      : /budget-limited|attention|unmet/iu.test(text)
        ? '⚠'
        : /abandoned|dropped/iu.test(text)
          ? '⏹'
          : '🎯'
  const token: HudColor =
    glyph === '✔' ? 'success' : glyph === '⏹' ? 'dim' : glyph === '🎯' ? 'accent' : 'warning'
  return color(theme, token, `${glyph} ${text}`)
}

export function loopSegment(theme: HudTheme, statuses: ReadonlyMap<string, string>): string {
  const text = sanitizeScalar(statuses.get(loopStatusKey))
  if (!text) {
    return ''
  }
  const paused = /paused/iu.test(text)
  return color(theme, paused ? 'warning' : 'accent', `${paused ? '⏸' : '↻'} ${text}`)
}

export function usageSegment(theme: HudTheme, usage: UsageSnapshot | null): string {
  if (!usage?.windows.length) {
    return ''
  }
  return usage.windows
    .map((window: UsageWindow) => {
      const percent = normalizeUsage(window.usedPercent)
      const reset = sanitizeScalar(window.resetsIn)
      const resetText = reset ? ` ${color(theme, 'dim', reset)}` : ''
      return `${color(theme, 'dim', sanitizeScalar(window.label))} ${color(theme, loadColor(percent), `${Math.round(percent)}%`)}${resetText}`
    })
    .join('   ')
}

function normalizeUsage(percent: number): number {
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0
}

function modelSegment(theme: HudTheme, state: HudState): string {
  const provider = sanitizeScalar(state.providerLabel)
  const model = sanitizeScalar(state.modelLabel)
  if (!provider || !model || model === 'no-model') {
    return ''
  }
  const identity = `${color(theme, 'muted', provider)}${color(theme, 'muted', '/')}${color(theme, 'text', model)}`
  const effort = sanitizeScalar(state.effortLabel)
  return effort
    ? `${identity} ${color(theme, effortColor(state.effortLevel), `(${effort})`)}`
    : identity
}

export function renderHud(
  theme: HudTheme,
  state: HudState,
  statuses: ReadonlyMap<string, string>,
  width: number,
): string[] {
  const separator = color(theme, 'dim', ' · ')
  const workspace = color(theme, 'accent', sanitizeScalar(formatCwd(state.cwd)))
  const branch = branchSegment(theme, state.git)
  const identity = modelSegment(theme, state)
  const goal = goalSegment(theme, statuses)
  const loop = loopSegment(theme, statuses)
  const contextToken = state.contextPercent === null ? 'dim' : loadColor(state.contextPercent)
  const context = color(theme, contextToken, sanitizeScalar(state.contextLabel))
  const usage = usageSegment(theme, state.usage)
  const left = [workspace, branch, identity, goal, loop].filter(Boolean).join(separator)
  const right = [usage, context].filter(Boolean).join(separator)
  return [row(theme, width, left, right)]
}
