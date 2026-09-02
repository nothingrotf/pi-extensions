import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

export const timestampEntryType = 'timestamp-pi'

const minimumDurationMs = 100

export type UsageEntryData = {
  cacheRead: number
  durationMs: number | undefined
  input: number
  output: number
  timestamp: number
}

type UsageCandidate = {
  cacheRead?: number
  cacheWrite?: number
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

export function formatNumber(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 10_000) return `${trim1(value / 1_000)}K`
  if (value < 1_000_000) return `${Math.round(value / 1_000)}K`
  if (value < 10_000_000) return `${trim1(value / 1_000_000)}M`
  if (value < 1_000_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value < 10_000_000_000) return `${trim1(value / 1_000_000_000)}B`
  return `${Math.round(value / 1_000_000_000)}B`
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatRelative(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
  if (seconds < 5) return 'now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3_600)}h ago`
}

export function formatUsageRow(data: UsageEntryData, now: number): string {
  const parts = [
    `${formatClock(data.timestamp)} (${formatRelative(data.timestamp, now)})`,
    `⤵ ${formatNumber(data.input)}`,
    `⤴ ${formatNumber(data.output)}`,
  ]
  if (data.cacheRead > 0) {
    parts.push(`💾 ${formatNumber(data.cacheRead)}`)
  }
  if (data.durationMs !== undefined && data.durationMs > minimumDurationMs && data.output > 0) {
    parts.push(`⚡ ${((data.output / data.durationMs) * 1000).toFixed(1)}/s`)
  }
  return parts.join(' · ')
}

export function toUsageEntry(
  message: AssistantCandidate,
  startedAt: number | undefined,
  now: number,
): UsageEntryData {
  const usage = message.usage ?? {}
  return {
    cacheRead: usage.cacheRead ?? 0,
    durationMs: startedAt === undefined ? undefined : Math.max(0, now - startedAt),
    input: (usage.input ?? 0) + (usage.cacheWrite ?? 0),
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

  pi.registerEntryRenderer<UsageEntryData>(timestampEntryType, (entry, _options, theme) => {
    if (!enabled || entry.data === undefined) {
      return undefined
    }
    return new Text(`\n${theme.fg('dim', formatUsageRow(entry.data, Date.now()))}`, 1, 0)
  })

  pi.registerCommand('hud-timestamp', {
    description: 'Toggle per-turn usage rows',
    handler: async (_args, ctx) => {
      enabled = !enabled
      ctx.ui.notify(`hud: timestamps ${enabled ? 'enabled' : 'disabled'}`, 'info')
    },
  })
}
