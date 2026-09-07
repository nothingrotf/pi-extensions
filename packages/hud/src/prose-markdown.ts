import {
  Marked,
  renderLatex,
  type Component,
  type Token,
  type Tokens,
  visibleWidth,
  wrapTextWithAnsi,
} from '@earendil-works/pi-tui'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { defaultHudPalette, type HudPalette } from './colors.ts'
import { type FileResolver, linkifyMarkdown } from './prose-links.ts'
import { stabilizeMarkdown } from './prose-stream.ts'
import {
  mergeStyle,
  paint,
  type ProseChunk,
  type ProseStyle,
  proseStyles,
  type ProseStyleTable,
  serializeChunks,
} from './prose-style.ts'

export type ProseHighlighter = (code: string, lang?: string) => string[] | undefined

export type ProseMarkdownOptions = {
  cwd: () => string
  highlight?: ProseHighlighter
  palette?: () => HudPalette
  resolve: FileResolver
  revision: () => number
  streaming: () => boolean
}

const LatexTokenSchema = Type.Object({
  display: Type.Boolean(),
  raw: Type.String(),
  text: Type.String(),
  type: Type.Literal('latex'),
})
const TokenChildrenSchema = Type.Object({ tokens: Type.Array(Type.Unknown()) })
const TokenTextSchema = Type.Object({ text: Type.String() })
const HeadingTokenSchema = Type.Object({ depth: Type.Number(), type: Type.Literal('heading') })
const CodeTokenSchema = Type.Object({ text: Type.String(), type: Type.Literal('code') })
const ListTokenSchema = Type.Object({
  items: Type.Array(Type.Unknown()),
  type: Type.Literal('list'),
})
const TableTokenSchema = Type.Object({
  header: Type.Array(Type.Unknown()),
  rows: Type.Array(Type.Unknown()),
  type: Type.Literal('table'),
})
const LinkTokenSchema = Type.Object({
  href: Type.String(),
  text: Type.String(),
  type: Type.Union([Type.Literal('link'), Type.Literal('image')]),
})

type LatexToken = Static<typeof LatexTokenSchema>

function latexToken(raw: string, text: string, display: boolean): LatexToken {
  return { display, raw, text, type: 'latex' }
}

function closingIndex(source: string, closing: string, start: number): number {
  let index = source.indexOf(closing, start)
  while (index >= 0 && source[index - 1] === '\\') index = source.indexOf(closing, index + 1)
  return index
}

