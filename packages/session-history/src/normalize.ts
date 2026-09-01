import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import { entryReference } from './references.ts'

const secretNames = /^(authorization|cookie|password|secret|token)$/i
const defaultContentLimit = Number.MAX_SAFE_INTEGER
const maximumDepth = 6
const maximumCollectionItems = 50

const StringSchema = Type.String()
const ScalarSchema = Type.Union([Type.Null(), Type.Boolean(), Type.Number()])
const ObjectSchema = Type.Object({}, { additionalProperties: true })
const CustomScalarSchema = Type.Union([StringSchema, ScalarSchema])

type Payload = Static<typeof ObjectSchema>
type CustomScalar = Static<typeof CustomScalarSchema>
type SerializableValue = CustomScalar | Payload | readonly SerializableValue[]
type SafeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; data: string; mimeType: string }
type SafeContent = string | readonly SafeContentBlock[]

export type EntrySource =
  | 'assistant_message'
  | 'branch_summary'
  | 'compaction_summary'
  | 'custom_message'
  | 'session_event'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'user_message'

export interface NormalizedEntry {
  id: string
  parentId: string | null
  type: string
  role: string | null
  date: string
  content: string
  source: EntrySource
  branchState: 'active' | 'abandoned'
  reference: string
  truncated: boolean
  redacted: boolean
  toolCallId: string | null
  toolName: string | null
  isError: boolean | null
}

interface SerializedValue {
  text: string
  redacted: boolean
  truncated: boolean
}

function serializeValue(value: SerializableValue, depth = 0, fieldName = ''): SerializedValue {
  if (secretNames.test(fieldName)) {
    return { text: '"[REDACTED]"', redacted: true, truncated: false }
  }
  if (Value.Check(CustomScalarSchema, value)) {
    return { text: JSON.stringify(value), redacted: false, truncated: false }
  }
  if (depth >= maximumDepth) {
    return { text: '"[TRUNCATED]"', redacted: false, truncated: true }
  }
  if (Array.isArray(value)) {
    const parts = value
      .slice(0, maximumCollectionItems)
      .map((item) => serializeValue(item, depth + 1))
    const suffix = value.length > maximumCollectionItems ? ',"[TRUNCATED]"' : ''
    return {
      text: `[${parts.map((part) => part.text).join(',')}${suffix}]`,
      redacted: parts.some((part) => part.redacted),
      truncated: value.length > maximumCollectionItems || parts.some((part) => part.truncated),
    }
  }
  const parts: string[] = []
  let redacted = false
  let truncated = false
  for (const [key, item] of Object.entries(value).slice(0, maximumCollectionItems)) {
    const serialized = serializeValue(item, depth + 1, key)
    redacted ||= serialized.redacted
    truncated ||= serialized.truncated
    parts.push(`${JSON.stringify(key)}:${serialized.text}`)
  }
  if (Object.keys(value).length > maximumCollectionItems) {
    parts.push('"[TRUNCATED]":true')
    truncated = true
  }
  return { text: `{${parts.join(',')}}`, redacted, truncated }
}

function decodePayload<Input>(value: Input): Payload | null {
  try {
    return Value.Decode(ObjectSchema, value)
  } catch {
    return null
  }
}

function decodeCustomScalar<Input>(value: Input): CustomScalar | null {
  try {
    return Value.Decode(CustomScalarSchema, value)
  } catch {
    return null
  }
}

function serializeCustomValue<Input>(value: Input): SerializedValue {
  const payload = decodePayload(value)
  if (payload !== null) return serializeValue(payload)
  const scalar = decodeCustomScalar(value)
  return scalar === null
    ? { text: '[unsupported custom data]', redacted: false, truncated: false }
    : { text: JSON.stringify(scalar), redacted: false, truncated: false }
}

function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  return { text: `${text.slice(0, Math.max(0, limit - 1))}…`, truncated: true }
}

function textContent(content: SafeContent): string {
  if (Value.Check(StringSchema, content)) return content
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'thinking') parts.push(block.thinking)
    else parts.push(`[image ${block.mimeType}]`)
  }
  return parts.join('\n')
}

