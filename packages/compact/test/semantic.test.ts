import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { describe, expect, test } from 'vite-plus/test'

import { compileCompaction } from '../src/compact.ts'
import {
  applySemanticPatch,
  enrichSemantics,
  renderSemantics,
  semanticInput,
  type SemanticInput,
  type SemanticItem,
  type SemanticState,
} from '../src/semantic.ts'
import { assistant, entry, event, user } from './fixtures.ts'

function item(overrides: Partial<SemanticItem> = {}): SemanticItem {
  return {
    id: 'storage',
    kind: 'decision',
    status: 'active',
    text: 'Use SQLite for local storage.',
    evidence: [{ source: 'new', quote: 'Use SQLite for local storage.' }],
    supersedes: [],
    ...overrides,
  }
}
function input(): SemanticInput {
  return {
    sources: [
      { id: 'new', role: 'user', text: 'Use SQLite for local storage. Keep writes atomic.' },
    ],
    through: 'new',
    omittedSources: 0,
  }
}
function state(): SemanticState {
  return {
    version: 1,
    through: 'old',
    dropped: 0,
    items: [item({ evidence: [{ source: 'old', quote: 'Start with an in-memory store.' }] })],
  }
}
const signal = () => new AbortController().signal

function scenario() {
  return event(
    [
      entry('new', user('Use SQLite for local storage. Keep writes atomic.')),
      entry('log', assistant('A detailed implementation finding. '.repeat(600)), 'new'),
      entry('kept', user('Continue carefully.'), 'log'),
    ],
    'kept',
  )
}

describe('semantic validation and state transitions', () => {
  test('accepts exact evidence and never changes raw facts or the retained boundary', async () => {
    const source = scenario()
    const baseline = await compileCompaction(source)
    const hybrid = await compileCompaction(source, {
      complete: async () => assistant(JSON.stringify({ upsert: [item()] })),
    })
    expect(hybrid.details.facts).toEqual(baseline.details.facts)
    expect(hybrid.details.semantic?.items).toEqual([item()])
    expect(hybrid.firstKeptEntryId).toBe(baseline.firstKeptEntryId)
    expect(hybrid.summary).toContain('decision/active: Use SQLite')
    expect(hybrid.summary).toContain('not independent evidence')
    expect(hybrid.summary.length).toBeLessThanOrEqual(16_000)
    expect(hybrid.usage).toEqual(assistant().usage)
  })

  test('revisits missed evidence after a fallback checkpoint and preserves semantic IDs', async () => {
    const firstEvent = scenario()
    const first = await compileCompaction(firstEvent, {
      complete: async () => assistant(JSON.stringify({ upsert: [item()] })),
    })
    const entries: SessionEntry[] = [
      ...firstEvent.branchEntries,
      {
        type: 'compaction',
        id: 'checkpoint-one',
        parentId: 'kept',
        timestamp: new Date(0).toISOString(),
        ...first,
      },
      entry('change', user('Replace SQLite with PostgreSQL for production.')),
      entry('details', assistant('New production evidence. '.repeat(400))),
      entry('kept-two', user('Continue.')),
    ]
    const failedEvent = event(entries, 'kept-two')
    failedEvent.preparation.previousSummary = first.summary
    const failed = await compileCompaction(failedEvent, {
      complete: async () => assistant('invalid JSON'),
    })
    expect(failed.summary).not.toContain('Model interpretations')
    expect(failed.details.semantic).toEqual(first.details.semantic)
    entries.push(
      {
        type: 'compaction',
        id: 'checkpoint-two',
        parentId: 'kept-two',
        timestamp: new Date(0).toISOString(),
        ...failed,
      },
      entry('more', assistant('Additional diagnostic evidence. '.repeat(400))),
      entry('kept-three', user('Continue.')),
    )
    const recoveredEvent = event(entries, 'kept-three')
    recoveredEvent.preparation.previousSummary = failed.summary
    const changed = item({
      text: 'Use PostgreSQL in production.',
      evidence: [{ source: 'change', quote: 'Replace SQLite with PostgreSQL for production.' }],
    })
    const recovered = await compileCompaction(recoveredEvent, {
      complete: async (context) => {
        expect(JSON.stringify(context)).toContain('Replace SQLite with PostgreSQL')
        return assistant(JSON.stringify({ upsert: [changed] }))
      },
    })
    expect(recovered.details.enrichment?.outcome).toBe('applied')
    expect(recovered.details.semantic?.items).toEqual([changed])
    expect(recovered.summary).toContain('decision/active: Use PostgreSQL')
    expect(recovered.details.semantic?.through).toBe('more')
  })

  test('updates stable IDs only with fresh evidence and marks explicitly replaced items', () => {
    const source = { ...input(), previous: state() }
    const original = structuredClone(source)
    const updated = applySemanticPatch({ upsert: [item()] }, source)
    expect(updated?.items).toEqual([item()])
    const replacement = item({ id: 'sqlite', supersedes: ['storage'] })
    expect(applySemanticPatch({ upsert: [replacement] }, source)?.items).toEqual([
      { ...state().items[0], status: 'superseded' },
      replacement,
    ])
    expect(source).toEqual(original)
    expect(
      applySemanticPatch(
        { upsert: [item({ evidence: state().items[0]?.evidence ?? [] })] },
        source,
      ),
    ).toBeUndefined()
  })

  test('rejects unknown sources, fabricated quotes, duplicate IDs and invalid replacement graphs', () => {
    const source = { ...input(), previous: state() }
    const invalid = [
      item({ evidence: [{ source: 'missing', quote: 'Use SQLite for local storage.' }] }),
      item({ evidence: [{ source: 'new', quote: 'Production deployment succeeded.' }] }),
      item({ id: 'sqlite', supersedes: ['absent'] }),
      item({ supersedes: ['storage'] }),
      item({ status: 'resolved' }),
      item({ kind: 'constraint' }),
    ]
    for (const candidate of invalid)
      expect(applySemanticPatch({ upsert: [candidate] }, source)).toBeUndefined()
    expect(applySemanticPatch({ upsert: [item(), item()] }, source)).toBeUndefined()
    expect(
      applySemanticPatch(
        { upsert: [item(), item({ id: 'sqlite', supersedes: ['storage'] })] },
        source,
      ),
    ).toBeUndefined()
  })

  test('bounds accumulated state, prefers active items, and counts omitted interpretations', () => {
    const previous: SemanticState = {
      ...state(),
      items: Array.from({ length: 32 }, (_, index) =>
        item({ id: `prior-${index}`, status: index < 16 ? 'superseded' : 'active' }),
      ),
    }
    const updated = applySemanticPatch({ upsert: [item()] }, { ...input(), previous })
    expect(updated?.items).toHaveLength(32)
    expect(updated?.dropped).toBe(1)
    expect(updated?.items.some((candidate) => candidate.id === 'prior-0')).toBe(false)
    if (!updated) throw new Error('Valid update unexpectedly rejected')
    expect(renderSemantics(updated, 1000).length).toBeLessThanOrEqual(1000)
  })

  test('scopes source evidence, excludes thinking and private shell commands, and bounds input', () => {
    const thought = assistant('Public reply.')
    thought.content.unshift({ type: 'thinking', thinking: 'PRIVATE_THINKING' })
    const entries = [
      entry('old', user('Start with an in-memory store.')),
      entry('new', user('Use SQLite for local storage.')),
      entry('thought', thought),
      entry('private', {
        role: 'bashExecution',
        command: 'echo secret',
        output: 'PRIVATE_SHELL',
        exitCode: 0,
        cancelled: false,
        truncated: false,
        excludeFromContext: true,
        timestamp: 1,
      }),
    ]
    const selected = semanticInput(entries, state())
    expect(selected.sources.map((source) => source.id)).toEqual(['new', 'thought'])
    expect(JSON.stringify(selected)).not.toMatch(/PRIVATE_THINKING|PRIVATE_SHELL/)
    const long = semanticInput(
      Array.from({ length: 100 }, (_, index) =>
        entry(
          `entry-${index}`,
          user(`Requirement ${index}. ${'Detailed evidence. '.repeat(1000)}`),
        ),
      ),
    )
    expect(JSON.stringify(long.sources).length).toBeLessThan(33_000)
    expect(long.sources[0]?.id).toBe('entry-0')
    expect(long.sources.at(-1)?.id).toBe('entry-99')
    expect(long.omittedSources).toBeGreaterThan(0)
  })

  test('discards inherited interpretations whose evidence belongs to another lineage', () => {
    const inherited = state()
    const sources = [
      entry('old', user('An unrelated branch entry.')),
      entry('new', user('Use SQLite for local storage.')),
    ]
    expect(semanticInput(sources, inherited).previous).toBeUndefined()
  })
})

