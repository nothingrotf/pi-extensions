import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import type { GoalModeState, GoalStatus } from './state.ts'

const widgetKey = 'goal'

export type GoalOverlayTheme = Pick<Theme, 'bg' | 'bold' | 'fg'> & Partial<Pick<Theme, 'getBgAnsi'>>

function dockInset(width: number): number {
  return Math.min(3, Math.max(0, Math.floor(width) - 1))
}

function oneLine(value: string): string {
  return Array.from(stripTerminalSequences(value))
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
}

function compactNumber(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 100_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${Math.round(value / 1_000)}k`
}

function duration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds))
  if (safeSeconds < 60) return `${safeSeconds}s`
  const minutes = Math.floor(safeSeconds / 60)
  return `${minutes}m ${String(safeSeconds % 60).padStart(2, '0')}s`
}

function fitLine(line: string, width: number): string {
  const fitted = truncateToWidth(line, width, '…')
  return `${fitted}${' '.repeat(Math.max(0, width - visibleWidth(fitted)))}`
}

function panelTone(status: GoalStatus, enabled: boolean): 'accent' | 'muted' | 'warning' {
  if (status === 'stuck' || status === 'budget-limited') return 'warning'
  if (!enabled || status === 'paused') return 'muted'
  return 'accent'
}

function statusLabel(state: GoalModeState): string {
  if (!state.enabled) return state.goal.status
  if (state.loop.phase === 'reviewing') {
    return `reviewing ${state.loop.iteration + 1}/${state.loop.maxIterations}`
  }
  return `coding ${Math.min(state.loop.iteration + 1, state.loop.maxIterations)}/${state.loop.maxIterations}`
}

function tokenLabel(state: GoalModeState): string {
  const used = compactNumber(state.goal.tokensUsed)
  return state.goal.tokenBudget === undefined
    ? `${used} tokens`
    : `${used}/${compactNumber(state.goal.tokenBudget)} tokens`
}

function footerLabel(state: GoalModeState): string {
  if (state.goal.status === 'stuck') return state.loop.stopReason ?? 'goal stopped'
  if (!state.enabled || state.goal.status === 'paused') return 'paused · /goal resume'
  if (state.loop.phase === 'reviewing') return 'fresh independent review'
  if (state.goal.status === 'budget-limited') return 'token budget reached · final review'
  const verdict = state.loop.verdictHistory.at(-1)
  if (verdict !== undefined) return `${verdict.status} · correcting reviewer findings`
  return 'working toward reviewer PASS'
}

function renderPanel(
  body: string,
  title: string,
  titleRight: string,
  footer: string,
  tone: 'accent' | 'muted' | 'warning',
  theme: GoalOverlayTheme,
  width: number,
): string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const inset = dockInset(safeWidth)
  const innerWidth = safeWidth - inset
  const outer = ' '.repeat(inset)
  const line = (text: string) => `${outer}${truncateToWidth(text, innerWidth, '…')}`
  const columns = (left: string, right: string) => {
    const clippedLeft = truncateToWidth(left, innerWidth, '…')
    const rightWidth = Math.max(0, innerWidth - visibleWidth(clippedLeft) - 2)
    const clippedRight = truncateToWidth(right, rightWidth, '')
    if (clippedRight.length === 0) return line(clippedLeft)
    return line(`${fitLine(clippedLeft, innerWidth - visibleWidth(clippedRight))}${clippedRight}`)
  }
  const top = columns(theme.bold(theme.fg(tone, title)), theme.fg('dim', titleRight))
  const bottom = columns(theme.fg('dim', oneLine(footer)), theme.fg('dim', '/goal drop'))
  return [top, line(theme.fg('muted', oneLine(body))), bottom]
}

export function renderGoalHudLines(
  state: GoalModeState | undefined,
  theme: GoalOverlayTheme,
  width: number,
): string[] {
  if (state === undefined) return []
  const tone = panelTone(state.goal.status, state.enabled)
  const tokens = tokenLabel(state)
  const titleRight =
    width < 56
      ? tokens.replace(/ tokens$/, '')
      : `${tokens} · ${duration(state.goal.timeUsedSeconds)}`
  return renderPanel(
    state.goal.objective,
    `⟲ goal · ${statusLabel(state)} ▾`,
    titleRight,
    footerLabel(state),
    tone,
    theme,
    width,
  )
}

export class GoalOverlay {
  private tui: TUI | undefined
  private ui: ExtensionUIContext | undefined
  private widgetRegistered = false

  constructor(private readonly getState: () => GoalModeState | undefined) {}

  setUI(ui: ExtensionUIContext): void {
    this.ui = ui
  }

  update(): void {
    if (this.ui === undefined) return
    if (!this.widgetRegistered) {
      this.ui.setWidget(
        widgetKey,
        (tui, theme) => {
          this.tui = tui
          let cachedState: GoalModeState | undefined
          let cachedWidth: number | undefined
          let cachedLines: string[] = []
          return {
            invalidate: () => {
              cachedWidth = undefined
            },
            render: (width: number) => {
              const state = this.getState()
              if (cachedWidth !== width || cachedState !== state) {
                cachedLines = renderGoalHudLines(state, theme, width)
                cachedWidth = width
                cachedState = state
              }
              return cachedLines
            },
          }
        },
        { placement: 'aboveEditor' },
      )
      this.widgetRegistered = true
      return
    }
    this.tui?.requestRender()
  }

  dispose(): void {
    this.ui?.setWidget(widgetKey, undefined)
    this.tui = undefined
    this.ui = undefined
    this.widgetRegistered = false
  }
}
