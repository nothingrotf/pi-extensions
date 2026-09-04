import type { Theme } from '@earendil-works/pi-coding-agent'
import { type Component, truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { railPaletteFromAnsi, tint } from './colors.ts'
import { railLines, type RailStore, type RailTheme } from './rail.ts'
import { shimmerTextAtTick, shimmerTickMs } from './shimmer.ts'

export const railEntryType = 'hud-rail'

const RailEntrySchema = Type.Object({ turn: Type.Integer({ minimum: 0 }) })

export function decodeRailEntry<Input>(data: Input): number | undefined {
  return Value.Check(RailEntrySchema, data) ? data.turn : undefined
}

const railIndent = ' '
const railGutter = 2

export type RailThemeSource = Pick<Theme, 'fg'> & Partial<Pick<Theme, 'getFgAnsi'>>

export type RailUsage = {
  row: string | undefined
  shimmer: boolean
  tick?: number
}

export function railTheme(theme: RailThemeSource): RailTheme {
  return {
    fg: (color, text) => theme.fg(color, text),
    palette: railPaletteFromAnsi(),
  }
}

export class RailUsageLine {
  private initialTick: number | undefined
  private readonly theme: RailTheme

  constructor(
    theme: RailThemeSource,
    private readonly source: RailThemeSource = theme,
  ) {
    this.theme = railTheme(theme)
  }

  render(usage: RailUsage): string | undefined {
    const { row, shimmer, tick } = usage
    if (row === undefined || row.length === 0) {
      this.initialTick = undefined
      return undefined
    }
    const getFgAnsi = this.source.getFgAnsi?.bind(this.source)
    if (!shimmer || getFgAnsi === undefined) {
      this.initialTick = undefined
      return tint(this.theme.palette, 'dim', row)
    }
    const currentTick = tick ?? Math.floor(Date.now() / shimmerTickMs)
    if (this.initialTick === undefined) this.initialTick = currentTick
    const baseAnsi = getFgAnsi('dim')
    if (currentTick === this.initialTick) return `${baseAnsi}${row}\x1b[39m`
    return shimmerTextAtTick(
      row,
      { baseAnsi, tintAnsi: getFgAnsi('customMessageLabel') },
      currentTick,
    )
  }
}

export class RailComponent implements Component {
  private readonly theme: RailTheme
  private readonly usageLine: RailUsageLine

  constructor(
    private readonly resolve: () => RailStore | undefined,
    theme: RailThemeSource,
    private readonly expanded: boolean,
    private readonly pending: () => boolean = () => false,
    private readonly usage: () => RailUsage = () => ({ row: undefined, shimmer: false }),
    private readonly source?: RailThemeSource,
    private readonly visible: () => boolean = () => true,
  ) {
    this.theme = railTheme(theme)
    this.source = source ?? theme
    this.usageLine = new RailUsageLine(theme, this.source)
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (!this.visible()) return []
    const store = this.resolve()
    if (store === undefined) return []
    const inner = Math.max(1, width - railIndent.length - railGutter)
    const usage = this.usage()
    return railLines(store.groups(), this.theme, {
      expanded: this.expanded,
      pending: this.pending(),
      tick: usage.tick,
      usage: this.usageLine.render(usage) ?? '',
      width: inner,
    }).map((line) => (line.length === 0 ? '' : `${railIndent}${truncateToWidth(line, inner, '')}`))
  }
}
