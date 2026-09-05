import { Value } from 'typebox/value'
import { describe, expect, test } from 'vite-plus/test'

import { compileCompaction } from '../src/compact.ts'
import { Extractor } from '../src/extract.ts'
import { CheckpointSchema, WorkingState } from '../src/state.ts'
import { assistant, entry, event, user } from './fixtures.ts'

const longText = 'Preserve the transaction isolation requirement. '.repeat(200)

function source() {
  return [
    entry('user-old', user(longText)),
    entry('assistant-old', assistant(longText)),
    entry('kept', user('Latest request stays verbatim.')),
  ]
}

describe('structured compiler', () => {
  test('keeps the native boundary and excludes retained messages from the state', async () => {
    const entries = source()
    const original = structuredClone(entries)
    const result = await compileCompaction(event(entries, 'kept'))
    expect(result.firstKeptEntryId).toBe('kept')
    expect(result.summary).toContain('[user-old]')
    expect(result.summary).not.toContain('Latest request stays verbatim.')
    expect(result.summary.length).toBeLessThanOrEqual(16_000)
    expect(Value.Check(CheckpointSchema, result.details)).toBe(true)
    expect(entries).toEqual(original)
  })

  test('is deterministic and handles split-turn prefixes', async () => {
    const input = event(source(), 'kept')
    input.preparation.turnPrefixMessages = input.preparation.messagesToSummarize
    input.preparation.messagesToSummarize = []
    input.preparation.isSplitTurn = true
    expect(await compileCompaction(input)).toEqual(await compileCompaction(input))
    expect((await compileCompaction(input)).details.sourceMessages).toBe(2)
  })

  test('checks cancellation before and during work without changing sources', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(compileCompaction(event(source(), 'kept', controller.signal))).rejects.toThrow(
      /abort/i,
    )
    const during = new AbortController()
    const entries = source()
    const original = structuredClone(entries)
    const pending = compileCompaction(event(entries, 'kept', during.signal))
    during.abort()
    await expect(pending).rejects.toThrow(/abort/i)
    expect(entries).toEqual(original)
    expect((await compileCompaction(event(entries, 'kept'))).summary).toContain(
      'transaction isolation',
    )
  })

  test('rejects invalid boundaries and non-reducing summaries', async () => {
    const input = event(source(), 'kept')
    input.preparation.firstKeptEntryId = 'absent'
    await expect(compileCompaction(input)).rejects.toThrow('boundary is absent')
    await expect(
      compileCompaction(event([entry('old', user('Hi')), entry('kept', user('Bye'))], 'kept')),
    ).rejects.toThrow('Not enough reducible context')
  })

  test('caps state growth and preserves the first user request', () => {
    const state = new WorkingState()
    for (let i = 0; i < 500; i++)
      state.add({ category: 'request', key: `u${i}`, source: `u${i}`, text: `Request ${i}` })
    const snapshot = state.snapshot()
    expect(snapshot.facts).toHaveLength(20)
    expect(snapshot.facts[0]?.source).toBe('u0')
    expect(snapshot.facts.at(-1)?.source).toBe('u499')
    expect(snapshot.dropped).toBe(480)
  })

  test('bounds the complete view under repeated large inputs', async () => {
    const entries = Array.from({ length: 300 }, (_, i) => entry(`old-${i}`, user(longText)))
    entries.push(entry('kept', user('Tail')))
    const result = await compileCompaction(event(entries, 'kept'))
    expect(result.summary.length).toBeLessThanOrEqual(16_000)
    expect(result.summary).toContain('recorded excerpts omitted')
    expect(result.details.dropped).toBe(280)
  })
})

describe('evidence extraction', () => {
  test('only records modifications after a successful matching result', () => {
    const state = new WorkingState()
    const extractor = new Extractor(state)
    const message = assistant()
    if (message.role !== 'assistant') throw new Error('Invalid fixture')
    message.content = [
      {
        type: 'toolCall',
        id: 'fail',
        name: 'edit',
        arguments: { path: 'failed.ts', edits: [{ oldText: 'old', newText: 'new' }] },
      },
      {
        type: 'toolCall',
        id: 'ok',
        name: 'edit',
        arguments: { path: 'ok.ts', edits: [{ oldText: 'old', newText: 'new' }] },
      },
      { type: 'toolCall', id: 'missing', name: 'write', arguments: { path: 'unconfirmed.ts' } },
    ]
    extractor.entry(entry('calls', message))
    for (const [id, isError] of [
      ['fail', true],
      ['ok', false],
    ] satisfies [string, boolean][]) {
      extractor.entry(
        entry(`result-${id}`, {
          role: 'toolResult',
          toolCallId: id,
          toolName: 'edit',
          isError,
          timestamp: 3,
          content: [
            { type: 'text', text: isError ? 'Permission denied' : 'Successfully replaced text' },
          ],
        }),
      )
    }
    extractor.unfinished()
    expect(state.snapshot().facts.filter((fact) => fact.category === 'file')).toEqual([
      {
        category: 'file',
        key: 'modified:ok.ts',
        source: 'result-ok',
        text: 'modified: ok.ts\nold -> new',
      },
    ])
    expect(
      state
        .snapshot()
        .facts.some(
          (fact) => fact.category === 'failure' && fact.text.includes('Permission denied'),
        ),
    ).toBe(true)
    expect(
      state.snapshot().facts.some((fact) => fact.text.includes('without a matching result')),
    ).toBe(true)
  })

  test('replaces plan snapshots, including explicit clearing, without trusting failed updates', () => {
    const state = new WorkingState()
    const extractor = new Extractor(state)
    const update = (
      id: string,
      todos: { id: string; content: string; status: string }[],
      isError = false,
    ) =>
      extractor.entry(
        entry(id, {
          role: 'toolResult',
          toolCallId: id,
          toolName: 'todo_write',
          isError,
          timestamp: 1,
          content: [{ type: 'text', text: 'Updated' }],
          details: { todos },
        }),
      )
    update('first', [{ id: 'a', content: 'Build', status: 'pending' }])
    update('second', [{ id: 'a', content: 'Build', status: 'completed' }])
    update('failed', [], true)
    expect(
      state
        .snapshot()
        .facts.filter((fact) => fact.category === 'plan')
        .map((fact) => fact.text),
    ).toEqual(['[completed] a: Build'])
    update('clear', [])
    expect(state.snapshot().facts.filter((fact) => fact.category === 'plan')).toEqual([])
  })

  test('does not resurrect excluded bash output or fabricate image content', async () => {
    const entries = source()
    entries.splice(
      1,
      0,
      entry('private', {
        role: 'bashExecution',
        command: 'secret',
        output: 'private-output',
        exitCode: 0,
        cancelled: false,
        truncated: false,
        excludeFromContext: true,
        timestamp: 1,
      }),
    )
    const result = await compileCompaction(event(entries, 'kept'))
    expect(result.summary).not.toContain('private-output')
  })
})