describe('semantic failure isolation', () => {
  test.each([
    'not json',
    '{}',
    '{"upsert":[],"unexpected":true}',
    JSON.stringify({
      upsert: [item({ evidence: [{ source: 'new', quote: 'Invented evidence.' }] })],
    }),
  ])('falls back without changing the deterministic summary: %s', async (text) => {
    const baseline = await compileCompaction(scenario())
    const result = await compileCompaction(scenario(), { complete: async () => assistant(text) })
    expect(result.summary).toBe(baseline.summary)
    expect(result.details.facts).toEqual(baseline.details.facts)
    expect(result.details.enrichment?.outcome).toBe('fallback')
    expect(result.usage).toEqual(assistant().usage)
  })

  test('handles provider failures and clipped responses without persisting raw error details', async () => {
    const failed = await enrichSemantics(
      input(),
      async () => {
        throw new Error('SECRET_PROVIDER_DETAIL')
      },
      signal(),
    )
    expect(failed).toMatchObject({ outcome: 'fallback', reason: 'provider' })
    expect(JSON.stringify(failed)).not.toContain('SECRET_PROVIDER_DETAIL')
    const clipped = assistant('{"upsert":[]}')
    clipped.stopReason = 'length'
    expect(await enrichSemantics(input(), async () => clipped, signal())).toMatchObject({
      outcome: 'fallback',
      reason: 'invalid_response',
    })
  })

  test('enforces timeout even when a provider ignores cancellation', async () => {
    const result = await enrichSemantics(input(), () => new Promise(() => {}), signal(), 5)
    expect(result).toMatchObject({ outcome: 'fallback', reason: 'timeout' })
  })

  test('propagates explicit cancellation rather than committing a fallback', async () => {
    const controller = new AbortController()
    const result = enrichSemantics(
      input(),
      async () => {
        controller.abort()
        return new Promise(() => {})
      },
      controller.signal,
    )
    await expect(result).rejects.toThrow(/abort/i)
    await expect(
      enrichSemantics(input(), async () => assistant('{}'), controller.signal),
    ).rejects.toThrow(/abort/i)
  })

  test('accepts an empty patch and makes no call when there are no new sources', async () => {
    const result = await enrichSemantics(input(), async () => assistant('{"upsert":[]}'), signal())
    expect(result).toMatchObject({ outcome: 'applied', state: { items: [], through: 'new' } })
    let called = false
    const skipped = await enrichSemantics(
      { ...input(), sources: [] },
      async () => {
        called = true
        return assistant('{}')
      },
      signal(),
    )
    expect(skipped.outcome).toBe('skipped')
    expect(called).toBe(false)
  })
})
