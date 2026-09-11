import { visibleWidth } from '@earendil-works/pi-tui'
import { diagramKind, render, type MermaidArt, type Span } from 'grok-mermaid'

import { paint, type ProseStyleTable } from './prose-style.ts'

const cacheLimit = 64
const cache = new Map<string, MermaidArt | null>()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function hasIncompatibleGrapheme(source: string): boolean {
  for (const { segment } of graphemes.segment(source)) {
    if (/\p{Spacing_Mark}/v.test(segment) || /[\u0e33\u0eb3]/u.test(segment.slice(1))) return true
    let first = true
    let followsMark = false
    for (const char of segment) {
      if (first) {
        first = false
        continue
      }
      if (/\p{Mark}/v.test(char)) followsMark = true
      else {
        const codePoint = char.codePointAt(0)
        if (followsMark && /[\p{Letter}\p{Number}]/v.test(char)) return true
        if (codePoint !== undefined && codePoint >= 0xff00 && codePoint <= 0xffef) return true
        followsMark = false
      }
    }
  }
  return false
}

function statements(source: string): string[] {
  const result: string[] = []
  for (const line of source.split('\n')) {
    let current = ''
    let quoted = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (char === '"') quoted = !quoted
      if (!quoted && char === '%' && line[index + 1] === '%') break
      if (!quoted && char === ';') {
        if (current.trim().length > 0) result.push(current.trim())
        current = ''
      } else current += char
    }
    if (current.trim().length > 0) result.push(current.trim())
  }
  return result
}

function hasParallelRoutes(source: string): boolean {
  const routes = new Set<string>()
  for (const statement of statements(source).slice(1)) {
    if (!/[-.=]+[ox>]?/u.test(statement)) continue
    const from = /^([\p{Letter}\p{Number}_]+)/v.exec(statement)?.[1]
    const to = /([\p{Letter}\p{Number}_]+)(?:\s*(?:\[[^\n]*\]|\([^\n]*\)|\{[^\n]*\}))?\s*$/v.exec(
      statement,
    )?.[1]
    if (from === undefined || to === undefined) continue
    const route = `${from}\u0000${to}`
    if (routes.has(route)) return true
    routes.add(route)
  }
  return false
}

function sourceEdgeLabels(source: string): string[] {
  const labels: string[] = []
  for (const match of source.matchAll(/\|([^|\n]+)\|/gu)) {
    const label = match[1]?.trim()
    if (label !== undefined && label.length > 0) labels.push(label)
  }
  for (const match of source.matchAll(
    /(?:--|==|-\.)[ \t]+(?:"([^"\n]+)"|([^|\n]+?))[ \t]+(?:-->|==>|\.->)/gu,
  )) {
    const label = (match[1] ?? match[2])?.trim()
    if (label !== undefined && label.length > 0) labels.push(label)
  }
  return labels
}

function countOccurrences(source: string, expected: string): number {
  let count = 0
  let offset = 0
  while (offset <= source.length - expected.length) {
    const found = source.indexOf(expected, offset)
    if (found < 0) break
    count += 1
    offset = found + expected.length
  }
  return count
}

function preservesEdgeLabels(source: string, art: MermaidArt): boolean {
  const rendered = art.styled
    .map((line) => line.map((span) => (span.cls === 'edgeLabel' ? span.text : '\u0000')).join(''))
    .join('\u0000')
  const counts = new Map<string, number>()
  for (const label of sourceEdgeLabels(source)) counts.set(label, (counts.get(label) ?? 0) + 1)
  for (const [label, expected] of counts) {
    if (countOccurrences(rendered, label) < expected) return false
  }
  return true
}

function cachedArt(source: string): MermaidArt | null {
  if (cache.has(source)) return cache.get(source) ?? null
  let art: MermaidArt | null = null
  try {
    const kind = diagramKind(source)
    art = kind === 'flowchart' || kind === 'sequence' ? render(source) : null
  } catch {
    art = null
  }
  cache.set(source, art)
  if (cache.size > cacheLimit) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  return art
}

function renderSpan(span: Span, styles: ProseStyleTable): string {
  switch (span.cls) {
    case 'border':
      return paint(span.text, styles.border)
    case 'edge':
      return paint(span.text, styles.codeBorder)
    case 'edgeLabel':
      return paint(span.text, styles.linkUrl)
    case 'text':
    case 'title':
      return paint(span.text, styles.text)
    case 'none':
      return span.text
  }
}

export function renderMermaid(
  source: string,
  width: number,
  styles: ProseStyleTable,
): string[] | undefined {
  if (hasIncompatibleGrapheme(source)) return undefined
  let kind
  try {
    kind = diagramKind(source)
  } catch {
    return undefined
  }
  if (kind !== 'flowchart' && kind !== 'sequence') return undefined
  if (kind === 'flowchart' && hasParallelRoutes(source)) return undefined
  const art = cachedArt(source)
  if (
    art === null ||
    art.warnings.length > 0 ||
    art.width > width ||
    art.plain.some((line) => visibleWidth(line) > width) ||
    (kind === 'flowchart' && !preservesEdgeLabels(source, art))
  )
    return undefined
  return art.styled.map((line) =>
    line
      .map((span) => renderSpan(span, styles))
      .join('')
      .trimEnd(),
  )
}
