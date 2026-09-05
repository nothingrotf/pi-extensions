import type { NormalizedEntry } from './normalize.ts'
import { decodeCursor, encodeCursor, fingerprint, InvalidCursorError } from './pagination.ts'
import type { ContentReadInput } from './schema.ts'

export interface ContentChunk extends NormalizedEntry {
  blockIndex: number
  blockCount: number
  chunkReference: string
  sourceTruncated: boolean
  payloadOmitted: boolean
}

export interface ContentWindow {
  chunk: ContentChunk
  pagination: {
    cursor: string | null
    previousCursor: string | null
    offset: number
    end: number
    total: number
  }
}

export function contentWindow(
  entry: NormalizedEntry,
  blockIndex: number,
  blockCount: number,
  input: ContentReadInput,
): ContentWindow {
  const limit = input.limit ?? 2_000
  const payloadOmitted =
    input.include_tool_payloads !== true &&
    (entry.source === 'tool_call' || entry.source === 'tool_result')
  const content = payloadOmitted ? '[tool payload omitted]' : entry.content
  const version = fingerprint(JSON.stringify([content, entry.truncated, entry.redacted]))
  const identity = fingerprint(
    JSON.stringify([
      entry.reference,
      blockIndex,
      version,
      input.view ?? 'active',
      input.include_tool_payloads ?? false,
      limit,
    ]),
  )
  const offset =
    input.cursor === undefined
      ? (input.offset ?? 0)
      : decodeCursor(input.cursor, 'content', identity)
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > content.length) {
    throw new InvalidCursorError('The content offset is outside the available content.')
  }
  const end = Math.min(content.length, offset + limit)
  const cursorAt = (position: number) =>
    encodeCursor({ action: 'content', fingerprint: identity, offset: position })
  return {
    chunk: {
      ...entry,
      content: content.slice(offset, end),
      blockIndex,
      blockCount,
      chunkReference: `${entry.reference}#block=${blockIndex}&version=${version}&range=${offset}:${end}`,
      sourceTruncated: entry.truncated,
      payloadOmitted,
      truncated: entry.truncated || payloadOmitted || offset > 0 || end < content.length,
    },
    pagination: {
      cursor: end < content.length ? cursorAt(end) : null,
      previousCursor: offset > 0 ? cursorAt(Math.max(0, offset - limit)) : null,
      offset,
      end,
      total: content.length,
    },
  }
}
