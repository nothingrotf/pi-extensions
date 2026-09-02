import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'

import { SubagentsWidget, taskLine } from './format.ts'
import { createPeekPane } from './peek.ts'
import type { SubagentRuntime } from './runtime.ts'

const WIDGET_THROTTLE_MS = 160

export class SubagentTui {
  private context: ExtensionContext | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private widgetTui: TUI | undefined

  constructor(private readonly runtime: SubagentRuntime) {
    runtime.subscribe(() => this.scheduleWidget())
  }

  sessionStart(ctx: ExtensionContext): void {
    this.context = ctx
  }

  agentStart(ctx: ExtensionContext): void {
    this.context = ctx
    this.ensureWidget(ctx)
  }

  sessionShutdown(ctx: ExtensionContext): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
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
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      const ctx = this.context
      try {
        if (ctx?.hasUI !== true) return
        this.ensureWidget(ctx)
        this.widgetTui?.requestRender()
      } catch {
        if (this.context === ctx) this.context = undefined
        this.widgetTui = undefined
      }
    }, WIDGET_THROTTLE_MS)
  }

  private ensureWidget(ctx: ExtensionContext): void {
    if (this.widgetTui !== undefined || !ctx.hasUI) return
    ctx.ui.setWidget(
      'subagents',
      (tui, theme) => {
        this.widgetTui = tui
        return new SubagentsWidget(() => this.runtime.listSnapshots(), theme)
      },
      { placement: 'aboveEditor' },
    )
  }

  private clearWidget(ctx: ExtensionContext): void {
    this.widgetTui = undefined
    if (ctx.hasUI) ctx.ui.setWidget('subagents', undefined)
  }
}
