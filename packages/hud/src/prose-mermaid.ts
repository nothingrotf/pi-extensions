import { visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { diagramKind, render, type MermaidArt, type Span } from 'grok-mermaid'

import { paint, type ProseStyleTable } from './prose-style.ts'

const cacheLimit = 64
const cache = new Map<string, MermaidArt | null>()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const compactSourceLimit = 64_000
const compactNodeLimit = 128
const compactEdgeLimit = 512
const compactStatementLimit = 1_024
function isCompactNodeCharacter(char: string): boolean {
  return char === '_' || /[\p{Letter}\p{Number}]/v.test(char)
}

type CompactNode = { id: string; label: string }
type CompactEdge = { from: number; label: string | undefined; operator: string; to: number }
type CompactGraph = { edges: CompactEdge[]; index: Map<string, number>; nodes: CompactNode[] }
type CompactNodeRead = { id: string; label: string | undefined; next: number }
type CompactLinkRead = { label: string | undefined; next: number; operator: string }

function skipSpaces(source: string, offset: number): number {
  let next = offset
  while (source[next] === ' ' || source[next] === '\t') next += 1
  return next
}

function compactLabel(source: string): string | undefined {
  const trimmed = source.trim()
  if (trimmed.length === 0) return ''
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length === 1) return undefined
    const content = trimmed.slice(1, -1)
    if (content.includes('"')) return undefined
    return content
      .replaceAll(/<br\s*\/?\s*>/giu, ' ')
      .replaceAll(/\s+/gu, ' ')
      .trim()
  }
  if (trimmed.includes('"')) return undefined
  return trimmed
    .replaceAll(/<br\s*\/?\s*>/giu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

function compactStatements(source: string): string[] | undefined {
  if (source.length > compactSourceLimit) return undefined
  const result: string[] = []
  for (const line of source.split('\n')) {
    let current = ''
    let quoted = false
    let escaped = false
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (quoted) {
        current += char
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') {
        quoted = true
        current += char
      } else if (char === '%' && line[index + 1] === '%') break
      else if (char === ';') {
        if (current.trim().length > 0) result.push(current.trim())
        current = ''
      } else current += char
    }
    if (quoted) return undefined
    if (current.trim().length > 0) result.push(current.trim())
    if (result.length > compactStatementLimit) return undefined
  }
  return result
}

function readCompactNode(source: string, offset: number): CompactNodeRead | undefined {
  let next = skipSpaces(source, offset)
  const start = next
  while (isCompactNodeCharacter(source[next] ?? '')) next += 1
  if (next === start) return undefined
  const id = source.slice(start, next)
  const opener = source[next]
  const closer = opener === '[' ? ']' : opener === '(' ? ')' : opener === '{' ? '}' : undefined
  if (closer === undefined) return { id, label: undefined, next }
  const labelStart = next + 1
  let quoted = false
  let escaped = false
  next = labelStart
  while (next < source.length) {
    const char = source[next]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === closer) {
      const label = compactLabel(source.slice(labelStart, next))
      return label === undefined ? undefined : { id, label, next: next + 1 }
    }
    next += 1
  }
  return undefined
}

function compactOperatorAt(source: string, offset: number): { next: number; operator: string } {
  let next = offset
  if ((source[next] === 'o' || source[next] === 'x') && /[.=\x2d]/u.test(source[next + 1] ?? '')) {
    next += 1
  }
  while (/[.=<>\x2d]/u.test(source[next] ?? '')) next += 1
  if (source[next] === 'o' || source[next] === 'x') next += 1
  return { next, operator: source.slice(offset, next) }
}

function isCompactTerminalOperator(operator: string): boolean {
  if (/^[ox]?\x2d{2,}(?:[ox>])?$/u.test(operator)) {
    const core = operator.startsWith('o') || operator.startsWith('x') ? operator.slice(1) : operator
    return core.endsWith('o') || core.endsWith('x') || core.endsWith('>') || core.length >= 3
  }
  return (
    /^<\x2d{2,}>?$/u.test(operator) ||
    /^[ox]?\x2d\.+\x2d>$/u.test(operator) ||
    /^[ox]?\x2d\.+\x2d$/u.test(operator) ||
    /^[ox]?={2,}>$/u.test(operator) ||
    /^[ox]?={3,}$/u.test(operator)
  )
}

function isCompactInlinePrefix(operator: string): boolean {
  return (
    /^[ox]?\x2d{2,}$/u.test(operator) ||
    /^[ox]?\x2d\.+$/u.test(operator) ||
    /^[ox]?={2,}$/u.test(operator)
  )
}

function isCompactInlineTail(operator: string): boolean {
  return /^\x2d{2,}>$/u.test(operator) || /^\.+\x2d>$/u.test(operator) || /^={2,}>$/u.test(operator)
}

function readCompactInlineLabel(source: string, offset: number): CompactLinkRead | undefined {
  let next = offset
  while (next < source.length) {
    if (/[.=<>\x2d]/u.test(source[next] ?? '')) {
      const tail = compactOperatorAt(source, next)
      if (!isCompactInlineTail(tail.operator)) return undefined
      const label = compactLabel(source.slice(offset, next))
      return label === undefined || label.length === 0
        ? undefined
        : { label, next: skipSpaces(source, tail.next), operator: tail.operator }
    }
    next += 1
  }
  return undefined
}

