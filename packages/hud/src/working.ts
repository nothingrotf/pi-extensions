import type { ExtensionUIContext, Theme } from '@earendil-works/pi-coding-agent'
import { Loader, type TUI } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const workingMessageChannel = 'hud:working-message'
const widgetKey = 'hud-working'

const WorkingMessageSchema = Type.Union([Type.String({ minLength: 1 }), Type.Null()])

export function decodeWorkingMessage<Input>(data: Input): string | null | undefined {
  return Value.Check(WorkingMessageSchema, data) ? data : undefined
}

export const defaultWorkingMessage = 'Working...'

export class WorkingDock {
  private message: string | undefined
  private active = false
  private registered = false
  private loader: Loader | undefined
  private tui: TUI | undefined

  setMessage(message: string | undefined): void {
    this.message = message
    this.loader?.setMessage(this.text())
    this.tui?.requestRender()
  }

  start(ui: ExtensionUIContext): void {
    this.active = true
    if (!this.registered) {
      this.registered = true
      ui.setWidget(widgetKey, (tui, theme) => this.mount(tui, theme), {
        placement: 'aboveEditor',
      })
    }
    this.loader?.start()
    this.tui?.requestRender()
  }

  stop(): void {
    this.active = false
    this.loader?.stop()
    this.tui?.requestRender()
  }

  dispose(ui: ExtensionUIContext | undefined): void {
    this.stop()
    if (this.registered) ui?.setWidget(widgetKey, undefined)
    this.registered = false
    this.loader = undefined
    this.tui = undefined
  }

  private text(): string {
    return this.message ?? defaultWorkingMessage
  }

  private mount(tui: TUI, theme: Theme) {
    this.tui = tui
    const loader = new Loader(
      tui,
      (spinner) => theme.fg('accent', spinner),
      (text) => theme.fg('muted', text),
      this.text(),
    )
    this.loader = loader
    if (this.active) loader.start()
    return {
      dispose: () => loader.stop(),
      invalidate: () => loader.invalidate(),
      render: (width: number): string[] => (this.active ? loader.render(width) : []),
    }
  }
}
