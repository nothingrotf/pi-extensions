import { sanitizeScalar } from './format.ts'
import type { RailPatch } from './rail.ts'

const detailCap = 60

const atxHeading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/
const boldLine = /^\s*\*\*(.+?)\*\*\s*$/
const htmlHeading = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/i

function nonEmptyLines(text: string): string[] {
  return text.split('\n').filter((line) => line.trim().length > 0)
}

export function headings(text: string): string[] {
  const found: string[] = []
  const html = htmlHeading.exec(text)
  if (html?.[1] !== undefined) found.push(html[1])
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    const atx = atxHeading.exec(line)
    if (atx?.[1] !== undefined) {
      found.push(atx[1])
      return
    }
    const bold = boldLine.exec(line)
    if (bold?.[1] !== undefined) {
      found.push(bold[1])
      return
    }
    const next = lines[index + 1]
    if (next !== undefined && /^\s{0,3}(=+|-{2,})\s*$/.test(next) && line.trim().length > 0) {
      found.push(line.trim())
    }
  })
  return found.map((value) => sanitizeScalar(value)).filter((value) => value.length > 0)
}

export function thinkingHeading(text: string, streaming: boolean): string {
  const found = headings(text)
  const picked = streaming ? found.at(-1) : found[0]
  const fallback = sanitizeScalar(nonEmptyLines(text)[0] ?? '')
  return (picked ?? fallback).slice(0, detailCap)
}

function lineSummary(text: string): string {
  const count = nonEmptyLines(text).length
  return count > 1 ? `${count} lines` : ''
}

export function thoughtPatch(text: string, streaming = false): RailPatch {
  return {
    category: 'meta',
    detail: thinkingHeading(text, streaming),
    doneLabel: 'Thought',
    iconKey: 'thought',
    kind: 'thought',
    output: text,
    runningLabel: 'Thinking',
    status: streaming ? 'pending' : 'ok',
    summary: lineSummary(text),
  }
}

export function narrationPatch(text: string): RailPatch {
  const first = sanitizeScalar(nonEmptyLines(text)[0] ?? '')
  return {
    category: 'meta',
    detail: first.slice(0, detailCap),
    doneLabel: 'Note',
    iconKey: 'chat',
    kind: 'narration',
    output: text,
    runningLabel: 'Saying',
    status: 'ok',
    summary: lineSummary(text),
  }
}
