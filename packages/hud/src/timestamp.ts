import type { AssistantMessage } from '@earendil-works/pi-ai'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { prettyModel } from './format.ts'
import {
  formatSpeakerClock,
  SpeakerHeaderComponent,
  type SpeakerHeaderSource,
} from './speaker-header.ts'
import { frameTranscriptLine, speakerBodyIndent } from './transcript-geometry.ts'
import { formatWorkingFrame, type WorkingFrame, WorkingStatus } from './working.ts'

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

export function formatTokens(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function formatSpan(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
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
  return `$${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}`
}

export function hasUsage(data: UsageEntryData): boolean {
  return data.input > 0 || data.output > 0
}

export function formatUsageRow(data: UsageEntryData): string {
  const parts: string[] = []
  if (data.durationMs !== undefined) parts.push(formatSpan(data.durationMs))
  parts.push(formatCost(data.cost))
  parts.push(`${formatTokens(data.input)} in`)
  parts.push(`${formatTokens(data.output)} out`)
  const cached = data.input > 0 ? Math.min(100, Math.round((data.cacheRead / data.input) * 100)) : 0
  parts.push(`⛁ ${cached}% cached`)
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

export type LiveUsage = {
  row: () => string | undefined
  waiting: () => WorkingFrame | undefined
}

export type LiveHeader = {
  onClose: () => void
  onMessage: (timestamp: number) => void
  onOpen: (timestamp: number) => void
  source: SpeakerHeaderSource
}

export type TimestampControls = {
  enabled: () => boolean
  toggle: () => boolean
}

export function assistantHasResponse(message: AssistantMessage): boolean {
  return message.content.some((block) => {
    if (block.type === 'toolCall') return true
    if (block.type === 'text') return block.text.trim().length > 0
    return block.thinking.trim().length > 0
  })
}

export function registerTimestamps(
  pi: ExtensionAPI,
  live?: LiveUsage,
  header?: LiveHeader,
  working = new WorkingStatus(),
): TimestampControls {
  let enabled = true
  let totals = emptyRunTotals()
  let assistantHeaderPending = true
  let assistantResponded = false
  let assistantCandidate: RoleEntryData | undefined

  const openAssistant = (data: RoleEntryData) => {
    if (!enabled || !assistantHeaderPending) return
    assistantHeaderPending = false
    assistantCandidate = undefined
    header?.onOpen(data.timestamp)
    pi.appendEntry<RoleEntryData>(roleEntryType, data)
  }

  if (live !== undefined) {
    const waiting = (): WorkingFrame | undefined => {
      if (!enabled || totals.startedAt === undefined || assistantResponded) return undefined
      return working.frame(totals.startedAt)
    }
    live.waiting = waiting
    live.row = () => {
      if (!enabled || totals.startedAt === undefined) return undefined
      const pending = waiting()
      if (pending !== undefined) return formatWorkingFrame(pending)
      if (working.overridden()) return formatWorkingFrame(working.frame(totals.startedAt))
      return formatUsageRow(toUsageEntry(totals, Date.now()))
    }
  }

  pi.on('agent_start', () => {
    totals = emptyRunTotals()
    assistantHeaderPending = true
    assistantResponded = false
    assistantCandidate = undefined
  })

  pi.on('turn_start', (event, ctx) => {
    if (totals.startedAt === undefined) {
      totals = { ...totals, startedAt: Date.now() }
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
    if (assistantHasResponse(event.message)) assistantResponded = true
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

  pi.on('message_update', (event) => {
    if (event.message.role === 'assistant' && assistantHasResponse(event.message)) {
      assistantResponded = true
    }
  })

  pi.on('message_end', (event) => {
    if (event.message.role === 'user' && assistantCandidate !== undefined) {
      openAssistant(assistantCandidate)
    }
    if (event.message.role === 'assistant') {
      if (assistantHasResponse(event.message)) assistantResponded = true
      totals = addMessageUsage(totals, event.message)
    }
  })

  pi.on('agent_end', () => {
    header?.onClose()
    const run = totals
    totals = emptyRunTotals()
    assistantResponded = false
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
        enabled
          ? [frameTranscriptLine(theme.fg('dim', formatUsageRow(data)), width, speakerBodyIndent)]
          : [],
    }
  })

  return {
    enabled: () => enabled,
    toggle: () => {
      enabled = !enabled
      return enabled
    },
  }
}
