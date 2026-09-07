import { getCapabilities, hyperlink } from '@earendil-works/pi-tui'

import { ansiForeground, defaultHudPalette, type HudPalette, type Rgb } from './colors.ts'

export type ProseStyle = {
  bold?: boolean
  dim?: boolean
  fg?: Rgb
  fixed?: boolean
  italic?: boolean
  strike?: boolean
  underline?: boolean
}

export type ProseChunk = { link?: string; style: ProseStyle; text: string }

export type ProseStyleTable = {
  anchor: ProseStyle
  border: ProseStyle
  checked: ProseStyle
  code: ProseStyle
  codeBorder: ProseStyle
  deleted: ProseStyle
  emphasis: ProseStyle
  heading: ProseStyle
  linkLabel: ProseStyle
  linkUrl: ProseStyle
  listMarker: ProseStyle
  quote: ProseStyle
  strong: ProseStyle
  subheading: ProseStyle
  text: ProseStyle
  unchecked: ProseStyle
}

const styleCache = new WeakMap<HudPalette, ProseStyleTable>()

export function proseStyles(palette: HudPalette = defaultHudPalette): ProseStyleTable {
  const cached = styleCache.get(palette)
  if (cached !== undefined) return cached
  const table: ProseStyleTable = {
    anchor: { fg: palette.info, underline: true },
    border: { fg: palette.textFaint },
    checked: { fg: palette.success },
    code: { fg: palette.brand, fixed: true },
    codeBorder: { fg: palette.brand },
    deleted: { dim: true, fg: palette.textDim, strike: true },
    emphasis: { fg: palette.textSecondary, italic: true },
    heading: { bold: true, fg: palette.textPrimary },
    linkLabel: { fg: palette.brandAlt, fixed: true },
    linkUrl: { fg: palette.textDim },
    listMarker: { fg: palette.warning },
    quote: { fg: palette.textMuted, italic: true },
    strong: { bold: true, fg: palette.textPrimary },
    subheading: { bold: true, fg: palette.textSecondary },
    text: { fg: palette.textPrimary },
    unchecked: { fg: palette.textDim },
  }
  styleCache.set(palette, table)
  return table
}

export const proseReset = '\x1b[0m'

export function mergeStyle(parent: ProseStyle, child: ProseStyle): ProseStyle {
  const merged: ProseStyle = {}
  if (child.bold === true || parent.bold === true) merged.bold = true
  if (child.dim === true || parent.dim === true) merged.dim = true
  if (child.italic === true || parent.italic === true) merged.italic = true
  if (child.strike === true || parent.strike === true) merged.strike = true
  if (child.underline === true || parent.underline === true) merged.underline = true
  const inherit = parent.fixed === true && child.fixed !== true
  const fg = inherit ? parent.fg : (child.fg ?? parent.fg)
  if (fg !== undefined) merged.fg = fg
  if (parent.fixed === true || child.fixed === true) merged.fixed = true
  return merged
}

export function openStyle(style: ProseStyle): string {
  const codes: string[] = []
  if (style.bold === true) codes.push('1')
  if (style.dim === true) codes.push('2')
  if (style.italic === true) codes.push('3')
  if (style.underline === true) codes.push('4')
  if (style.strike === true) codes.push('9')
  const attributes = codes.length === 0 ? '' : `\x1b[${codes.join(';')}m`
  return `${attributes}${style.fg === undefined ? '' : ansiForeground(style.fg)}`
}

export function paint(text: string, style: ProseStyle): string {
  if (text.length === 0) return ''
  const open = openStyle(style)
  return open.length === 0 ? text : `${open}${text}${proseReset}`
}

export function serializeChunks(chunks: readonly ProseChunk[]): string {
  let output = ''
  for (const chunk of chunks) {
    if (chunk.text.length === 0) continue
    const painted = paint(chunk.text, chunk.style)
    output +=
      chunk.link !== undefined && getCapabilities().hyperlinks
        ? hyperlink(painted, chunk.link)
        : painted
  }
  return output
}
