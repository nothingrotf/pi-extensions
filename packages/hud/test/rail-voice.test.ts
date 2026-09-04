import type { AssistantMessage } from '@earendil-works/pi-ai'
import { describe, expect, test } from 'vite-plus/test'

import type { RailSegment } from '../src/rail-segments.ts'
import { messageSegments, projectRailVoice, RailVoice } from '../src/rail-voice.ts'

const usage = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
  input: 0,
  output: 0,
  totalTokens: 0,
}

function assistant(content: AssistantMessage['content'], timestamp = 1): AssistantMessage {
  return {
    api: 'anthropic-messages',
    content,
    model: 'test',
    provider: 'anthropic',
    role: 'assistant',
    stopReason: 'pending',
    timestamp,
    usage,
  }
}

function text(content: string, timestamp: number, contentIndex = 0): RailSegment {
  return {
    content,
    id: `narration:${String(timestamp)}:${String(contentIndex + 1)}`,
    messageContentIndex: contentIndex,
    messageTimestamp: timestamp,
    type: 'text',
  }
}

function thought(content: string, active = false): RailSegment {
  return { active, content, id: 'thought:1:1', messageTimestamp: 1, type: 'reasoning' }
}

function tools(...toolCallIds: string[]): RailSegment {
  return { toolCallIds, type: 'tools' }
}

describe('projectRailVoice', () => {
  test('keeps direct prose outside the rail', () => {
    const projection = projectRailVoice([text('answer', 1)], false)
    expect(projection.rows).toEqual([])
    expect(projection.hiddenMessageTimestamps).toEqual(new Set())
  })

  test('keeps opening prose normal and includes the thought', () => {
    const projection = projectRailVoice(
      [text('I will inspect.', 1), thought('Plan'), tools('a')],
      false,
    )
    expect(projection.rows.map((row) => row.patch.kind)).toEqual(['thought'])
    expect(projection.order).toEqual(['thought:1:1', 'a'])
    expect(projection.hiddenMessageTimestamps).toEqual(new Set())
  })

  test('turns only intermediate prose into a Note', () => {
    const projection = projectRailVoice([tools('a'), text('Found it.', 2), tools('b')], false)
    expect(projection.rows.map((row) => row.patch.doneLabel)).toEqual(['Note'])
    expect(projection.order).toEqual(['a', 'narration:2:1', 'b'])
    expect(projection.hiddenMessageTimestamps).toEqual(new Set([2]))
  })

  test('isolates narration inside a message with opening and final prose', () => {
    const projection = projectRailVoice(
      [text('Opening', 1, 0), tools('a'), text('Middle', 1, 2), tools('b'), text('Answer', 1, 4)],
      false,
    )
    expect(projection.rows.map((row) => row.patch.detail)).toEqual(['Middle'])
    expect(projection.hiddenTextBlocks).toEqual(new Map([[1, new Set([2])]]))
  })

  test('keeps a settled final answer outside the rail', () => {
    const projection = projectRailVoice([tools('a'), text('answer', 2)], false)
    expect(projection.rows).toEqual([])
    expect(projection.hiddenMessageTimestamps).toEqual(new Set())
    expect(projection.hasTrailingText).toBe(true)
  })

  test('keeps non-live partial final text provisional inside the rail', () => {
    const projection = projectRailVoice([tools('a'), text('answer', 2)], true)
    expect(projection.rows[0]?.patch.doneLabel).toBe('Note')
    expect(projection.hiddenMessageTimestamps).toEqual(new Set([2]))
  })

  test('streams live final text as normal prose', () => {
    const projection = projectRailVoice([tools('a'), text('answer', 2)], true, true)
    expect(projection.rows).toEqual([])
    expect(projection.hiddenMessageTimestamps).toEqual(new Set())
  })

  test('tracks every source block when adjacent narration coalesces', () => {
    const projection = projectRailVoice(
      [
        tools('a'),
        {
          content: 'Found ',
          id: 'n1',
          messageContentIndex: 1,
          messageTimestamp: 2,
          type: 'text',
        },
        {
          content: 'it.',
          id: 'n2',
          messageContentIndex: 2,
          messageTimestamp: 2,
          type: 'text',
        },
        tools('b'),
      ],
      false,
    )
    expect(projection.rows).toHaveLength(1)
    expect(projection.rows[0]?.patch.detail).toBe('Found it.')
    expect(projection.hiddenMessageTimestamps).toEqual(new Set([2]))
    expect(projection.hiddenTextBlocks).toEqual(new Map([[2, new Set([1, 2])]]))
  })

  test('renders an empty active reasoning segment as Thinking', () => {
    const projection = projectRailVoice([thought('', true)], true)
    expect(projection.rows[0]?.patch.runningLabel).toBe('Thinking')
    expect(projection.rows[0]?.patch.status).toBe('pending')
    expect(projection.reasoningActive).toBe(true)
  })

  test('drops an empty settled reasoning segment', () => {
    expect(projectRailVoice([thought('')], false).rows).toEqual([])
  })
})

describe('messageSegments', () => {
  test('preserves content order and groups adjacent tool calls', () => {
    const message = assistant([
      { thinking: 'Plan', type: 'thinking' },
      { arguments: {}, id: 'a', name: 'read', type: 'toolCall' },
      { arguments: {}, id: 'b', name: 'read', type: 'toolCall' },
      { text: 'done', type: 'text' },
    ])
    expect(messageSegments(message).map((segment) => segment.type)).toEqual([
      'reasoning',
      'tools',
      'text',
    ])
    expect(messageSegments(message)[1]).toEqual({ toolCallIds: ['a', 'b'], type: 'tools' })
  })
})

describe('RailVoice', () => {
  test('updates a reasoning row from Thinking to Thought before its tool', () => {
    const voice = new RailVoice()
    const initial = assistant([])
    const thinking = assistant([{ thinking: 'Plan', type: 'thinking' }])
    const complete = assistant([
      { thinking: 'Plan', type: 'thinking' },
      { arguments: {}, id: 'a', name: 'read', type: 'toolCall' },
    ])
    voice.start(initial)
    voice.update(thinking, { contentIndex: 0, partial: thinking, type: 'thinking_start' })
    expect(voice.projection().rows[0]?.patch.status).toBe('pending')
    voice.update(thinking, {
      content: 'Plan',
      contentIndex: 0,
      partial: thinking,
      type: 'thinking_end',
    })
    voice.finish(complete)
    const projection = voice.projection()
    expect(projection.rows[0]?.patch.status).toBe('ok')
    expect(projection.rows[0]?.patch.measureDuration).toBe(false)
    expect(projection.order).toEqual(['thought:1:1', 'a'])
  })
})
