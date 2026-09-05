import {
  buildContextEntries,
  CURRENT_SESSION_VERSION,
  migrateSessionEntries,
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { sessionBatches } from './session-file.ts'
import { HistoryWork } from './work.ts'

const HeaderSchema = Type.Object({
  type: Type.Literal('session'),
  id: Type.String({ minLength: 1 }),
  cwd: Type.String(),
  version: Type.Optional(Type.Integer()),
})
const EntrySchema = Type.Object({
  type: Type.String({ minLength: 1, pattern: '^(?!session$)' }),
  id: Type.String({ minLength: 1 }),
  parentId: Type.Union([Type.String(), Type.Null()]),
  timestamp: Type.String(),
})

export class SnapshotError extends Error {
  constructor(readonly code: 'MALFORMED_SESSION' | 'UNSUPPORTED_SESSION_VERSION') {
    super(
      code === 'MALFORMED_SESSION'
        ? 'The session file is malformed.'
        : 'The session version is not supported.',
    )
  }
}

export async function readSnapshot(
  path: string,
  sessionId: string,
  work: HistoryWork,
  expectedVersion: string,
) {
  let header: SessionHeader | undefined
  const entries: SessionEntry[] = []
  const byId = new Map<string, SessionEntry>()
  for await (const batch of sessionBatches(path, work, expectedVersion)) {
    for (const line of batch) {
      if (line.trim().length === 0) continue
      const entry = parseSessionEntries(line)[0]
      if (header === undefined) {
        if (!Value.Check(HeaderSchema, entry) || entry.id !== sessionId)
          throw new SnapshotError('MALFORMED_SESSION')
        if (
          entry.version === undefined ||
          entry.version < 2 ||
          entry.version > CURRENT_SESSION_VERSION
        )
          throw new SnapshotError('UNSUPPORTED_SESSION_VERSION')
        header = entry
        continue
      }
      if (
        !Value.Check(EntrySchema, entry) ||
        !Number.isFinite(Date.parse(entry.timestamp)) ||
        byId.has(entry.id) ||
        (entry.parentId !== null && !byId.has(entry.parentId))
      )
        throw new SnapshotError('MALFORMED_SESSION')
      work.normalize(1)
      entries.push(entry)
      byId.set(entry.id, entry)
    }
  }
  if (header === undefined) throw new SnapshotError('MALFORMED_SESSION')
  migrateSessionEntries([header, ...entries])
  const activeIds = new Set<string>()
  let leaf = entries.at(-1)
  while (leaf !== undefined) {
    activeIds.add(leaf.id)
    leaf = leaf.parentId === null ? undefined : byId.get(leaf.parentId)
  }
  return {
    entries,
    activeIds,
    context: buildContextEntries(entries, undefined, byId),
    cwd: header.cwd,
  }
}
