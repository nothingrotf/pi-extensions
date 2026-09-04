import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'

import { SUBAGENT_SETTLE_LINGER_MS, SubagentsWidget, taskLine } from './format.ts'
import { createPeekPane } from './peek.ts'
import type { SubagentRuntime } from './runtime.ts'

const WIDGET_THROTTLE_MS = 160

export class SubagentTui {
  private context: ExtensionContext | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private pulseTimer: ReturnType<typeof setInterval> | undefined
  private expiryTimer: ReturnType<typeof setTimeout> | undefined
  private widgetTui: TUI | undefined

  constructor(private readonly runtime: SubagentRuntime) {
    runtime.subscribe(() => this.scheduleWidget())
  }

  sessionStart(ctx: ExtensionContext): void {
    this.context = ctx
    if (ctx.mode !== 'tui') return
    this.ensureWidget(ctx)
    this.syncWidgetTimers()
  }

  agentStart(ctx: ExtensionContext): void {
    this.context = ctx
    if (ctx.mode !== 'tui') return
    this.ensureWidget(ctx)
    this.syncWidgetTimers()
  }

  sessionShutdown(ctx: ExtensionContext): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.pulseTimer !== undefined) clearInterval(this.pulseTimer)
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
    this.timer = undefined
    this.pulseTimer = undefined
    this.expiryTimer = undefined
    this.clearWidget(ctx)
    this.context = undefined
  }

  list(ctx: ExtensionContext): void {
    const snapshots = this.runtime.listSnapshots().slice(0, 10)
    if (snapshots.length === 0) {
      ctx.ui.notify('No subagents in this session.', 'info')
      return
    }
    ctx.ui.notify(snapshots.map(taskLine).join('\n'), 'info')
  }

  async openPeek(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return
    if (this.runtime.listSnapshots().length === 0) {
      ctx.ui.notify('No subagents in this session.', 'info')
      return
    }
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        createPeekPane(
          () => this.runtime.listSnapshots(),
          theme,
          () => tui.requestRender(),
          () => done(undefined),
          (snapshot) => {
            this.runtime
              .cancel(snapshot.agentId)
              .then((aborted) => {
                if (aborted) {
                  ctx.ui.notify(`Aborted subagent ${snapshot.description}.`, 'warning')
                }
              })
              .catch((error) => ctx.ui.notify(String(error), 'error'))
          },
        ),
      {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          margin: 2,
          maxHeight: '70%',
          minWidth: 60,
          width: '70%',
        },
      },
    )
  }

  private scheduleWidget(): void {
    if (this.context?.mode !== 'tui' || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const ctx = this.context
      try {
        if (ctx?.mode !== 'tui') return
        this.ensureWidget(ctx)
        this.widgetTui?.requestRender()
        this.syncWidgetTimers()
      } catch {
        if (this.context === ctx) this.context = undefined
        this.widgetTui = undefined
      }
    }, WIDGET_THROTTLE_MS)
  }

  private syncWidgetTimers(): void {
    if (this.context?.mode !== 'tui') return
    const snapshots = this.runtime.listSnapshots()
    const active = snapshots.some((snapshot) => snapshot.running)
    if (active && this.pulseTimer === undefined) {
      this.pulseTimer = setInterval(() => this.widgetTui?.requestRender(), WIDGET_THROTTLE_MS)
      this.pulseTimer.unref?.()
    } else if (!active && this.pulseTimer !== undefined) {
      clearInterval(this.pulseTimer)
      this.pulseTimer = undefined
    }
    if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
    this.expiryTimer = undefined
    const now = Date.now()
    const expiry = snapshots
      .filter((snapshot) => !snapshot.running && snapshot.endedAt !== undefined)
      .map((snapshot) => (snapshot.endedAt ?? now) + SUBAGENT_SETTLE_LINGER_MS - now)
      .filter((delay) => delay > 0)
      .sort((left, right) => left - right)[0]
    if (expiry === undefined) return
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = undefined
      this.widgetTui?.requestRender()
      this.syncWidgetTimers()
    }, expiry)
    this.expiryTimer.unref?.()
  }

  private ensureWidget(ctx: ExtensionContext): void {
    if (this.widgetTui !== undefined || ctx.mode !== 'tui') return
    ctx.ui.setWidget(
      'subagents',
      (tui, theme) => {
        this.widgetTui = tui
        return new SubagentsWidget(
          () => this.runtime.listSnapshots(),
          theme,
          () => this.context?.model?.id,
        )
      },
      { placement: 'aboveEditor' },
    )
  }

  private clearWidget(ctx: ExtensionContext): void {
    this.widgetTui = undefined
    if (ctx.hasUI) ctx.ui.setWidget('subagents', undefined)
  }
}
