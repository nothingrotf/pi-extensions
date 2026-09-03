import { truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { oneLineLabel, type SubagentTheme } from './format.ts'
import { formatMoreItems } from './jobs.ts'

export const MAIL_ICON = '✉'
export const ARROW_OUT = '➤'
export const ARROW_IN = '⟵'
const QUOTE = '▏'
const BODY_LINE_WIDTH = 80
const BODY_LINES_COLLAPSED = 3
const BODY_LINES_EXPANDED = 24

export function quotedBody(
  body: string,
  theme: SubagentTheme,
  options: {
    collapsedLines?: number
    expanded: boolean
    indent?: string
    tone?: 'dim' | 'toolOutput'
  },
): string[] {
  const indent = options.indent ?? '  '
  const tone = options.tone ?? 'toolOutput'
  const max = options.expanded
    ? BODY_LINES_EXPANDED
    : (options.collapsedLines ?? BODY_LINES_COLLAPSED)
  const source = body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const quote = theme.fg('dim', QUOTE)
  const lines = source
    .slice(0, max)
    .map(
      (line) =>
        `${indent}${quote} ${theme.fg(tone, truncateToWidth(oneLineLabel(line, BODY_LINE_WIDTH + 1), BODY_LINE_WIDTH, '…'))}`,
    )
  const hidden = source.length - Math.min(source.length, max)
  if (hidden > 0) {
    lines.push(
      `${indent}${quote} ${theme.fg('dim', `… +${hidden} more ${hidden === 1 ? 'line' : 'lines'}`)}`,
    )
  }
  return lines
}

export function cardHeader(
  options: { icon: string; meta?: readonly string[] | undefined; title: string },
  theme: SubagentTheme,
): string {
  const meta = (options.meta ?? []).filter((part) => part.length > 0)
  const suffix = meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''
  return `${options.icon} ${theme.fg('accent', options.title)}${suffix}`
}

export function formatAge(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

const IntercomReplySchema = Type.Object({
  agentId: Type.String(),
  kind: Type.Literal('automatic-reply'),
  question: Type.String(),
  reply: Type.String(),
})

const IntercomNoticeSchema = Type.Object({
  agentId: Type.String(),
  kind: Type.Literal('notification'),
  level: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  message: Type.String(),
})

const IntercomDetailsSchema = Type.Union([IntercomReplySchema, IntercomNoticeSchema])

export type IntercomDetails = ReturnType<typeof decodeIntercomDetails>

export function decodeIntercomDetails<Input>(value: Input) {
  return Value.Check(IntercomDetailsSchema, value) ? value : undefined
}

export function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export function renderIntercomCard(
  details: NonNullable<IntercomDetails>,
  label: string,
  timestamp: number | undefined,
  options: { expanded: boolean; now: number },
  theme: SubagentTheme,
): string[] {
  const age = timestamp === undefined ? undefined : formatAge(options.now - timestamp)
  const peer = theme.fg('accent', theme.bold(oneLineLabel(label, 48)))
  const meta: string[] = []
  if (details.kind === 'notification' && details.level !== 'info') {
    meta.push(theme.fg(details.level, details.level))
  }
  if (age !== undefined) meta.push(age)
  const header = `${theme.fg('accent', MAIL_ICON)} ${theme.fg('accent', `IRC ${ARROW_IN}`)} ${peer}${meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''}`
  if (details.kind === 'notification') {
    return [
      header,
      ...quotedBody(unescapeXml(details.message), theme, { expanded: options.expanded }),
    ]
  }
  return [
    header,
    ...quotedBody(unescapeXml(details.question), theme, { expanded: options.expanded }),
    `  ${theme.fg('dim', ARROW_OUT)} ${theme.fg('accent', 'parent')} ${theme.fg('dim', 'auto')}`,
    ...quotedBody(unescapeXml(details.reply), theme, { expanded: options.expanded, tone: 'dim' }),
  ]
}

export function moreLine(remaining: number, noun: string, theme: SubagentTheme): string {
  return theme.fg('dim', formatMoreItems(remaining, noun))
}
