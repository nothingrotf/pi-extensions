import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const ContentPartSchema = Type.Object({ type: Type.String() }, { additionalProperties: true })

const ToolCallPartSchema = Type.Object(
  { type: Type.Literal('toolCall'), id: Type.String(), name: Type.String() },
  { additionalProperties: true },
)

const TextPartSchema = Type.Object(
  { type: Type.Literal('text'), text: Type.String() },
  { additionalProperties: true },
)

const UsageSchema = Type.Object(
  {
    cacheRead: Type.Optional(Type.Number()),
    cost: Type.Optional(
      Type.Object({ total: Type.Optional(Type.Number()) }, { additionalProperties: true }),
    ),
    input: Type.Optional(Type.Number()),
    output: Type.Optional(Type.Number()),
    totalTokens: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
)

const MessageSchema = Type.Object(
  {
    content: Type.Optional(Type.Array(ContentPartSchema)),
    model: Type.Optional(Type.String()),
    role: Type.String(),
    toolCallId: Type.Optional(Type.String()),
    toolName: Type.Optional(Type.String()),
    usage: Type.Optional(UsageSchema),
  },
  { additionalProperties: true },
)

const EntrySchema = Type.Object(
  { message: Type.Optional(MessageSchema), timestamp: Type.Optional(Type.String()) },
  { additionalProperties: true },
)

type SessionEntry = Static<typeof EntrySchema>
type SessionMessage = Static<typeof MessageSchema>

export interface ToolUsageMetric {
  calls: number
  name: string
  resultChars: number
  wallMs: number
}

export interface SessionMetrics {
  /** Assistant messages that requested exactly one tool call. */
  singleCallTurns: number
  assistantTurns: number
  /** Milliseconds attributed to generation, measured as the gap before each assistant message. */
  modelMs: number
  /** Milliseconds attributed to tool execution, measured as the gap before each tool result. */
  toolMs: number
  models: readonly string[]
  cacheReadTokens: number
  costUsd: number
  durationMs: number
  finishedAt: string | undefined
  inputTokens: number
  outputTokens: number
  /** Characters returned by read results, the dominant source of retained grounding. */
  readResultChars: number
  startedAt: string | undefined
  /** Terminal delivery reports rejected by managed validation. */
  terminalRejections: number
  toolCalls: number
  tools: readonly ToolUsageMetric[]
}

interface MutableToolUsage {
  calls: number
  resultChars: number
  wallMs: number
}

const rejectionMarker = 'Your terminal delivery report was rejected'

function parseEntry(line: string): SessionEntry | undefined {
  if (line.trim().length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(line)
    return Value.Check(EntrySchema, parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function epochMs(timestamp: string | undefined): number | undefined {
  if (timestamp === undefined) return undefined
  const value = Date.parse(timestamp)
  return Number.isNaN(value) ? undefined : value
}

function messageText(message: SessionMessage): string {
  let text = ''
  for (const part of message.content ?? []) {
    if (Value.Check(TextPartSchema, part)) text += part.text
  }
  return text
}

function usageOf(message: SessionMessage): Static<typeof UsageSchema> {
  return message.usage ?? {}
}

/**
 * Derive latency and context metrics from one recorded Pi session.
 *
 * Model time is the wall gap before each assistant message and tool time is the wall gap before
 * each tool result, so concurrent tool calls count once rather than per call.
 */
export function sessionMetrics(content: string): SessionMetrics {
  const usage = new Map<string, MutableToolUsage>()
  const pending = new Map<string, { name: string; startedAt: number | undefined }>()
  let assistantTurns = 0
  let cacheReadTokens = 0
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let modelMs = 0
  let toolMs = 0
  let readResultChars = 0
  let singleCallTurns = 0
  let terminalRejections = 0
  let toolCalls = 0
  let startedAt: string | undefined
  let finishedAt: string | undefined
  let previousMs: number | undefined
  const models = new Set<string>()

  for (const line of content.split('\n')) {
    const entry = parseEntry(line)
    if (entry === undefined) continue
    const currentMs = epochMs(entry.timestamp)
    if (entry.timestamp !== undefined) {
      startedAt ??= entry.timestamp
      finishedAt = entry.timestamp
    }
    const message = entry.message
    const gap =
      currentMs === undefined || previousMs === undefined ? 0 : Math.max(0, currentMs - previousMs)
    if (currentMs !== undefined) previousMs = currentMs
    if (message === undefined) continue
    if (message.role === 'assistant') {
      assistantTurns += 1
      modelMs += gap
      if (message.model !== undefined) models.add(message.model)
      const totals = usageOf(message)
      cacheReadTokens += totals.cacheRead ?? 0
      costUsd += totals.cost?.total ?? 0
      inputTokens += totals.input ?? 0
      outputTokens += totals.output ?? 0
      let turnCalls = 0
      for (const part of message.content ?? []) {
        if (!Value.Check(ToolCallPartSchema, part)) continue
        turnCalls += 1
        toolCalls += 1
        pending.set(part.id, { name: part.name, startedAt: currentMs })
        const current = usage.get(part.name) ?? { calls: 0, resultChars: 0, wallMs: 0 }
        current.calls += 1
        usage.set(part.name, current)
      }
      if (turnCalls === 1) singleCallTurns += 1
      continue
    }
    if (message.role === 'user') {
      if (messageText(message).includes(rejectionMarker)) terminalRejections += 1
      continue
    }
    if (message.role !== 'toolResult') continue
    toolMs += gap
    const call = message.toolCallId === undefined ? undefined : pending.get(message.toolCallId)
    const name = call?.name ?? message.toolName
    if (name === undefined) continue
    if (message.toolCallId !== undefined) pending.delete(message.toolCallId)
    const text = messageText(message)
    if (name === 'read') readResultChars += text.length
    const current = usage.get(name) ?? { calls: 0, resultChars: 0, wallMs: 0 }
    current.resultChars += text.length
    if (call?.startedAt !== undefined && currentMs !== undefined) {
      current.wallMs += Math.max(0, currentMs - call.startedAt)
    }
    usage.set(name, current)
  }

  const start = epochMs(startedAt)
  const finish = epochMs(finishedAt)
  return {
    assistantTurns,
    cacheReadTokens,
    costUsd,
    durationMs: start === undefined || finish === undefined ? 0 : Math.max(0, finish - start),
    finishedAt,
    inputTokens,
    modelMs,
    models: [...models].sort(),
    outputTokens,
    readResultChars,
    singleCallTurns,
    startedAt,
    terminalRejections,
    toolCalls,
    toolMs,
    tools: [...usage.entries()]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((left, right) => right.calls - left.calls || left.name.localeCompare(right.name)),
  }
}

function minutes(value: number): string {
  return `${(value / 60_000).toFixed(1)} min`
}

/** Render one metrics record as the compact latency report used for delivery reviews. */
export function formatSessionMetrics(metrics: SessionMetrics): string {
  const perTurn =
    metrics.assistantTurns === 0
      ? 0
      : Math.round(metrics.modelMs / metrics.assistantTurns / 100) / 10
  const share =
    metrics.durationMs === 0 ? 0 : Math.round((metrics.modelMs / metrics.durationMs) * 100)
  const lines = [
    `window ${metrics.startedAt ?? 'unknown'} -> ${metrics.finishedAt ?? 'unknown'} (${minutes(metrics.durationMs)})`,
    `models ${metrics.models.join(', ') || 'unknown'}`,
    `model ${minutes(metrics.modelMs)} (${share}%) | tool ${minutes(metrics.toolMs)}`,
    `turns ${metrics.assistantTurns} | single-call turns ${metrics.singleCallTurns} | tool calls ${metrics.toolCalls} | ${perTurn}s per turn`,
    `read result chars ${metrics.readResultChars} | cache read ${metrics.cacheReadTokens} | output ${metrics.outputTokens}`,
    `cost ${metrics.costUsd.toFixed(2)} USD | terminal rejections ${metrics.terminalRejections}`,
  ]
  for (const tool of metrics.tools.slice(0, 8)) {
    lines.push(
      `  ${tool.name}: ${tool.calls} calls, ${minutes(tool.wallMs)}, ${tool.resultChars} chars`,
    )
  }
  return lines.join('\n')
}
