import type { Theme } from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { railPaletteFromAnsi } from './colors.ts'
import { railLines, type RailStore, type RailTheme } from './rail.ts'

export const railEntryType = 'hud-rail'

const RailEntrySchema = Type.Object({ turn: Type.Integer({ minimum: 0 }) })

export function decodeRailEntry<Input>(data: Input): number | undefined {
  return Value.Check(RailEntrySchema, data) ? data.turn : undefined
}

const railIndent = ' '

export type RailThemeSource = Pick<Theme, 'fg'>

export function railTheme(theme: RailThemeSource): RailTheme {
  return {
    fg: (color, text) => theme.fg(color, text),
    palette: railPaletteFromAnsi(),
  }
}

export class RailComponent implements Component {
  private readonly theme: RailTheme

  constructor(
    private readonly resolve: () => RailStore | undefined,
    theme: RailThemeSource,
    private readonly expanded: boolean,
  ) {
    this.theme = railTheme(theme)
  }

  invalidate(): void {}

  render(width: number): string[] {
    const store = this.resolve()
    if (store === undefined) return []
    const inner = Math.max(1, width - railIndent.length)
    return railLines(store.groups(), this.theme, {
      expanded: this.expanded,
      width: inner,
    }).map((line) => `${railIndent}${truncateToWidth(line, inner, '')}`)
  }
}
