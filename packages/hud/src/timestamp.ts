import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'

import { prettyModel } from './format.ts'
import {
  formatSpeakerClock,
  SpeakerHeaderComponent,
  type SpeakerHeaderSource,
} from './speaker-header.ts'

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

export const formatClock = formatSpeakerClock

export function roleGlyph(role: MessageRole): '◆' | '●' {
  return role === 'user' ? '◆' : '●'
}

export function roleLabel(role: MessageRole, label: string | undefined): string {
  if (role === 'user') return 'You'
  const trimmed = label?.trim()
  return trimmed === undefined || trimmed.length === 0 ? 'Agent' : trimmed
}

export function formatCost(value: number): string {
  if (value < 0.001) return '$<0.001'
  return `$${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}`
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

export interface RunTotals {
  cacheRead: number
  cost: number
  input: number
  output: number
  startedAt: number | undefined
}

export function emptyRunTotals(): RunTotals {
  return { cacheRead: 0, cost: 0, input: 0, output: 0, startedAt: undefined }
}

export function addMessageUsage(totals: RunTotals, message: AssistantCandidate): RunTotals {
  const usage = message.usage ?? {}
  const cacheRead = usage.cacheRead ?? 0
  return {
    cacheRead: totals.cacheRead + cacheRead,
    cost: totals.cost + (usage.cost?.total ?? 0),
    input: totals.input + (usage.input ?? 0) + (usage.cacheWrite ?? 0) + cacheRead,
    output: totals.output + (usage.output ?? 0),
    startedAt: totals.startedAt,
  }
}

export function toUsageEntry(totals: RunTotals, now: number): UsageEntryData {
  return {
    cacheRead: totals.cacheRead,
    cost: totals.cost,
    durationMs: totals.startedAt === undefined ? undefined : Math.max(0, now - totals.startedAt),
    input: totals.input,
    output: totals.output,
    timestamp: now,
  }
}

export type LiveUsage = { row: () => string | undefined }

export type LiveHeader = {
  onClose: () => void
  onMessage: (timestamp: number) => void
  onOpen: (timestamp: number) => void
  source: SpeakerHeaderSource
}

export function registerTimestamps(
  pi: ExtensionAPI,
  live?: LiveUsage,
  header?: LiveHeader,
): () => boolean {
  let enabled = true
  let totals = emptyRunTotals()
  let assistantHeaderPending = true
  let assistantCandidate: RoleEntryData | undefined

  const openAssistant = (data: RoleEntryData) => {
    if (!enabled || !assistantHeaderPending) return
    assistantHeaderPending = false
    assistantCandidate = undefined
    header?.onOpen(data.timestamp)
    pi.appendEntry<RoleEntryData>(roleEntryType, data)
  }

  if (live !== undefined) {
    live.row = () => {
      if (!enabled) return undefined
      const entry = toUsageEntry(totals, Date.now())
      return hasUsage(entry) ? formatUsageRow(entry) : undefined
    }
  }

  pi.on('agent_start', () => {
    totals = emptyRunTotals()
    assistantHeaderPending = true
    assistantCandidate = undefined
  })

  pi.on('turn_start', (event, ctx) => {
    if (totals.startedAt === undefined) {
      totals = { ...totals, startedAt: event.timestamp }
    }
    if (!assistantHeaderPending) return
    assistantCandidate = {
      label: prettyModel(ctx.model?.id),
      role: 'assistant',
      timestamp: event.timestamp,
    }
  })

  pi.on('message_start', (event, ctx) => {
    const role = event.message.role
    if (role === 'user') {
      if (enabled) {
        pi.appendEntry<RoleEntryData>(roleEntryType, {
          role,
          timestamp: event.message.timestamp,
        })
      }
      return
    }
    if (role !== 'assistant') return
    if (assistantHeaderPending) {
      openAssistant(
        assistantCandidate ?? {
          label: prettyModel(ctx.model?.id),
          role,
          timestamp: event.message.timestamp,
        },
      )
    }
    header?.onMessage(event.message.timestamp)
  })

  pi.on('message_end', (event) => {
    if (event.message.role === 'user' && assistantCandidate !== undefined) {
      openAssistant(assistantCandidate)
    }
    if (event.message.role === 'assistant') {
      totals = addMessageUsage(totals, event.message)
    }
  })

  pi.on('agent_end', () => {
    header?.onClose()
    const run = totals
    totals = emptyRunTotals()
    assistantCandidate = undefined
    const entry = toUsageEntry(run, Date.now())
    if (enabled && hasUsage(entry)) {
      pi.appendEntry<UsageEntryData>(timestampEntryType, entry)
    }
  })

  pi.registerEntryRenderer<RoleEntryData>(roleEntryType, (entry, _options, theme) => {
    if (entry.data === undefined) return undefined
    const { label, role, timestamp } = entry.data
    return new SpeakerHeaderComponent(
      {
        assistant: role === 'assistant',
        glyph: roleGlyph(role),
        label: roleLabel(role, label),
        timestamp,
      },
      theme,
      role === 'assistant' ? header?.source : undefined,
      () => enabled,
    )
  })

  pi.registerEntryRenderer<UsageEntryData>(timestampEntryType, (entry, _options, theme) => {
    const data = entry.data
    if (data === undefined || !hasUsage(data)) return undefined
    return {
      invalidate: () => undefined,
      render: (width: number): string[] =>
        enabled ? new Text(theme.fg('dim', formatUsageRow(data)), 1, 0).render(width) : [],
    }
  })

  pi.registerCommand('hud-timestamp', {
    description: 'Toggle the transcript role headers and the usage row',
    handler: async (_args, ctx) => {
      enabled = !enabled
      ctx.ui.notify(`hud: timestamps ${enabled ? 'enabled' : 'disabled'}`, 'info')
    },
  })

  return () => enabled
}