function readCompactLink(source: string, offset: number): CompactLinkRead | undefined {
  const start = skipSpaces(source, offset)
  const parsed = compactOperatorAt(source, start)
  if (parsed.next === start) return undefined
  const next = skipSpaces(source, parsed.next)
  if (source[next] === '|') {
    if (!isCompactTerminalOperator(parsed.operator) && !isCompactInlinePrefix(parsed.operator)) {
      return undefined
    }
    const labelStart = next + 1
    const labelEnd = source.indexOf('|', labelStart)
    if (labelEnd < 0) return undefined
    const label = compactLabel(source.slice(labelStart, labelEnd))
    return label === undefined
      ? undefined
      : { label, next: skipSpaces(source, labelEnd + 1), operator: parsed.operator }
  }
  if (isCompactTerminalOperator(parsed.operator)) {
    return { label: undefined, next, operator: parsed.operator }
  }
  if (!isCompactInlinePrefix(parsed.operator)) return undefined
  return readCompactInlineLabel(source, next)
}

function addCompactNode(graph: CompactGraph, node: CompactNodeRead): number | undefined {
  const existing = graph.index.get(node.id)
  if (existing !== undefined) {
    if (node.label !== undefined) {
      const current = graph.nodes[existing]
      if (current === undefined) return undefined
      current.label = node.label
    }
    return existing
  }
  if (graph.nodes.length >= compactNodeLimit) return undefined
  const index = graph.nodes.length
  graph.index.set(node.id, index)
  graph.nodes.push({ id: node.id, label: node.label ?? node.id })
  return index
}

function parseCompactFlowchart(source: string): CompactGraph | undefined {
  const statements = compactStatements(source)
  if (statements === undefined || statements.length === 0) return undefined
  if (!/^(?:graph|flowchart)(?:\s+(?:TD|TB|BT|LR|RL))?\s*$/iu.test(statements[0] ?? '')) {
    return undefined
  }
  const graph: CompactGraph = { edges: [], index: new Map(), nodes: [] }
  for (const statement of statements.slice(1)) {
    if (
      /^(?:subgraph|end|classDef|class|style|linkStyle|click|direction)(?:\s|$)/iu.test(statement)
    ) {
      return undefined
    }
    let current = readCompactNode(statement, 0)
    if (current === undefined) return undefined
    let from = addCompactNode(graph, current)
    if (from === undefined) return undefined
    for (;;) {
      const link = readCompactLink(statement, current.next)
      if (link === undefined) {
        if (skipSpaces(statement, current.next) !== statement.length) return undefined
        break
      }
      const target = readCompactNode(statement, link.next)
      if (target === undefined) return undefined
      const to = addCompactNode(graph, target)
      if (to === undefined || graph.edges.length >= compactEdgeLimit) return undefined
      graph.edges.push({ from, label: link.label, operator: link.operator, to })
      current = target
      from = to
    }
  }
  return graph.nodes.length === 0 ? undefined : graph
}

function appendCompactText(
  lines: string[],
  text: string,
  first: string,
  rest: string,
  width: number,
  style: ProseStyleTable[keyof ProseStyleTable],
): void {
  const contentWidth = Math.max(1, width - Math.max(visibleWidth(first), visibleWidth(rest)))
  const wrapped = wrapTextWithAnsi(paint(text, style), contentWidth)
  if (wrapped.length === 0) {
    lines.push(first)
    return
  }
  wrapped.forEach((line, index) => lines.push(`${index === 0 ? first : rest}${line}`))
}

function renderCompactFlowchart(
  source: string,
  width: number,
  styles: ProseStyleTable,
): string[] | undefined {
  const graph = parseCompactFlowchart(source)
  if (graph === undefined) return undefined
  const lines: string[] = []
  appendCompactText(lines, 'Flowchart', '', '', width, styles.subheading)
  appendCompactText(lines, 'Nodes', '', '', width, styles.subheading)
  graph.nodes.forEach((node, index) => {
    const marker = `${index + 1}. `
    appendCompactText(
      lines,
      node.label,
      paint(marker, styles.linkLabel),
      ' '.repeat(marker.length),
      width,
      styles.text,
    )
  })
  appendCompactText(lines, 'Connections', '', '', width, styles.subheading)
  graph.edges.forEach((edge) => {
    const relation = `${edge.from + 1} ${edge.operator} ${edge.to + 1}`
    const text = edge.label === undefined ? relation : `${relation} · ${edge.label}`
    appendCompactText(
      lines,
      text,
      '',
      '  ',
      width,
      edge.label === undefined ? styles.codeBorder : styles.linkUrl,
    )
  })
  return lines
}

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
    const raw = match[1]?.trim()
    const label = raw?.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
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
  const art = cachedArt(source)
  if (
    art !== null &&
    art.warnings.length === 0 &&
    art.width <= width &&
    art.plain.every((line) => visibleWidth(line) <= width) &&
    (kind !== 'flowchart' || (!hasParallelRoutes(source) && preservesEdgeLabels(source, art)))
  ) {
    return art.styled.map((line) =>
      line
        .map((span) => renderSpan(span, styles))
        .join('')
        .trimEnd(),
    )
  }
  return kind === 'flowchart' ? renderCompactFlowchart(source, width, styles) : undefined
}