const latexBlock = {
  level: 'block' as const,
  name: 'latexBlock',
  start(source: string): number | undefined {
    const match = /(?:^|\n) {0,3}(?:\$\$|\\\[)/u.exec(source)
    return match === null ? undefined : match.index + (match[0].startsWith('\n') ? 1 : 0)
  },
  tokenizer(source: string): LatexToken | undefined {
    const dollar = /^ {0,3}\$\$[ \t]*\n?([\s\S]*?)\$\$[ \t]*(?:\n|$)/u.exec(source)
    if (dollar?.[1] !== undefined && dollar[1].trim().length > 0) {
      return latexToken(dollar[0], dollar[1].trim(), true)
    }
    const bracket = /^ {0,3}\\\[[ \t]*\n?([\s\S]*?)\\\][ \t]*(?:\n|$)/u.exec(source)
    if (bracket?.[1] !== undefined && bracket[1].trim().length > 0) {
      return latexToken(bracket[0], bracket[1].trim(), true)
    }
    return undefined
  },
}

const latexInline = {
  level: 'inline' as const,
  name: 'latex',
  start(source: string): number | undefined {
    const indices = [source.indexOf('$$'), source.indexOf('\\(')].filter((index) => index >= 0)
    return indices.length === 0 ? undefined : Math.min(...indices)
  },
  tokenizer(source: string): LatexToken | undefined {
    const opening = source.startsWith('$$') ? '$$' : source.startsWith('\\(') ? '\\(' : undefined
    if (opening === undefined) return undefined
    const closing = opening === '$$' ? '$$' : '\\)'
    const end = closingIndex(source, closing, opening.length)
    if (end < 0) return undefined
    const text = source.slice(opening.length, end)
    if (text.length === 0 || text.includes('\n')) return undefined
    return latexToken(source.slice(0, end + closing.length), text, false)
  },
}

const parser = new Marked()
parser.use({ extensions: [latexBlock, latexInline] })

function isLatex(token: Token): token is LatexToken {
  return Value.Check(LatexTokenSchema, token)
}

function hasChildren(token: Token): token is Token & { tokens: Token[] } {
  return Value.Check(TokenChildrenSchema, token)
}

function childTokens(token: Token): Token[] {
  return hasChildren(token) ? token.tokens : []
}

function textOf(token: Token): string {
  return Value.Check(TokenTextSchema, token) ? token.text : ''
}

function isHeading(token: Token): token is Tokens.Heading {
  return Value.Check(HeadingTokenSchema, token)
}

function isCode(token: Token): token is Tokens.Code {
  return Value.Check(CodeTokenSchema, token)
}

function isList(token: Token): token is Tokens.List {
  return Value.Check(ListTokenSchema, token)
}

function isTable(token: Token): token is Tokens.Table {
  return Value.Check(TableTokenSchema, token)
}

function isLink(token: Token): token is Tokens.Link | Tokens.Image {
  return Value.Check(LinkTokenSchema, token)
}

function chunk(text: string, style: ProseStyle, link?: string): ProseChunk {
  return link === undefined ? { style, text } : { link, style, text }
}

function linkDestinationVisible(label: string, href: string): boolean {
  if (href.startsWith('file:')) return false
  const bare = href.startsWith('mailto:') ? href.slice(7) : href
  return label !== href && label !== bare
}

export function renderInline(
  tokens: readonly Token[],
  style: ProseStyle,
  styles: ProseStyleTable = proseStyles(),
): ProseChunk[] {
  const chunks: ProseChunk[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'paragraph': {
        const nested = childTokens(token)
        if (nested.length > 0) chunks.push(...renderInline(nested, style, styles))
        else chunks.push(chunk(textOf(token), style))
        break
      }
      case 'escape':
        chunks.push(chunk(textOf(token), style))
        break
      case 'strong':
        chunks.push(...renderInline(childTokens(token), mergeStyle(style, styles.strong), styles))
        break
      case 'em':
        chunks.push(...renderInline(childTokens(token), mergeStyle(style, styles.emphasis), styles))
        break
      case 'del':
        chunks.push(...renderInline(childTokens(token), mergeStyle(style, styles.deleted), styles))
        break
      case 'codespan':
        chunks.push(chunk(textOf(token), mergeStyle(style, styles.code)))
        break
      case 'link':
      case 'image': {
        if (!isLink(token)) break
        const labelStyle = mergeStyle(style, styles.linkLabel)
        const label =
          token.type === 'image'
            ? [chunk(token.text.length === 0 ? 'image' : token.text, labelStyle, token.href)]
            : renderInline(childTokens(token), labelStyle, styles).map((part) => ({
                ...part,
                link: token.href,
              }))
        chunks.push(...label)
        if (token.type === 'link' && linkDestinationVisible(token.text, token.href)) {
          chunks.push(chunk(` (${token.href})`, mergeStyle(style, styles.linkUrl), token.href))
        }
        break
      }
      case 'br':
        chunks.push(chunk('\n', style))
        break
      case 'html':
        chunks.push(chunk(token.raw, style))
        break
      default:
        if (isLatex(token)) {
          const rendered = token.display ? token.raw : (renderLatex(token.text) ?? token.raw)
          chunks.push(chunk(rendered, style))
          break
        }
        chunks.push(chunk(textOf(token), style))
    }
  }
  return chunks
}

