const fenceLinePattern = /^[ \t]{0,3}(`{3,}|~{3,})/gmu
const partialFencePattern = /(^|\n)[ \t]{0,3}(`{1,2}|~{1,2})$/u
const partialBlockPattern = /(^|\n)[ \t]{0,3}(?:#{1,6}|>)[ \t]*$/u
const pendingLinkPattern = /\[[^\]]*\]\($/u
const pairedMarkers: readonly (readonly [string, RegExp])[] = [
  ['**', /\*\*/gu],
  ['~~', /~~/gu],
]

function fencedRanges(text: string): (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = []
  let open: { at: number; marker: string } | undefined
  for (const match of text.matchAll(fenceLinePattern)) {
    const marker = match[1]?.[0] ?? '`'
    if (open === undefined) open = { at: match.index, marker }
    else if (marker === open.marker) {
      ranges.push([open.at, match.index + match[0].length])
      open = undefined
    }
  }
  if (open !== undefined) ranges.push([open.at, text.length])
  return ranges
}

function outsideFences(text: string, ranges: readonly (readonly [number, number])[]): string {
  let output = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    output += text.slice(cursor, start)
    cursor = end
  }
  return output + text.slice(cursor)
}

function count(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length
}

export function stabilizeMarkdown(text: string): string {
  if (text.length === 0) return ''
  const trailing = /\s+$/u.exec(text)?.[0] ?? ''
  let body = trailing.length > 0 ? text.slice(0, -trailing.length) : text
  const fences = [...body.matchAll(fenceLinePattern)]
  if (fences.length % 2 === 1) {
    const marker = fences.at(-1)?.[1]?.[0] ?? '`'
    return `${body}${trailing}\n${marker.repeat(3)}`
  }
  const partialFence = partialFencePattern.exec(body)
  if (partialFence !== null) {
    return body.slice(0, partialFence.index + (partialFence[1] ?? '').length)
  }
  const partialBlock = partialBlockPattern.exec(body)
  if (partialBlock !== null) {
    return body.slice(0, partialBlock.index + (partialBlock[1] ?? '').length)
  }
  if (/(?<![*~])[*~]$/u.test(body)) body = body.slice(0, -1)
  let closing = ''
  const prose = outsideFences(body, fencedRanges(body))
  if (count(prose, /`/gu) % 2 === 1) {
    if (body.endsWith('`')) body = body.slice(0, -1)
    else closing += '`'
  }
  for (const [marker, pattern] of pairedMarkers) {
    if (count(outsideFences(body, fencedRanges(body)), pattern) % 2 === 1) {
      if (body.endsWith(marker)) body = body.slice(0, -marker.length)
      else closing = marker + closing
    }
  }
  if (count(outsideFences(body, fencedRanges(body)), /(?<!\*)\*(?!\*)/gu) % 2 === 1) {
    if (body.endsWith('*')) body = body.slice(0, -1)
    else closing = `*${closing}`
  }
  const openParen = body.lastIndexOf('(')
  const closeParen = body.lastIndexOf(')')
  if (openParen > closeParen && pendingLinkPattern.test(body.slice(0, openParen + 1))) {
    closing = `)${closing}`
  }
  return body + closing + trailing
}
