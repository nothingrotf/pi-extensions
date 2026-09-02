import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

export const timestampEntryType = 'timestamp-pi'

export type TimestampKind = 'assistant' | 'tool' | 'user'

export type TimestampEntryData = {
  kind?: TimestampKind
  role: 'assistant' | 'user'
  timestamp: number
}

type ToolCallCandidate = {
  content?: readonly { type: string }[]
  stopReason?: string
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

export function formatRelative(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
  if (seconds < 5) {
    return 'now'
  }
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  if (seconds < 3_600) {
    return `${Math.floor(seconds / 60)}m ago`
  }
  return `${Math.floor(seconds / 3_600)}h ago`
}

export function isToolCallMessage(message: ToolCallCandidate): boolean {
  return (
    message.stopReason === 'toolUse' ||
    message.content?.some((block) => block.type === 'toolCall') === true
  )
}

export function formatTimestampLine(data: TimestampEntryData, now: number): string {
  const kind = data.kind ?? data.role
  const label = kind === 'tool' ? 'tool call' : kind === 'user' ? 'user message' : 'ai response'
  return `⏱ ${formatClock(data.timestamp)} (${formatRelative(data.timestamp, now)}) · ${label}`
}

export function registerTimestamps(pi: ExtensionAPI): void {
  let enabled = true

  pi.on('message_end', (event) => {
    const message = event.message
    if (!enabled || (message.role !== 'user' && message.role !== 'assistant')) {
      return
    }
    pi.appendEntry<TimestampEntryData>(timestampEntryType, {
      kind: message.role === 'user' ? 'user' : isToolCallMessage(message) ? 'tool' : 'assistant',
      role: message.role,
      timestamp: message.timestamp ?? Date.now(),
    })
  })

  pi.registerEntryRenderer<TimestampEntryData>(timestampEntryType, (entry, _options, theme) => {
    if (!enabled || entry.data === undefined) {
      return undefined
    }
    return new Text(theme.fg('dim', formatTimestampLine(entry.data, Date.now())), 0, 0)
  })

  pi.registerCommand('hud-timestamp', {
    description: 'Toggle message timestamps',
    handler: async (_args, ctx) => {
      enabled = !enabled
      ctx.ui.notify(`hud: timestamps ${enabled ? 'enabled' : 'disabled'}`, 'info')
    },
  })
}