function wrapChunks(chunks: readonly ProseChunk[], width: number): string[] {
  const lines: string[] = []
  let current: ProseChunk[] = []
  const flush = () => {
    const serialized = serializeChunks(current)
    if (serialized.length === 0) lines.push('')
    else lines.push(...wrapTextWithAnsi(serialized, width))
    current = []
  }
  for (const part of chunks) {
    const pieces = part.text.split('\n')
    pieces.forEach((piece, index) => {
      if (index > 0) flush()
      if (piece.length > 0) current.push({ ...part, text: piece })
    })
  }
  flush()
  return lines
}

function prefixed(lines: readonly string[], first: string, rest: string): string[] {
  return lines.map((line, index) => `${index === 0 ? first : rest}${line}`)
}

type BlockContext = { base: ProseStyle; highlight?: ProseHighlighter; styles: ProseStyleTable }

function trailingGap(next: string | undefined, ...quiet: string[]): string[] {
  return next !== undefined && next !== 'space' && !quiet.includes(next) ? [''] : []
}

function renderCode(token: Tokens.Code, width: number, context: BlockContext): string[] {
  const border = paint('\u2502 ', context.styles.codeBorder)
  const inner = Math.max(1, width - 2)
  const lang = token.lang === undefined || token.lang.length === 0 ? undefined : token.lang
  const highlighted = context.highlight?.(token.text, lang)
  const codeLines =
    highlighted === undefined
      ? token.text.split('\n').map((line) => paint(line, context.styles.text))
      : highlighted
  const lines: string[] = []
  for (const line of codeLines) {
    if (line.length === 0) {
      lines.push(border)
      continue
    }
    for (const wrapped of wrapTextWithAnsi(line, inner)) lines.push(`${border}${wrapped}`)
  }
  return lines
}

function renderList(
  token: Tokens.List,
  width: number,
  context: BlockContext,
  indent: string,
): string[] {
  const lines: string[] = []
  const start = token.start === '' ? 1 : token.start
  const markers = token.items.map((_item, index) => (token.ordered ? `${start + index}.` : '-'))
  const markerWidth = Math.max(1, ...markers.map((marker) => marker.length))
  token.items.forEach((item, index) => {
    const marker = (markers[index] ?? '-').padEnd(markerWidth)
    const task = item.task
      ? item.checked === true
        ? `${paint('[x]', context.styles.checked)} `
        : `${paint('[ ]', context.styles.unchecked)} `
      : ''
    const first = `${indent}${paint(marker, context.styles.listMarker)} ${task}`
    const firstWidth = indent.length + markerWidth + 1 + (item.task ? 4 : 0)
    const rest = ' '.repeat(firstWidth)
    const itemWidth = Math.max(1, width - firstWidth)
    let rendered = false
    for (const child of item.tokens) {
      if (isList(child)) {
        lines.push(
          ...renderList(child, width, context, ' '.repeat(indent.length + markerWidth + 1)),
        )
        rendered = true
        continue
      }
      const childLines = renderBlock(child, itemWidth, context, undefined)
      for (const line of childLines) {
        lines.push(`${rendered ? rest : first}${line}`)
        rendered = true
      }
    }
    if (!rendered) lines.push(first.trimEnd())
    if (token.loose && index < token.items.length - 1) lines.push('')
  })
  return lines
}

function cellLines(
  cell: Tokens.TableCell,
  width: number,
  style: ProseStyle,
  styles: ProseStyleTable,
): string[] {
  const serialized = serializeChunks(renderInline(cell.tokens, style, styles))
  return serialized.length === 0 ? [''] : wrapTextWithAnsi(serialized, Math.max(1, width))
}

function longestWord(text: string, cap: number): number {
  let longest = 0
  for (const word of text.split(/\s+/u)) longest = Math.max(longest, visibleWidth(word))
  return Math.min(longest, cap)
}

