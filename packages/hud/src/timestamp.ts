import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import { prettyModel } from './format.ts'

export const roleEntryType = 'hud-role'
export const timestampEntryType = 'timestamp-pi'

const minimumDurationMs = 100

export type MessageRole = 'assistant' | 'user'

export type RoleEntryData = {
  label?: string
  role: MessageRole
  timestamp: number
}

export type UsageEntryData = {
  cacheRead: number
  cost: number
  durationMs: number | undefined
  input: number
  output: number
  timestamp: number
}

type UsageCandidate = {
  cacheRead?: number
  cacheWrite?: number
  cost?: { total?: number }
  input?: number
  output?: number
}

type AssistantCandidate = {
  role: string
  timestamp?: number
  usage?: UsageCandidate
}

function trim1(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

export function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${trim1(value / 1_000)}k`
  return `${trim1(value / 1_000_000)}m`
}

export function formatSpan(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds}ms`
  if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)}s`
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.round((milliseconds % 60_000) / 1_000)
  return seconds > 0 ? `${minutes}m${seconds}s` : `${minutes}m`
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours()
  const suffix = hours < 12 ? 'AM' : 'PM'
  const hour = hours % 12 === 0 ? 12 : hours % 12
  return `${hour}:${String(date.getMinutes()).padStart(2, '0')} ${suffix}`
}

export function roleLabel(role: MessageRole, label: string | undefined): string {
  if (role === 'user') return 'You'
  const trimmed = label?.trim()
  return trimmed === undefined || trimmed.length === 0 ? 'Agent' : trimmed
}

export function formatCost(value: number): string {
  if (value < 0.001) return '$<0.001'
  return `$${value < 1 ? value.toFixed(3) : value.toFixed(2)}`
}

export function roleGlyph(role: MessageRole): string {
  return role === 'user' ? '◆' : '●'
}

export function hasUsage(data: UsageEntryData): boolean {
  return data.input > 0 || data.output > 0
}

export function formatUsageRow(data: UsageEntryData): string {
  const parts: string[] = []
  if (data.durationMs !== undefined && data.durationMs > 0) parts.push(formatSpan(data.durationMs))
  if (data.cost > 0) parts.push(formatCost(data.cost))
  parts.push(`${formatTokens(data.input)} in`)
  parts.push(`${formatTokens(data.output)} out`)
  if (data.input > 0 && data.cacheRead > 0) {
    parts.push(`⛁ ${Math.round((data.cacheRead / data.input) * 100)}% cached`)
  }
  if (data.durationMs !== undefined && data.durationMs > minimumDurationMs && data.output > 0) {
    parts.push(`⚡${((data.output / data.durationMs) * 1000).toFixed(1)}/s`)
  }
  return `▪ ${parts.join(' · ')}`
}

export function toUsageEntry(
  message: AssistantCandidate,
  startedAt: number | undefined,
  now: number,
): UsageEntryData {
  const usage = message.usage ?? {}
  const cacheRead = usage.cacheRead ?? 0
  return {
    cacheRead,
    cost: usage.cost?.total ?? 0,
    durationMs: startedAt === undefined ? undefined : Math.max(0, now - startedAt),
    input: (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheRead,
    output: usage.output ?? 0,
    timestamp: message.timestamp ?? now,
  }
}

export function registerTimestamps(pi: ExtensionAPI): void {
  let enabled = true
  let startedAt: number | undefined

  pi.on('turn_start', () => {
    startedAt = Date.now()
  })

  pi.on('message_start', (event, ctx) => {
    const role = event.message.role
    if (!enabled || (role !== 'assistant' && role !== 'user')) {
      return
    }
    const data: RoleEntryData = { role, timestamp: Date.now() }
    if (role === 'assistant') data.label = prettyModel(ctx.model?.id)
    pi.appendEntry<RoleEntryData>(roleEntryType, data)
  })

  pi.on('message_end', (event) => {
    const message = event.message
    if (message.role !== 'assistant') {
      return
    }
    const start = startedAt
    startedAt = undefined
    if (!enabled) {
      return
    }
    pi.appendEntry<UsageEntryData>(timestampEntryType, toUsageEntry(message, start, Date.now()))
  })

  pi.registerEntryRenderer<RoleEntryData>(roleEntryType, (entry, _options, theme) => {
    if (!enabled || entry.data === undefined) {
      return undefined
    }
    const { label, role, timestamp } = entry.data
    return new Text(
      `${theme.fg('accent', roleGlyph(role))} ${theme.bold(theme.fg('accent', roleLabel(role, label)))} ${theme.fg('dim', `· ${formatClock(timestamp)}`)}`,
      1,
      0,
    )
  })

  pi.registerEntryRenderer<UsageEntryData>(timestampEntryType, (entry, _options, theme) => {
    if (!enabled || entry.data === undefined || !hasUsage(entry.data)) {
      return undefined
    }
    return new Text(theme.fg('dim', formatUsageRow(entry.data)), 1, 0)
  })

  pi.registerCommand('hud-timestamp', {
    description: 'Toggle transcript role headers and usage rows',
    handler: async (_args, ctx) => {
      enabled = !enabled
      ctx.ui.notify(`hud: timestamps ${enabled ? 'enabled' : 'disabled'}`, 'info')
    },
  })
}