function baseEntry(
  entry: SessionEntry,
  sessionId: string,
  activeIds: ReadonlySet<string>,
  content: string,
  source: EntrySource,
  role: string | null,
  options: {
    isError?: boolean | null
    limit?: number
    redacted?: boolean
    truncated?: boolean
    toolCallId?: string | null
    toolName?: string | null
    type?: string
  } = {},
): NormalizedEntry {
  const limited = truncate(content, options.limit ?? defaultContentLimit)
  return {
    id: entry.id,
    parentId: entry.parentId,
    type: options.type ?? entry.type,
    role,
    date: entry.timestamp,
    content: limited.text,
    source,
    branchState: activeIds.has(entry.id) ? 'active' : 'abandoned',
    reference: entryReference(sessionId, entry.id),
    truncated: limited.truncated || options.truncated === true,
    redacted: options.redacted ?? false,
    toolCallId: options.toolCallId ?? null,
    toolName: options.toolName ?? null,
    isError: options.isError ?? null,
  }
}

export function normalizeEntry(
  entry: SessionEntry,
  sessionId: string,
  activeIds: ReadonlySet<string>,
  includeToolPayloads = false,
): NormalizedEntry[] {
  if (entry.type === 'message') {
    const message = entry.message
    if (!('role' in message)) {
      return [
        baseEntry(entry, sessionId, activeIds, '[unsupported message role]', 'session_event', null),
      ]
    }
    if (message.role === 'user') {
      return [
        baseEntry(
          entry,
          sessionId,
          activeIds,
          textContent(message.content),
          'user_message',
          'user',
        ),
      ]
    }
    if (message.role === 'toolResult') {
      return [
        baseEntry(
          entry,
          sessionId,
          activeIds,
          textContent(message.content),
          'tool_result',
          'tool',
          {
            isError: message.isError,
            toolCallId: message.toolCallId,
            toolName: message.toolName,
          },
        ),
      ]
    }
    if (message.role === 'assistant') {
      const normalized: NormalizedEntry[] = []
      for (const block of message.content) {
        if (block.type === 'text') {
          normalized.push(
            baseEntry(entry, sessionId, activeIds, block.text, 'assistant_message', 'assistant'),
          )
        } else if (block.type === 'thinking') {
          normalized.push(
            baseEntry(entry, sessionId, activeIds, block.thinking, 'thinking', 'assistant'),
          )
        } else if (block.type === 'toolCall') {
          const serialized = serializeValue(block.arguments)
          normalized.push(
            baseEntry(
              entry,
              sessionId,
              activeIds,
              includeToolPayloads ? serialized.text : '[tool payload omitted]',
              'tool_call',
              'assistant',
              {
                redacted: serialized.redacted,
                truncated: includeToolPayloads ? serialized.truncated : true,
                toolCallId: block.id,
                toolName: block.name,
              },
            ),
          )
        }
      }
      return normalized
    }
    return [
      baseEntry(
        entry,
        sessionId,
        activeIds,
        '[unsupported message role]',
        'session_event',
        message.role,
      ),
    ]
  }
  if (entry.type === 'custom_message') {
    return [
      baseEntry(
        entry,
        sessionId,
        activeIds,
        textContent(entry.content),
        'custom_message',
        'custom',
      ),
    ]
  }
  if (entry.type === 'compaction') {
    return [baseEntry(entry, sessionId, activeIds, entry.summary, 'compaction_summary', null)]
  }
  if (entry.type === 'branch_summary') {
    return [baseEntry(entry, sessionId, activeIds, entry.summary, 'branch_summary', null)]
  }
  if (entry.type === 'model_change') {
    return [
      baseEntry(
        entry,
        sessionId,
        activeIds,
        `${entry.provider}/${entry.modelId}`,
        'session_event',
        null,
      ),
    ]
  }
  if (entry.type === 'thinking_level_change') {
    return [baseEntry(entry, sessionId, activeIds, entry.thinkingLevel, 'session_event', null)]
  }
  if (entry.type === 'custom') {
    const serialized = serializeCustomValue(entry.data)
    return [
      baseEntry(entry, sessionId, activeIds, serialized.text, 'session_event', null, {
        redacted: serialized.redacted,
        truncated: serialized.truncated,
      }),
    ]
  }
  return [baseEntry(entry, sessionId, activeIds, entry.type, 'session_event', null)]
}

export function limitNormalizedEntries(
  entries: readonly NormalizedEntry[],
  limit = 2_000,
): NormalizedEntry[] {
  return entries.map((entry) => {
    const limited = truncate(entry.content, limit)
    return {
      ...entry,
      content: limited.text,
      truncated: entry.truncated || limited.truncated,
    }
  })
}

export function normalizeEntries(
  entries: readonly SessionEntry[],
  sessionId: string,
  activeIds: ReadonlySet<string>,
  includeToolPayloads = false,
): NormalizedEntry[] {
  return entries.flatMap((entry) =>
    normalizeEntry(entry, sessionId, activeIds, includeToolPayloads),
  )
}
