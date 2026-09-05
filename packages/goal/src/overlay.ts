import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'
import {
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'

import type { GoalActivity } from './activity.ts'
import type { GoalModeState, GoalStatus } from './state.ts'

export interface GoalLiveView {
  activity: GoalActivity | undefined
  usage: { tokensUsed: number; timeUsedSeconds: number } | undefined
}

const widgetKey = 'goal'

export type GoalOverlayTheme = Pick<Theme, 'bg' | 'bold' | 'fg'> & Partial<Pick<Theme, 'getBgAnsi'>>

function dockInset(width: number): number {
  return Math.min(3, Math.max(0, Math.floor((Math.floor(width) - 1) / 2)))
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

function statusLabel(state: GoalModeState, activity?: GoalActivity): string {
  if (!state.enabled) return state.goal.status
  const phase = activity?.phase ?? (state.loop.phase === 'between' ? 'waiting' : state.loop.phase)
  const label =
    phase === 'starting-reviewer' ? 'starting reviewer' : phase === 'checks' ? 'checking' : phase
  return `${label} ${Math.min(state.loop.iteration + 1, state.loop.maxIterations)}/${state.loop.maxIterations}`
}

function tokenLabel(state: GoalModeState, usedTokens = state.goal.tokensUsed): string {
  const used = compactNumber(usedTokens)
  return state.goal.tokenBudget === undefined
    ? `${used} tokens`
    : `${used}/${compactNumber(state.goal.tokenBudget)} tokens`
}

function footerLabel(state: GoalModeState, activity?: GoalActivity): string {
  if (state.goal.status === 'stuck') return state.loop.stopReason ?? 'goal stopped'
  if (!state.enabled || state.goal.status === 'paused') return 'paused · /goal resume'
  if (activity?.phase === 'waiting' || activity?.phase === 'queued') return activity.detail
  if (state.loop.phase === 'between') return 'Goal open · awaiting automatic continuation'
  if (state.loop.phase === 'reviewing')
    return 'Goal open · fresh independent review · type to steer'
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
  details: readonly string[] = [],
): string[] {
  const safeWidth = Math.max(1, Math.floor(width))
  const inset = dockInset(safeWidth)
  const innerWidth = safeWidth - inset * 2
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
  const bodyLines = wrapTextWithAnsi(oneLine(body), innerWidth).map(
    (text) => `${outer}${theme.fg('muted', truncateToWidth(text, innerWidth, ''))}`,
  )
  return [top, ...bodyLines, ...details.map(line), bottom, '']
}

export function renderGoalHudLines(
  state: GoalModeState | undefined,
  theme: GoalOverlayTheme,
  width: number,
  live?: GoalLiveView,
  now = Date.now(),
): string[] {
  if (state === undefined || width < 1) return []
  const tone = panelTone(state.goal.status, state.enabled)
  const activity =
    state.enabled && live?.activity?.goalId === state.goal.id ? live.activity : undefined
  const reviewTokens = state.loop.phase === 'reviewing' ? (activity?.tokens ?? 0) : 0
  const tokens = tokenLabel(
    state,
    (live?.usage?.tokensUsed ?? state.goal.tokensUsed) + reviewTokens,
  )
  const seconds = live?.usage?.timeUsedSeconds ?? state.goal.timeUsedSeconds
  const titleRight =
    width < 56 ? tokens.replace(/ tokens$/, '') : `${tokens} · ${duration(seconds)}`
  const details: string[] = []
  let glyph = '⟲'
  if (activity !== undefined) {
    const busy = ['coding', 'checks', 'starting-reviewer', 'reviewing'].includes(activity.phase)
    const elapsed = duration((now - activity.startedAt) / 1000)
    if (busy)
      glyph = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'][Math.floor(now / 150) % 10] ?? '⠋'
    const dots = Array.from({ length: state.loop.maxIterations }, (_value, index) => {
      const verdict =
        state.loop.verdictHistory[index - (state.loop.iteration - state.loop.verdictHistory.length)]
      if (index < state.loop.iteration && verdict === undefined) return theme.fg('dim', '•')
      if (index < state.loop.iteration)
        return theme.fg(
          verdict?.status === 'PASS' ? 'success' : verdict?.status === 'FAIL' ? 'error' : 'warning',
          '●',
        )
      return theme.fg(
        index === state.loop.iteration ? 'accent' : 'dim',
        index === state.loop.iteration ? '◉' : '○',
      )
    }).join(' ')
    details.push(
      width < 80
        ? `${dots}  ${state.loop.iteration} reviewed · ${elapsed}`
        : `${dots}  ${state.loop.iteration} reviews completed · ${elapsed} in this phase`,
    )
    if (activity.phase === 'coding') details.push(theme.fg('muted', oneLine(activity.detail)))
    for (const check of activity.checks) {
      const icon =
        check.status === 'running'
          ? glyph
          : check.status === 'passed'
            ? '✓'
            : check.status === 'failed'
              ? '✗'
              : '○'
      const seconds =
        check.durationMs === undefined ? (now - check.startedAt) / 1000 : check.durationMs / 1000
      const label = `${icon} ${oneLine(check.label)} · ${check.status} · ${duration(seconds)}`
      details.push(
        theme.fg(
          check.status === 'failed' ? 'error' : check.status === 'passed' ? 'success' : 'muted',
          label,
        ),
      )
    }
    if (activity.phase === 'reviewing' || activity.phase === 'starting-reviewer') {
      details.push(
        theme.fg(
          'accent',
          `${glyph} reviewer · ${width >= 80 ? `${oneLine(activity.model ?? state.loop.reviewModel ?? 'parent model')} · ` : ''}${oneLine(activity.tool ?? (activity.phase === 'starting-reviewer' ? 'starting' : 'awaiting response'))} · ${compactNumber(activity.tokens)} tokens`,
        ),
      )
    }
    if (busy && now - activity.updatedAt >= 6000)
      details.push(
        theme.fg('dim', `No new activity event for ${duration((now - activity.updatedAt) / 1000)}`),
      )
  }
  const verdict = state.loop.verdictHistory.at(-1)
  if (verdict !== undefined && (!state.enabled || state.loop.phase !== 'reviewing')) {
    details.push(
      theme.fg(
        verdict.status === 'FAIL' ? 'warning' : 'muted',
        `Last review: ${verdict.status} · ${oneLine(verdict.reason)}`,
      ),
    )
  }
  return renderPanel(
    state.goal.objective,
    `${glyph} goal · ${statusLabel(state, activity)} ▾`,
    titleRight,
    footerLabel(state, activity),
    tone,
    theme,
    width,
    details,
  )
}

export class GoalOverlay {
  private tui: TUI | undefined
  private ui: ExtensionUIContext | undefined
  private widgetRegistered = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly getState: () => GoalModeState | undefined,
    private readonly getLive: () => GoalLiveView | undefined = () => undefined,
  ) {}

  private tick(): void {
    if (this.timer !== undefined || this.ui === undefined || this.getState()?.enabled !== true)
      return
    const activity = this.getLive()?.activity
    const recent = activity !== undefined && Date.now() - activity.updatedAt < 6000
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        this.tui?.requestRender()
        this.tick()
      },
      recent && activity.phase !== 'waiting' && activity.phase !== 'queued' ? 150 : 1000,
    )
    this.timer.unref?.()
  }

  setUI(ui: ExtensionUIContext): void {
    if (this.ui !== undefined && this.ui !== ui) this.dispose()
    this.ui = ui
  }

  update(): void {
    if (this.ui === undefined) return
    if (this.getState()?.enabled !== true && this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    this.tick()
    if (!this.widgetRegistered) {
      this.ui.setWidget(
        widgetKey,
        (tui, theme) => {
          this.tui = tui
          let cachedState: GoalModeState | undefined
          let cachedWidth: number | undefined
          let cachedLines: string[] = []
          let cachedActivity: GoalActivity | undefined
          let cachedTick: number | undefined
          return {
            invalidate: () => {
              cachedWidth = undefined
            },
            render: (width: number) => {
              const state = this.getState()
              const live = this.getLive()
              const now = Date.now()
              const tick = state?.enabled === true ? Math.floor(now / 150) : 0
              if (
                cachedWidth !== width ||
                cachedState !== state ||
                cachedActivity !== live?.activity ||
                cachedTick !== tick
              ) {
                cachedLines = renderGoalHudLines(state, theme, width, live, now)
                cachedWidth = width
                cachedState = state
                cachedActivity = live?.activity
                cachedTick = tick
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
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.ui?.setWidget(widgetKey, undefined)
    this.tui = undefined
    this.ui = undefined
    this.widgetRegistered = false
  }
}