function columnWidths(token: Tokens.Table, available: number, context: BlockContext): number[] {
  const columns = token.header.length
  const natural = Array.from({ length: columns }, () => 0)
  const minimum = Array.from({ length: columns }, () => 1)
  const measure = (cells: readonly Tokens.TableCell[], style: ProseStyle) => {
    cells.forEach((cell, index) => {
      const text = serializeChunks(renderInline(cell.tokens, style, context.styles))
      natural[index] = Math.max(natural[index] ?? 0, visibleWidth(text))
      minimum[index] = Math.max(minimum[index] ?? 1, longestWord(text, 30))
    })
  }
  measure(token.header, mergeStyle(context.base, context.styles.heading))
  for (const row of token.rows) measure(row, context.base)
  const naturalTotal = natural.reduce((total, value) => total + value, 0)
  if (naturalTotal <= available)
    return natural.map((value, index) => Math.max(value, minimum[index] ?? 1))
  let minimumTotal = minimum.reduce((total, value) => total + value, 0)
  let floors = minimum
  if (minimumTotal > available) {
    floors = Array.from({ length: columns }, () => 1)
    let remaining = available - columns
    for (let index = 0; remaining > 0; index = (index + 1) % columns) {
      floors[index] = (floors[index] ?? 1) + 1
      remaining -= 1
    }
    minimumTotal = floors.reduce((total, value) => total + value, 0)
  }
  const growth = natural.reduce(
    (total, value, index) => total + Math.max(0, value - (floors[index] ?? 1)),
    0,
  )
  const extra = Math.max(0, available - minimumTotal)
  const widths = floors.map((floor, index) => {
    const delta = Math.max(0, (natural[index] ?? 0) - floor)
    return floor + (growth > 0 ? Math.floor((delta / growth) * extra) : 0)
  })
  let remaining = available - widths.reduce((total, value) => total + value, 0)
  for (let index = 0; remaining > 0; index = (index + 1) % columns) {
    if (widths.every((value, position) => value >= (natural[position] ?? 0))) break
    if ((widths[index] ?? 0) < (natural[index] ?? 0)) {
      widths[index] = (widths[index] ?? 0) + 1
      remaining -= 1
    }
  }
  return widths
}

function renderTable(token: Tokens.Table, width: number, context: BlockContext): string[] {
  const columns = token.header.length
  if (columns === 0) return []
  const overhead = 3 * columns + 1
  const available = width - overhead
  if (available < columns) return wrapTextWithAnsi(paint(token.raw, context.base), width)
  const widths = columnWidths(token, available, context)
  const border = (text: string) => paint(text, context.styles.border)
  const rule = (left: string, middle: string, right: string) =>
    border(
      `${left}\u2500${widths.map((value) => '\u2500'.repeat(value)).join(`\u2500${middle}\u2500`)}\u2500${right}`,
    )
  const row = (cells: readonly Tokens.TableCell[], style: ProseStyle): string[] => {
    const rendered = widths.map((value, index) => {
      const cell = cells[index]
      return cell === undefined ? [''] : cellLines(cell, value, style, context.styles)
    })
    const height = Math.max(1, ...rendered.map((lines) => lines.length))
    const out: string[] = []
    for (let line = 0; line < height; line += 1) {
      const parts = rendered.map((lines, index) => {
        const text = lines[line] ?? ''
        return `${text}${' '.repeat(Math.max(0, (widths[index] ?? 0) - visibleWidth(text)))}`
      })
      out.push(`${border('\u2502')} ${parts.join(` ${border('\u2502')} `)} ${border('\u2502')}`)
    }
    return out
  }
  const lines = [rule('\u256d', '\u252c', '\u256e')]
  lines.push(...row(token.header, mergeStyle(context.base, context.styles.heading)))
  lines.push(rule('\u251c', '\u253c', '\u2524'))
  for (const cells of token.rows) lines.push(...row(cells, context.base))
  lines.push(rule('\u2570', '\u2534', '\u256f'))
  return lines
}

