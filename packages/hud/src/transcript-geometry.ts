import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'

export const speakerBodyIndent = 3

export function transcriptCopyChipWidth(width: number): number {
  return width >= 80 ? 9 : 3
}

const escape = String.fromCharCode(27)
const bell = String.fromCharCode(7)
const terminalZoneMarkers = [
  `${escape}]133;A${bell}`,
  `${escape}]133;B${bell}`,
  `${escape}]133;C${bell}`,
] as const

export type TranscriptInsets = {
  body: number
  inner: number
  outer: number
}

export function transcriptInsets(width: number, bodyIndent = 0): TranscriptInsets {
  const safeWidth = Math.max(1, Math.floor(width))
  const body = Math.min(Math.max(0, Math.floor(bodyIndent)), Math.max(0, safeWidth - 1))
  return { body, inner: Math.max(1, safeWidth - body), outer: 0 }
}

function terminalAffixes(line: string): { content: string; prefix: string; suffix: string } {
  let content = line
  let prefix = ''
  let suffix = ''
  let found = true
  while (found) {
    found = false
    for (const marker of terminalZoneMarkers) {
      if (!content.startsWith(marker)) continue
      prefix += marker
      content = content.slice(marker.length)
      found = true
      break
    }
  }
  found = true
  while (found) {
    found = false
    for (const marker of terminalZoneMarkers) {
      if (!content.endsWith(marker)) continue
      suffix = `${marker}${suffix}`
      content = content.slice(0, -marker.length)
      found = true
      break
    }
  }
  return { content, prefix, suffix }
}

export function frameTranscriptLine(line: string, width: number, bodyIndent = 0): string {
  const safeWidth = Math.max(1, Math.floor(width))
  const insets = transcriptInsets(safeWidth, bodyIndent)
  const split = terminalAffixes(line)
  const content =
    visibleWidth(split.content) > insets.inner
      ? truncateToWidth(split.content, insets.inner, '')
      : split.content
  const framed = `${split.prefix}${' '.repeat(insets.outer + insets.body)}${content}`
  const padding = ' '.repeat(Math.max(0, safeWidth - visibleWidth(framed)))
  return `${framed}${padding}${split.suffix}`
}
