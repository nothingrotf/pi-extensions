import type { NormalizedEntry } from './normalize.ts'

export interface SearchableSession {
  id: string
  name: string
  modified: string
  entries: NormalizedEntry[]
}

export interface SearchFilters {
  roles?: readonly string[]
  entryTypes?: readonly string[]
}

export interface SearchResult {
  score: number
  sessionId: string
  entryId: string
  role: string | null
  entryType: string
  date: string
  snippet: string
  snippetTruncated: boolean
  matchedTerms: string[]
  reference: string
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .split(/\s+/u)
        .filter((term) => term.length > 0),
    ),
  ]
}

function countOccurrences(text: string, term: string): number {
  let count = 0
  let offset = 0
  while (offset < text.length) {
    const index = text.indexOf(term, offset)
    if (index < 0) break
    count += 1
    offset = index + Math.max(1, term.length)
  }
  return count
}

function snippet(text: string, terms: readonly string[], limit = 320): string {
  const lower = text.toLocaleLowerCase()
  const positions = terms.map((term) => lower.indexOf(term)).filter((position) => position >= 0)
  const first = positions.length === 0 ? 0 : Math.min(...positions)
  const start = Math.max(0, first - Math.floor(limit / 3))
  const end = Math.min(text.length, start + limit)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export function searchSessions(
  sessions: readonly SearchableSession[],
  query: string,
  filters: SearchFilters = {},
): SearchResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (normalizedQuery.length < 2)
    throw new Error('A search query needs at least two visible characters.')
  const terms = queryTerms(normalizedQuery)
  const results: SearchResult[] = []
  for (const session of sessions) {
    const normalizedName = session.name.toLocaleLowerCase()
    const resultCountBeforeSession = results.length
    for (const entry of session.entries) {
      if (filters.roles !== undefined && !filters.roles.includes(entry.role ?? 'none')) continue
      if (filters.entryTypes !== undefined && !filters.entryTypes.includes(entry.source)) continue
      const normalizedContent = entry.content.toLocaleLowerCase()
      const matchedTerms = terms.filter((term) => normalizedContent.includes(term))
      if (matchedTerms.length === 0) continue
      const exactPhrase = normalizedContent.includes(normalizedQuery)
      const exactName = normalizedName === normalizedQuery
      const partialName = normalizedName.includes(normalizedQuery)
      const occurrences = matchedTerms.reduce(
        (total, term) => total + countOccurrences(normalizedContent, term),
        0,
      )
      const score =
        (exactPhrase ? 1_000 : 0) +
        (exactName ? 700 : partialName ? 500 : 0) +
        matchedTerms.length * 100 +
        Math.min(occurrences, 20)
      results.push({
        score,
        sessionId: session.id,
        entryId: entry.id,
        role: entry.role,
        entryType: entry.source,
        date: entry.date,
        snippet: snippet(entry.content, matchedTerms),
        snippetTruncated: entry.content.length > 320,
        matchedTerms,
        reference: entry.reference,
      })
    }
    if (results.length === resultCountBeforeSession && normalizedName.includes(normalizedQuery)) {
      const entry = session.entries.find(
        (candidate) =>
          (filters.roles === undefined || filters.roles.includes(candidate.role ?? 'none')) &&
          (filters.entryTypes === undefined || filters.entryTypes.includes(candidate.source)),
      )
      if (entry !== undefined) {
        const matchedTerms = terms.filter((term) => normalizedName.includes(term))
        results.push({
          score:
            1_000 + (normalizedName === normalizedQuery ? 700 : 500) + matchedTerms.length * 100,
          sessionId: session.id,
          entryId: entry.id,
          role: entry.role,
          entryType: entry.source,
          date: entry.date,
          snippet: snippet(entry.content, []),
          snippetTruncated: entry.content.length > 320,
          matchedTerms,
          reference: entry.reference,
        })
      }
    }
  }
  return results.sort(
    (left, right) =>
      right.score - left.score ||
      Date.parse(right.date) - Date.parse(left.date) ||
      left.sessionId.localeCompare(right.sessionId) ||
      left.entryId.localeCompare(right.entryId),
  )
}