export function renderBlock(
  token: Token,
  width: number,
  context: BlockContext,
  next: string | undefined,
): string[] {
  switch (token.type) {
    case 'space':
      return ['']
    case 'heading': {
      if (!isHeading(token)) return []
      const style = token.depth <= 2 ? context.styles.heading : context.styles.subheading
      const lines = wrapChunks(
        renderInline(token.tokens, mergeStyle(context.base, style), context.styles),
        width,
      )
      return [...lines, ...trailingGap(next)]
    }
    case 'paragraph':
      return [
        ...wrapChunks(renderInline(childTokens(token), context.base, context.styles), width),
        ...trailingGap(next, 'list'),
      ]
    case 'text':
      return wrapChunks(renderInline([token], context.base, context.styles), width)
    case 'code':
      return isCode(token) ? [...renderCode(token, width, context), ...trailingGap(next)] : []
    case 'list':
      return isList(token) ? renderList(token, width, context, '') : []
    case 'table':
      return isTable(token) ? [...renderTable(token, width, context), ...trailingGap(next)] : []
    case 'blockquote': {
      const inner = Math.max(1, width - 2)
      const quoted = renderBlocks(childTokens(token), inner, {
        ...context,
        base: mergeStyle(context.base, context.styles.quote),
      })
      while (quoted.length > 0 && quoted.at(-1) === '') quoted.pop()
      const border = paint('\u2502 ', context.styles.border)
      return [...prefixed(quoted, border, border), ...trailingGap(next)]
    }
    case 'hr':
      return [
        paint('\u2500'.repeat(Math.max(1, width)), context.styles.border),
        ...trailingGap(next),
      ]
    case 'html':
      return [
        ...wrapTextWithAnsi(paint(token.raw.trim(), context.base), width),
        ...trailingGap(next),
      ]
    case 'def':
      return []
    default: {
      if (isLatex(token)) {
        const rendered = renderLatex(token.text, { display: token.display }) ?? token.raw.trim()
        return [
          ...rendered
            .split('\n')
            .flatMap((line) => wrapTextWithAnsi(paint(line, context.base), width)),
          ...trailingGap(next),
        ]
      }
      const text = textOf(token)
      return text.length === 0 ? [] : wrapTextWithAnsi(paint(text, context.base), width)
    }
  }
}

function renderBlocks(tokens: readonly Token[], width: number, context: BlockContext): string[] {
  const lines: string[] = []
  tokens.forEach((token, index) => {
    lines.push(...renderBlock(token, width, context, tokens[index + 1]?.type))
  })
  return lines
}

export function renderProseMarkdown(
  markdown: string,
  width: number,
  highlight?: ProseHighlighter,
  palette: HudPalette = defaultHudPalette,
): string[] {
  const text = markdown.replaceAll('\t', '   ')
  if (text.trim().length === 0) return []
  const tokens = parser.lexer(text)
  const styles = proseStyles(palette)
  const context: BlockContext = { base: styles.text, styles }
  if (highlight !== undefined) context.highlight = highlight
  const lines = renderBlocks(tokens, Math.max(1, width), context)
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines
}

export class ProseMarkdown implements Component {
  private cacheKey: string | undefined
  private cachePalette: HudPalette | undefined
  private cacheLines: string[] = []

  constructor(
    private readonly text: string,
    private readonly options: ProseMarkdownOptions,
  ) {}

  invalidate(): void {
    this.cacheKey = undefined
  }

  render(width: number): string[] {
    const streaming = this.options.streaming()
    const palette = this.options.palette?.() ?? defaultHudPalette
    const key = `${width}\u0000${streaming ? 1 : 0}\u0000${this.options.revision()}\u0000${this.text}`
    if (this.cacheKey === key && this.cachePalette === palette) return this.cacheLines
    const stabilized = streaming ? stabilizeMarkdown(this.text) : this.text
    const linked = linkifyMarkdown(stabilized, {
      cwd: this.options.cwd(),
      resolve: this.options.resolve,
      streaming,
    })
    const lines = renderProseMarkdown(linked, width, this.options.highlight, palette)
    this.cacheKey = key
    this.cachePalette = palette
    this.cacheLines = lines
    return lines
  }
}
