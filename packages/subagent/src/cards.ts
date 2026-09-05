import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { DeliveryRecord } from './delivery.ts'
import { oneLineLabel, type SubagentTheme } from './format.ts'
import { formatMoreItems } from './jobs.ts'

export const MAIL_ICON = '✉'
export const ARROW_OUT = '➤'
export const ARROW_IN = '⟵'
const QUOTE = '▏'
const BODY_LINE_WIDTH = 80
const BODY_LINES_COLLAPSED = 3

export function quotedBody(
  body: string,
  theme: SubagentTheme,
  options: {
    collapsedLines?: number
    expanded: boolean
    indent?: string
    tone?: 'dim' | 'toolOutput'
    width?: number
  },
): string[] {
  const safeWidth = Math.max(0, Math.floor(options.width ?? BODY_LINE_WIDTH))
  if (safeWidth === 0) return []
  const indent = options.indent ?? '  '
  const tone = options.tone ?? 'toolOutput'
  const max = options.expanded
    ? Number.POSITIVE_INFINITY
    : (options.collapsedLines ?? BODY_LINES_COLLAPSED)
  const source = body
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  const quote = theme.fg('dim', QUOTE)
  const prefix = truncateToWidth(`${indent}${quote} `, Math.max(0, safeWidth - 2), '')
  const width = Math.max(1, safeWidth - visibleWidth(prefix))
  const wrapped = source.flatMap((line) =>
    wrapTextWithAnsi(oneLineLabel(line, Number.POSITIVE_INFINITY), width),
  )
  const lines = wrapped
    .slice(0, max)
    .map((line) => `${prefix}${theme.fg(tone, truncateToWidth(line, width, ''))}`)
  const hidden = wrapped.length - Math.min(wrapped.length, max)
  if (hidden > 0) {
    lines.push(
      ...wrapTextWithAnsi(`+${hidden} more ${hidden === 1 ? 'line' : 'lines'}`, width).map(
        (line) => `${prefix}${theme.fg('dim', line)}`,
      ),
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

const IntercomRequestSchema = Type.Object({
  agentId: Type.String(),
  kind: Type.Literal('request'),
  message: Type.String(),
  requestId: Type.String(),
})

const IntercomDetailsSchema = Type.Intersect([
  Type.Union([IntercomReplySchema, IntercomNoticeSchema, IntercomRequestSchema]),
  Type.Object({
    deliveryId: Type.Optional(Type.String()),
    sentAt: Type.Optional(Type.Number()),
    queuedAt: Type.Optional(Type.Number()),
    deliveredAt: Type.Optional(Type.Number()),
  }),
])

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
  options: {
    expanded: boolean
    now: number
    delivery?: DeliveryRecord | undefined
    width?: number
  },
  theme: SubagentTheme,
): string[] {
  const sentAt = options.delivery?.sentAt ?? details.sentAt
  const createdAt = sentAt ?? timestamp
  const age = createdAt === undefined ? undefined : formatAge(options.now - createdAt)
  const peer = theme.fg('accent', theme.bold(oneLineLabel(label, Number.POSITIVE_INFINITY)))
  const meta: string[] = []
  if (details.kind === 'notification' && details.level !== 'info') {
    meta.push(theme.fg(details.level, details.level))
  }
  if (age !== undefined) meta.push(sentAt === undefined ? age : `sent ${age} ago`)
  const receipt = options.delivery
  if (receipt !== undefined) {
    meta.push(receipt.state)
    if (receipt.deliveredAt !== undefined)
      meta.push(`queue ${formatAge(receipt.deliveredAt - receipt.queuedAt)}`)
  }
  if (details.kind === 'request') meta.push('coordinator decision')
  if (details.kind === 'automatic-reply') meta.push('advisory only')
  const header = `${theme.fg('accent', MAIL_ICON)} ${theme.fg('accent', `IRC ${ARROW_IN}`)} ${peer}${meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''}`
  if (details.kind === 'notification' || details.kind === 'request') {
    return [
      header,
      ...quotedBody(unescapeXml(details.message), theme, {
        expanded: options.expanded,
        width: options.width ?? BODY_LINE_WIDTH,
      }),
    ]
  }
  return [
    header,
    ...quotedBody(unescapeXml(details.question), theme, {
      expanded: options.expanded,
      width: options.width ?? BODY_LINE_WIDTH,
    }),
    `  ${theme.fg('dim', ARROW_OUT)} ${theme.fg('accent', 'advisor')} ${theme.fg('dim', 'not authorization')}`,
    ...quotedBody(unescapeXml(details.reply), theme, {
      expanded: options.expanded,
      tone: 'dim',
      width: options.width ?? BODY_LINE_WIDTH,
    }),
  ]
}

export function moreLine(remaining: number, noun: string, theme: SubagentTheme): string {
  return theme.fg('dim', formatMoreItems(remaining, noun))
}
