import { expectTypeOf, it } from 'vite-plus/test'

import type { SessionHistoryInput } from '../src/index.ts'

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
