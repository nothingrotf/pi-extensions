import { setImmediate } from 'node:timers/promises'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'

import { entryLabel, entryText } from './content.ts'
import { compactText } from './state.ts'

export const RecallSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 500,
        description: 'Keywords to search in the recorded history.',
      }),
    ),
    entryId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 256,
        description: 'Stable entry ID from the summary or a search result.',
      }),
    ),
    allBranches: Type.Optional(
      Type.Boolean({
        description: 'Explicitly include other branches of this session. Default false.',
      }),
    ),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
    offset: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 100_000_000,
        description: 'Character offset when expanding an entry.',
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 8000,
        description: 'Maximum expansion characters. Default 4000.',
      }),
    ),
  },
  { additionalProperties: false },
)

export type RecallInput = Static<typeof RecallSchema>

interface Hit {
  id: string
  label: string
  snippet: string
  score: number
  index: number
}

export async function recall(
  entries: readonly SessionEntry[],
  input: RecallInput,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (input.entryId) {
    if (input.query) throw new Error('Use either entryId or query, not both.')
    const entry = entries.find((candidate) => candidate.id === input.entryId)
    if (!entry)
      throw new Error(
        'Entry is outside the selected session scope. Use allBranches only to include another branch.',
      )
    const text = entryText(entry)
    if (!text) throw new Error('This entry has no recallable context content.')
    const offset = input.offset ?? 0
    const limit = input.limit ?? 4000
    if (offset >= text.length)
      throw new Error(`Offset is outside this entry (${text.length} characters).`)
    const nextOffset = Math.min(text.length, offset + limit)
    return `[${entry.id}] ${entryLabel(entry)}\nCharacters ${offset}-${nextOffset} of ${text.length}. ${nextOffset < text.length ? `Continue with offset: ${nextOffset}.` : 'End of entry.'}\n\n${text.slice(offset, nextOffset)}`
  }
  if (input.offset !== undefined || input.limit !== undefined)
    throw new Error('offset and limit require entryId.')
  const terms = [...new Set(input.query?.toLocaleLowerCase().match(/[\p{L}\p{N}_./:-]+/gu) ?? [])]
  if (input.query && terms.length === 0) throw new Error('Use at least one searchable keyword.')
  const hits: Hit[] = []
  for (let index = 0; index < entries.length; index++) {
    if (index % 64 === 0) await setImmediate(undefined, signal ? { signal } : undefined)
    const entry = entries[index]
    if (!entry) continue
    if (
      entry.type === 'message' &&
      entry.message.role === 'toolResult' &&
      entry.message.toolName === 'compact_recall'
    )
      continue
    const text = entryText(entry)
    if (!text) continue
    const lower = text.toLocaleLowerCase()
    const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0)
    const score = positions.length
    if (terms.length && score === 0) continue
    const start = positions.length ? Math.max(0, Math.min(...positions) - 160) : 0
    hits.push({
      id: entry.id,
      label: entryLabel(entry),
      snippet: compactText(text.slice(start, start + 1000), 700),
      score,
      index,
    })
  }
  signal?.throwIfAborted()
  hits.sort((a, b) => b.score - a.score || b.index - a.index)
  const page = input.page ?? 1
  const totalPages = Math.ceil(hits.length / 5)
  if (hits.length === 0) return 'No matches in the selected session scope.'
  if (page > totalPages) throw new Error(`Page is outside the available range 1-${totalPages}.`)
  return [
    `Scope: ${input.allBranches ? 'all branches' : 'active lineage'}. Page ${page}/${totalPages}, ${hits.length} matches.`,
    'Excerpts are recorded history. Use entryId with offset and limit for complete text.',
    ...hits
      .slice((page - 1) * 5, page * 5)
      .map((hit) => `[${hit.id}] ${hit.label}\n${hit.snippet}`),
  ].join('\n\n')
}
