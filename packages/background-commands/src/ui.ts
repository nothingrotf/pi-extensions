import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { TUI } from '@earendil-works/pi-tui'

import { CommandsDock, dockSnapshots, SETTLE_LINGER_MS, type CommandsView } from './dock.ts'
import { isActive, oneLine } from './format.ts'
import { createCommandsPane, peekHeight } from './peek.ts'
import { isTerminal, type CommandSnapshot } from './schema.ts'

export const widgetKey = 'background-commands'
const PULSE_MS = 1_000

export interface CommandsControl extends CommandsView {
  stop(id: string): CommandSnapshot | undefined
}

export class CommandsTui {
  private context: ExtensionContext | undefined
  private widgetTui: TUI | undefined
  private registered = false
  private pulse: ReturnType<typeof setInterval> | undefined
  private expiry: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly control: CommandsControl) {}

  attach(ctx: ExtensionContext): void {
    this.context = ctx
    if (ctx.mode !== 'tui') return
    if (!this.registered) {
      this.registered = true
      ctx.ui.setWidget(
        widgetKey,
        (tui, theme) => {
          this.widgetTui = tui
          return new CommandsDock(this.control, theme)
        },
        { placement: 'aboveEditor' },
      )
    }
    this.changed()
  }

  detach(): void {
    this.clearTimers()
    const ctx = this.context
    this.context = undefined
    this.widgetTui = undefined
    if (!this.registered) return
    this.registered = false
    if (ctx?.mode === 'tui') ctx.ui.setWidget(widgetKey, undefined)
  }

  changed(): void {
    if (this.context?.mode !== 'tui') return
    this.widgetTui?.requestRender()
    this.syncTimers()
  }

  async open(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return
    if (this.control.list().length === 0) {
      ctx.ui.notify('No background commands in this session.', 'info')
      return
    }
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        createCommandsPane({
          view: this.control,
          theme,
          requestRender: () => tui.requestRender(),
          close: () => done(undefined),
          stop: (snapshot) => {
            const result = this.control.stop(snapshot.id)
            if (result !== undefined)
              ctx.ui.notify(`Stop requested for ${oneLine(snapshot.name)}.`, 'warning')
          },
          height: () => peekHeight(tui.terminal.rows),
        }),
      {
        overlay: true,
        overlayOptions: { anchor: 'center', margin: 1, maxHeight: '85%', width: '90%' },
      },
    )
  }

  private syncTimers(): void {
    const now = Date.now()
    const snapshots = this.control.list()
    const active = snapshots.some(isActive)
    if (active && this.pulse === undefined) {
      this.pulse = setInterval(() => this.widgetTui?.requestRender(), PULSE_MS)
      this.pulse.unref?.()
    } else if (!active && this.pulse !== undefined) {
      clearInterval(this.pulse)
      this.pulse = undefined
    }
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    this.expiry = undefined
    const delay = dockSnapshots(snapshots, now)
      .filter(isTerminal)
      .map((snapshot) => snapshot.finishedAt + SETTLE_LINGER_MS - now)
      .reduce((least, value) => Math.min(least, value), Number.POSITIVE_INFINITY)
    if (!Number.isFinite(delay)) return
    this.expiry = setTimeout(
      () => {
        this.expiry = undefined
        this.changed()
      },
      Math.max(0, delay),
    )
    this.expiry.unref?.()
  }

  private clearTimers(): void {
    if (this.pulse !== undefined) clearInterval(this.pulse)
    if (this.expiry !== undefined) clearTimeout(this.expiry)
    this.pulse = undefined
    this.expiry = undefined
  }
}
