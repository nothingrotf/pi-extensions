import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, type TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { shimmerTextAtTick, shimmerTickMs } from './shimmer.ts'

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
  private initialTick: number | undefined
  private owner: ExtensionUIContext | undefined
  private tui: TUI | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private startedAt = Date.now()

  constructor(private readonly tick: () => number = () => Math.floor(Date.now() / shimmerTickMs)) {}

  setMessage(message: string | undefined): void {
    this.message = message
    this.tui?.requestRender()
  }

  reset(): void {
    this.startedAt = Date.now()
  }

  start(ui: ExtensionUIContext): void {
    if (!this.active) this.initialTick = this.tick()
    this.active = true
    if (!this.registered) {
      this.registered = true
      this.owner = ui
      ui.setWidget(widgetKey, (tui, theme) => this.mount(tui, theme), {
        placement: 'aboveEditor',
      })
    }
    this.startTicking()
    this.tui?.requestRender()
  }

  stop(): void {
    this.active = false
    this.initialTick = undefined
    this.stopTicking()
    this.tui?.requestRender()
  }

  dispose(ui: ExtensionUIContext | undefined): void {
    this.stop()
    if (this.registered) (this.owner ?? ui)?.setWidget(widgetKey, undefined)
    this.owner = undefined
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
        const currentTick = this.tick()
        const shimmer =
          currentTick === this.initialTick
            ? theme.fg('dim', text)
            : shimmerTextAtTick(
                text,
                { baseAnsi: theme.getFgAnsi('dim'), tintAnsi: theme.getFgAnsi('accent') },
                currentTick,
              )
        const line = ` ${theme.fg('accent', spinnerFrame(now))} ${shimmer}`
        return [truncateToWidth(line, width, '…'), '']
      },
    }
    return widget
  }
}
