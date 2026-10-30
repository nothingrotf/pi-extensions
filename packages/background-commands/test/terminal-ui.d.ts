import type { ExtensionUIContext, WidgetPlacement } from '@earendil-works/pi-coding-agent'
import type { Component, OverlayOptions } from '@earendil-works/pi-tui'

export function terminalUI(): {
  wrap(base: ExtensionUIContext): ExtensionUIContext
  widget(key: string): { component: Component; placement: WidgetPlacement | undefined } | undefined
  notices: string[]
  overlays: Array<{ overlay?: boolean; overlayOptions?: OverlayOptions } | undefined>
  pane(width: number): string[] | undefined
  press(key: string): void
  close(): void
}
