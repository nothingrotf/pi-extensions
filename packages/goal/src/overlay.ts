import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import { stripTerminalSequences, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

import type { GoalModeState, GoalStatus } from './state.ts'

const widgetKey = 'goal'

export type GoalOverlayTheme = Pick<Theme, 'bg' | 'bold' | 'fg'> & Partial<Pick<Theme, 'getBgAnsi'>>

function dockInset(width: number): number {
  if (width >= 110) return 4
  if (width >= 80) return 3
  if (width >= 56) return 2
  return width >= 12 ? 1 : 0
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
  if (!enabled || status === 'paused') return 'muted'
  if (status === 'budget-limited') return 'warning'
  return 'accent'
}

function statusLabel(state: GoalModeState): string {
  return state.enabled ? state.goal.status : 'paused'
}

function tokenLabel(state: GoalModeState): string {
  const used = compactNumber(state.goal.tokensUsed)
  return state.goal.tokenBudget === undefined
    ? `${used} tokens`
    : `${used}/${compactNumber(state.goal.tokenBudget)} tokens`
}

function footerLabel(state: GoalModeState): string {
  if (!state.enabled || state.goal.status === 'paused') return 'paused · /goal resume'
  if (state.goal.status === 'budget-limited') return 'token budget reached'
  return 'continuing toward the objective'
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
  const panelWidth = Math.max(1, safeWidth - inset * 2)
  const outer = ' '.repeat(inset)
  const border = (text: string) => theme.fg(tone, text)
  const background = theme.getBgAnsi?.('toolPendingBg') ?? ''
  const surface = (content: string) =>
    `${outer}${theme.bg('toolPendingBg', content.replaceAll('\u001B[0m', `\u001B[0m${background}`))}`
  if (panelWidth < 8) return [surface(truncateToWidth(body, panelWidth, '…'))]

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
  const bodyLine = surface(
    `${border('│')}  ${fitLine(theme.fg('muted', ` ${oneLine(body)}`), innerWidth)}  ${border('│')}`,
  )
  const leftFooterText = truncateToWidth(
    footer,
    Math.max(0, Math.min(Math.floor(panelWidth * 0.6), panelWidth - 5)),
    '',
  )
  const rightFooterText = '/goal drop'
  const leftFooter = leftFooterText.length === 0 ? '' : ` ${theme.fg('dim', leftFooterText)} `
  const availableRight = Math.max(0, panelWidth - visibleWidth(leftFooter) - 8)
  const clippedRight = truncateToWidth(rightFooterText, availableRight, '')
  const rightFooter = clippedRight.length === 0 ? '' : ` ${theme.fg('dim', clippedRight)} `
  const bottomFill = '─'.repeat(
    Math.max(
      0,
      panelWidth -
        visibleWidth(leftFooter) -
        visibleWidth(rightFooter) -
        (rightFooter === '' ? 3 : 4),
    ),
  )
  const bottom =
    rightFooter === ''
      ? surface(`${border('╰─')}${leftFooter}${border(`${bottomFill}╯`)}`)
      : surface(`${border('╰─')}${leftFooter}${border(bottomFill)}${rightFooter}${border('─╯')}`)
  return [top, bodyLine, bottom]
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
          return {
            invalidate: () => undefined,
            render: (width: number) => renderGoalHudLines(this.getState(), theme, width),
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
