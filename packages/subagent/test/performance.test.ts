import type { AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vite-plus/test'

import { parentConversationSnapshot } from '../src/intercom.ts'
import { jsonEquals, resolveStructuredOutput } from '../src/output.ts'
import type { JsonObject, JsonValue } from '../src/schema.ts'

function wideObject(size: number): JsonObject {
  return Object.fromEntries(Array.from({ length: size }, (_, index) => [`key-${index}`, index]))
}

function assistant(content: AssistantMessage['content']): AssistantMessage {
  return {
    api: 'openai-completions',
    content,
    model: 'test',
    provider: 'test',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  }
}

function receipt(manager: SessionManager, id: string, reason: string): void {
  manager.appendMessage({
    content: [{ text: 'PRIVATE_RAW_RESULT', type: 'text' }],
    details: { outcome: 'queued', reason },
    isError: false,
    role: 'toolResult',
    timestamp: 0,
    toolCallId: id,
    toolName: 'TaskControl',
  })
}

describe('bounded coordination work', () => {
  it.each([128, 256, 512])(
    'compares %i object properties without repeated array searches',
    (size) => {
      const left = wideObject(size)
      const right = Object.fromEntries(Object.entries(left).reverse())
      const searches = vi.spyOn(Array.prototype, 'find')
      let equal: boolean
      let count: number
      try {
        equal = jsonEquals(left, right)
        count = searches.mock.calls.length
      } finally {
        searches.mockRestore()
      }
      expect(equal).toBe(true)
      expect(count).toBe(0)
    },
  )

  it.each([128, 256, 512])(
    'checks %i required properties without repeated array searches',
    (size) => {
      const value = wideObject(size)
      const schema = { type: 'object', required: Object.keys(value).reverse() }
      const output = JSON.stringify(value)
      const searches = vi.spyOn(Array.prototype, 'some')
      let result: ReturnType<typeof resolveStructuredOutput>
      let count: number
      try {
        result = resolveStructuredOutput(output, schema, 'strict')
        count = searches.mock.calls.length
      } finally {
        searches.mockRestore()
      }
      expect(result?.status).toBe('valid')
      expect(count).toBe(0)
    },
  )

  it.each(
    [100, 1_000].flatMap((historySize) =>
      [0, 100, 80_000].map((budget) => ({ historySize, budget })),
    ),
  )(
    'materializes only the retained suffix of $historySize messages for a $budget byte budget',
    ({ budget, historySize }) => {
      const manager = SessionManager.inMemory()
      let reads = 0
      const text = '🙂'.repeat(4_000)
      for (let index = 0; index < historySize; index += 1) {
        const content: UserMessage['content'] = [
          {
            type: 'text',
            get text() {
              reads += 1
              return text
            },
          },
        ]
        manager.appendMessage({ role: 'user', content, timestamp: index })
      }
      const branch = manager.getBranch()
      reads = 0
      const encodings = vi.spyOn(TextEncoder.prototype, 'encode')
      let snapshot: string
      let encodedBytes: number
      let allocations: number
      try {
        snapshot = parentConversationSnapshot(branch, budget)
        allocations = encodings.mock.calls.length
        encodedBytes = encodings.mock.results.reduce(
          (sum, result) => sum + (result.type === 'return' ? result.value.byteLength : 0),
          0,
        )
      } finally {
        encodings.mockRestore()
      }
      const retainedEntries = Math.ceil(budget / 8_000)
      expect(Buffer.byteLength(snapshot)).toBeLessThanOrEqual(budget)
      expect(snapshot).not.toContain('�')
      expect(reads).toBeLessThanOrEqual(retainedEntries * 2)
      expect(allocations).toBeLessThanOrEqual(retainedEntries * 3)
      expect(encodedBytes).toBeLessThanOrEqual(retainedEntries * 40_000)
    },
  )

  it.each([-1, 0.9, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'does not inspect entries for an unusable %s byte budget',
    (budget) => {
      const manager = SessionManager.inMemory()
      manager.appendMessage({ content: 'Not needed', role: 'user', timestamp: 0 })
      const entries = manager.getBranch()
      const entry = entries[0]
      if (entry === undefined) throw new Error('Missing entry')
      const id = entry.id
      let reads = 0
      Object.defineProperty(entry, 'id', {
        get() {
          reads += 1
          return id
        },
      })
      expect(parentConversationSnapshot(entries, budget)).toBe('')
      expect(reads).toBe(0)
    },
  )
})

describe('indexed output validation', () => {
  it('compares nested own properties independently of order, including special names and null', () => {
    const left = Object.fromEntries<JsonValue>([
      ['__proto__', { nested: [null, true, 1] }],
      ['constructor', null],
      ['toString', false],
    ])
    const right = Object.fromEntries(Object.entries(left).reverse())
    expect(jsonEquals(left, right)).toBe(true)
    expect(jsonEquals(left, { constructor: null, toString: false, other: null })).toBe(false)
    expect(jsonEquals(left, { ...right, constructor: 'different' })).toBe(false)
    expect(jsonEquals({ nested: [1, 2] }, { nested: [2, 1] })).toBe(false)
    expect(jsonEquals({ nested: null }, { nested: [] })).toBe(false)
  })

  it('ignores inherited properties and requires special names to be present as own properties', () => {
    const value = { own: 1 }
    Object.setPrototypeOf(value, { inherited: 2 })
    expect(jsonEquals(value, { own: 1 })).toBe(true)
    expect(jsonEquals(value, { inherited: 2 })).toBe(false)
    for (const key of ['__proto__', 'constructor', 'toString']) {
      expect(
        resolveStructuredOutput('{}', { type: 'object', required: [key] }, 'strict'),
      ).toMatchObject({
        status: 'invalid',
        error: `#/${key} is required.`,
      })
    }
    expect(
      resolveStructuredOutput(
        '{"__proto__":{"nested":1},"constructor":null,"toString":false}',
        {
          type: 'object',
          required: ['__proto__', 'constructor', 'toString'],
          properties: Object.fromEntries<JsonValue>([
            ['__proto__', { type: 'object', required: ['nested'] }],
            ['constructor', { type: 'null' }],
            ['toString', { type: 'boolean' }],
          ]),
          additionalProperties: false,
        },
        'strict',
      )?.status,
    ).toBe('valid')
  })

  it('preserves required-property error order and nested validation after indexing', () => {
    const schema = {
      type: 'object',
      required: ['second', 'first'],
      properties: { second: { type: 'array', items: { type: 'integer' } }, first: true },
      additionalProperties: false,
    }
    for (const [output, error] of [
      ['{}', '#/second is required.'],
      ['{"second":[]}', '#/first is required.'],
      ['{"second":["wrong"],"first":null}', '#/second/0 must be an integer.'],
      ['{"second":[],"first":null,"extra":0}', '#/extra is not allowed.'],
    ]) {
      if (output === undefined) throw new Error('Missing output')
      expect(resolveStructuredOutput(output, schema, 'strict')).toMatchObject({
        status: 'invalid',
        error,
      })
    }
  })
})

describe('reverse snapshot materialization', () => {
  it('does not read assistant prose when newer calls consume the budget', () => {
    const manager = SessionManager.inMemory()
    let reads = 0
    manager.appendMessage(
      assistant([
        {
          type: 'text',
          get text() {
            reads += 1
            return 'PRIVATE_OLD_PROSE'.repeat(10_000)
          },
        },
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'retained-call',
          arguments: {
            action: 'steer',
            agent_id: 'worker',
            message: 'Newest contract '.repeat(100),
          },
        },
      ]),
    )
    const snapshot = parentConversationSnapshot(manager.getBranch(), 200)
    expect(snapshot).toContain('retained-call')
    expect(snapshot).toContain('[truncated]')
    expect(reads).toBe(0)
  })

  it('retains receipts whose recognized calls are outside the formatting budget', () => {
    const manager = SessionManager.inMemory()
    manager.appendMessage(
      assistant([
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'old-call',
          arguments: { action: 'steer', agent_id: 'worker', message: 'OLD_CONTRACT' },
        },
      ]),
    )
    manager.appendMessage({ role: 'user', content: 'x'.repeat(10_000), timestamp: 0 })
    receipt(manager, 'old-call', 'latest receipt')
    const snapshot = parentConversationSnapshot(manager.getBranch(), 200)
    expect(snapshot).toContain('TaskControl RECEIPT')
    expect(snapshot).toContain('latest receipt')
    expect(snapshot).not.toContain('OLD_CONTRACT')
    expect(snapshot).not.toContain('PRIVATE_RAW_RESULT')
  })

  it('preserves text and multiple-call order without recognizing future or malformed calls', () => {
    const manager = SessionManager.inMemory()
    receipt(manager, 'future', 'FUTURE_RECEIPT')
    manager.appendMessage(
      assistant([
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'first',
          arguments: { action: 'steer', agent_id: 'worker', message: 'FIRST_CONTRACT' },
        },
        { type: 'text', text: 'ASSISTANT_REPORT' },
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'future',
          arguments: {
            action: 'reply',
            agent_id: 'worker',
            request_id: 'question',
            message: 'SECOND_CONTRACT',
          },
        },
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'invalid',
          arguments: { action: 'reply', agent_id: 'worker', message: 'INVALID_CONTRACT' },
        },
      ]),
    )
    receipt(manager, 'invalid', 'INVALID_RECEIPT')
    receipt(manager, 'unrecognized', 'UNRECOGNIZED_RECEIPT')
    receipt(manager, 'first', 'VALID_RECEIPT')
    const snapshot = parentConversationSnapshot(manager.getBranch(), 80_000)
    expect(snapshot.indexOf('ASSISTANT_REPORT')).toBeLessThan(snapshot.indexOf('FIRST_CONTRACT'))
    expect(snapshot.indexOf('FIRST_CONTRACT')).toBeLessThan(snapshot.indexOf('SECOND_CONTRACT'))
    expect(snapshot.indexOf('SECOND_CONTRACT')).toBeLessThan(snapshot.indexOf('VALID_RECEIPT'))
    for (const excluded of [
      'FUTURE_RECEIPT',
      'INVALID_CONTRACT',
      'INVALID_RECEIPT',
      'UNRECOGNIZED_RECEIPT',
      'PRIVATE_RAW_RESULT',
    ]) {
      expect(snapshot).not.toContain(excluded)
    }
  })

  it('does not recognize calls discarded by compaction or revive a previous branch', () => {
    const manager = SessionManager.inMemory()
    const root = manager.appendMessage({ role: 'user', content: 'ROOT_TASK', timestamp: 0 })
    manager.appendMessage(
      assistant([
        {
          type: 'toolCall',
          name: 'TaskControl',
          id: 'discarded',
          arguments: { action: 'steer', agent_id: 'worker', message: 'DISCARDED_CONTRACT' },
        },
      ]),
    )
    const kept = manager.appendMessage({ role: 'user', content: 'KEPT_TASK', timestamp: 0 })
    manager.appendCompaction('COMPACTED_SUMMARY', kept, 100)
    receipt(manager, 'discarded', 'DISCARDED_RECEIPT')
    const compacted = parentConversationSnapshot(manager.getBranch(), 80_000)
    expect(compacted).toContain('COMPACTED_SUMMARY')
    expect(compacted).toContain('KEPT_TASK')
    expect(compacted).not.toContain('ROOT_TASK')
    expect(compacted).not.toContain('DISCARDED_')
    manager.branchWithSummary(root, 'BRANCH_SUMMARY')
    manager.appendCustomMessageEntry('subagent-intercom', 'CURRENT_CONTRACT', true)
    const branched = parentConversationSnapshot(manager.getEntries(), 80_000)
    expect(branched).toContain('ROOT_TASK')
    expect(branched).toContain('BRANCH_SUMMARY')
    expect(branched).toContain('CURRENT_CONTRACT')
    expect(branched).not.toContain('COMPACTED_SUMMARY')
    expect(branched).not.toContain('KEPT_TASK')
    expect(branched).not.toContain('DISCARDED_')
  })
})
