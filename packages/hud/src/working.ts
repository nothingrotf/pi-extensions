import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, type TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { shimmerText } from './shimmer.ts'

export const workingMessageChannel = 'hud:working-message'
const widgetKey = 'hud-working'

const WorkingMessageSchema = Type.Union([Type.String({ minLength: 1 }), Type.Null()])

export function decodeWorkingMessage<Input>(data: Input): string | null | undefined {
  return Value.Check(WorkingMessageSchema, data) ? data : undefined
}

export const defaultWorkingMessage = 'waiting for the model'
const FRAME_MS = 33
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_ADVANCE_MS = 80

export function spinnerFrame(now: number): string {
  return SPINNER_FRAMES[Math.floor(now / SPINNER_ADVANCE_MS) % SPINNER_FRAMES.length] ?? '⠋'
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}m${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 > 0 ? `${hours}h${minutes % 60}m` : `${hours}h`
}

export class WorkingDock {
  private message: string | undefined
  private active = false
  private registered = false
  private tui: TUI | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private startedAt = Date.now()
  private usage: (() => string | undefined) | undefined

  setUsageSource(source: (() => string | undefined) | undefined): void {
    this.usage = source
  }

  setMessage(message: string | undefined): void {
    this.message = message
    this.tui?.requestRender()
  }

  reset(): void {
    this.startedAt = Date.now()
  }

  start(ui: ExtensionUIContext): void {
    this.active = true
    if (!this.registered) {
      this.registered = true
      ui.setWidget(widgetKey, (tui, theme) => this.mount(tui, theme), {
        placement: 'aboveEditor',
      })
    }
    this.startTicking()
    this.tui?.requestRender()
  }

  stop(): void {
    this.active = false
    this.stopTicking()
    this.tui?.requestRender()
  }

  dispose(ui: ExtensionUIContext | undefined): void {
    this.stop()
    if (this.registered) ui?.setWidget(widgetKey, undefined)
    this.registered = false
    this.tui = undefined
  }

  private text(): string {
    return this.message ?? defaultWorkingMessage
  }

  private startTicking(): void {
    if (this.timer !== undefined || this.tui === undefined) return
    this.timer = setInterval(() => this.tui?.requestRender(), FRAME_MS)
  }

  private stopTicking(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  private mount(tui: TUI, theme: Theme) {
    this.tui = tui
    if (this.active) this.startTicking()
    const widget = {
      dispose: () => this.stopTicking(),
      invalidate: () => undefined,
      render: (width: number): string[] => {
        if (!this.active) return []
        const now = Date.now()
        const text = `${this.text()} · ${formatElapsed(now - this.startedAt)}`
        const line = ` ${theme.fg('accent', spinnerFrame(now))} ${shimmerText(text, theme)}`
        const lines = [truncateToWidth(line, width, '…')]
        const usage = this.usage?.()
        if (usage !== undefined && usage.length > 0) {
          lines.push(truncateToWidth(` ${shimmerText(usage, theme)}`, width, '…'))
        }
        lines.push('')
        return lines
      },
    }
    return widget
  }
}
