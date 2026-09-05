import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'

export function questionUI(base: ExtensionUIContext): {
  ui: ExtensionUIContext
  opened: string[][]
  press(key: string): void
  close(): void
}
