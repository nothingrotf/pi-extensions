import { describe, expect, it } from 'vite-plus/test'

import type { NormalizedEntry } from '../src/normalize.ts'
import { searchSessions } from '../src/search.ts'

function entry(id: string, content: string, date: string): NormalizedEntry {
  return {
    id,
    parentId: null,
    type: 'message',
    role: 'user',
    date,
    content,
    source: 'user_message',
    branchState: 'active',
    reference: `pi-session://session/${id}`,
    truncated: false,
    redacted: false,
    toolCallId: null,
    toolName: null,
    isError: null,
  }
}

describe('session search', () => {
  it('ranks exact phrases above separate terms', () => {
    const results = searchSessions(
      [
        {
          id: 'session',
          name: 'Untitled session',
          modified: '2026-01-01T00:00:00.000Z',
          entries: [
            entry('separate', 'alpha content then beta content', '2026-01-02T00:00:00.000Z'),
            entry('exact', 'the alpha beta phrase', '2026-01-01T00:00:00.000Z'),
          ],
        },
      ],
      'alpha beta',
    )

    expect(results.map((result) => result.entryId)).toEqual(['exact', 'separate'])
    expect(results[0]?.matchedTerms).toEqual(['alpha', 'beta'])
  })

  it('uses dates and stable identifiers for deterministic ties', () => {
    const results = searchSessions(
      [
        {
          id: 'b-session',
          name: 'Untitled session',
          modified: '2026-01-01T00:00:00.000Z',
          entries: [entry('entry', 'same term', '2026-01-01T00:00:00.000Z')],
        },
        {
          id: 'a-session',
          name: 'Untitled session',
          modified: '2026-01-01T00:00:00.000Z',
          entries: [entry('entry', 'same term', '2026-01-01T00:00:00.000Z')],
        },
        {
          id: 'newer-session',
          name: 'Untitled session',
          modified: '2026-01-02T00:00:00.000Z',
          entries: [entry('entry', 'same term', '2026-01-02T00:00:00.000Z')],
        },
      ],
      'same',
    )

    expect(results.map((result) => result.sessionId)).toEqual([
      'newer-session',
      'a-session',
      'b-session',
    ])
  })

  it('filters roles and entry types', () => {
    const user = entry('user', 'needle', '2026-01-01T00:00:00.000Z')
    const tool: NormalizedEntry = {
      ...entry('tool', 'needle', '2026-01-02T00:00:00.000Z'),
      role: 'tool',
      source: 'tool_result',
    }
    const sessions = [
      {
        id: 'session',
        name: 'Untitled session',
        modified: '2026-01-02T00:00:00.000Z',
        entries: [user, tool],
      },
    ]

    expect(
      searchSessions(sessions, 'needle', { roles: ['tool'] }).map((result) => result.entryId),
    ).toEqual(['tool'])
    expect(
      searchSessions(sessions, 'needle', { entryTypes: ['user_message'] }).map(
        (result) => result.entryId,
      ),
    ).toEqual(['user'])
  })

  it('rejects queries with fewer than two visible characters', () => {
    expect(() => searchSessions([], ' x ')).toThrow('at least two visible characters')
  })
})
