import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { expect, expectTypeOf, it } from 'vite-plus/test'

import type { SessionHistoryInput } from '../src/index.ts'
import { SessionHistorySchema } from '../src/schema.ts'

it('preserves action-specific required input types', () => {
  expectTypeOf<SessionHistoryInput['action']>().toEqualTypeOf<
    'list' | 'search' | 'read' | 'timeline' | 'tool_activity' | 'content'
  >()
  expectTypeOf<
    Extract<SessionHistoryInput, { action: 'search' }>['query']
  >().toEqualTypeOf<string>()
  expectTypeOf<
    Extract<SessionHistoryInput, { action: 'read' }>['session_id']
  >().toEqualTypeOf<string>()
  expectTypeOf<
    Extract<SessionHistoryInput, { action: 'content' }>['entry_id']
  >().toEqualTypeOf<string>()
  expectTypeOf<{ action: 'search' }>().not.toExtend<SessionHistoryInput>()
  expectTypeOf<{ action: 'read' }>().not.toExtend<SessionHistoryInput>()
  expectTypeOf<{ action: 'content'; session_id: string }>().not.toExtend<SessionHistoryInput>()
})

it('declares every action field at the top level for providers that drop unions', () => {
  const topLevel = Value.Parse(
    Type.Object({
      properties: Type.Record(Type.String(), Type.Unknown()),
      required: Type.Array(Type.String()),
    }),
    SessionHistorySchema,
  )
  expect(topLevel.required).toEqual(['action'])
  expect(topLevel.properties).toMatchObject({
    block_index: { type: 'integer' },
    include_children: { type: 'boolean' },
    query: { type: 'string' },
    session_id: { type: 'string' },
  })
  expect(Value.Check(SessionHistorySchema, { action: 'search', query: 'deploy' })).toBe(true)
  expect(Value.Check(SessionHistorySchema, { action: 'search' })).toBe(false)
  expect(Value.Check(SessionHistorySchema, { action: 'list', query: 'deploy' })).toBe(false)
})
