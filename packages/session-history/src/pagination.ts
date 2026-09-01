import { createHash } from 'node:crypto'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const CursorSchema = Type.Object(
  {
    action: Type.String(),
    fingerprint: Type.String(),
    offset: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export interface CursorState {
  action: string
  fingerprint: string
  offset: number
}

export class InvalidCursorError extends Error {}

export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 20)
}

export function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64url')
}

export function decodeCursor(
  cursor: string | undefined,
  action: string,
  currentFingerprint: string,
): number {
  if (cursor === undefined) return 0
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!Value.Check(CursorSchema, decoded)) throw new InvalidCursorError('The cursor is invalid.')
    const state = Value.Decode(CursorSchema, decoded)
    if (state.action !== action || state.fingerprint !== currentFingerprint) {
      throw new InvalidCursorError('The cursor is invalid because the session history changed.')
    }
    return state.offset
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error
    throw new InvalidCursorError('The cursor is invalid.')
  }
}

export function paginate<Item>(
  items: readonly Item[],
  limit: number,
  offset: number,
  action: string,
  currentFingerprint: string,
): { items: Item[]; nextCursor: string | null; offset: number; total: number } {
  const page = items.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    items: page,
    nextCursor:
      nextOffset < items.length
        ? encodeCursor({ action, fingerprint: currentFingerprint, offset: nextOffset })
        : null,
    offset,
    total: items.length,
  }
}
