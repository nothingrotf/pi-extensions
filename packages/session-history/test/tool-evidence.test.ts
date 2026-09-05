import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vite-plus/test'

import type { NormalizedEntry } from '../src/normalize.ts'
import { pairToolResults } from '../src/tool-evidence.ts'
import { HistoryWork, historyLimits } from '../src/work.ts'

function entry(
  id: string,
  parentId: string | null,
  source: 'tool_call' | 'tool_result',
  toolCallId = 'call',
): NormalizedEntry {
  return {
    id,
    parentId,
    type: 'message',
    role: source === 'tool_call' ? 'assistant' : 'tool',
    date: '2026-01-01T00:00:00.000Z',
    content: id,
    source,
    branchState: 'active',
    reference: `pi-session://test/${id}`,
    truncated: false,
    redacted: false,
    toolCallId,
    toolName: 'bash',
    isError: source === 'tool_result' ? false : null,
  }
}

describe('tool evidence', () => {
  it('rejects preceding results and mismatched tool names', async () => {
    const before = entry('before', null, 'tool_result')
    const call = entry('call', 'before', 'tool_call')
    const wrongName = { ...entry('wrong', 'call', 'tool_result'), toolName: 'read' }
    expect((await pairToolResults([before, call, wrongName])).get(call)).toBeUndefined()
  })

  it('keeps conflicting descendant results instead of choosing success', async () => {
    const call = entry('call', null, 'tool_call')
    const success = entry('success', 'call', 'tool_result')
    const failure = { ...entry('failure', 'success', 'tool_result'), isError: true }
    expect((await pairToolResults([call, success, failure])).get(call)).toEqual({
      results: [success, failure],
      ambiguous: false,
    })
  })

  it('marks same-message duplicate call identities as ambiguous', async () => {
    const first = entry('message', null, 'tool_call')
    const second = { ...entry('message', null, 'tool_call'), content: 'second call' }
    const result = entry('result', 'message', 'tool_result')
    const paired = await pairToolResults([first, second, result])
    expect(paired.get(first)).toEqual({ results: [], ambiguous: true })
    expect(paired.get(second)).toEqual({ results: [], ambiguous: true })
  })

  it('attributes sequentially reused IDs to the nearest call', async () => {
    const first = entry('first', null, 'tool_call')
    const firstResult = entry('first-result', 'first', 'tool_result')
    const second = entry('second', 'first-result', 'tool_call')
    const secondResult = entry('second-result', 'second', 'tool_result')
    const paired = await pairToolResults([first, firstResult, second, secondResult])
    expect(paired.get(first)).toEqual({ results: [firstResult], ambiguous: false })
    expect(paired.get(second)).toEqual({ results: [secondResult], ambiguous: false })
  })

  it.each([256, 512, 1024])(
    'bounds repeated-ID lookup work for %i sequential calls',
    async (count) => {
      let nameReads = 0
      const entries: NormalizedEntry[] = []
      const calls: NormalizedEntry[] = []
      for (let index = 0; index < count; index += 1) {
        const call = entry(
          `call-${index}`,
          index === 0 ? null : `result-${index - 1}`,
          'tool_call',
          'reused',
        )
        Object.defineProperty(call, 'toolName', {
          get: () => {
            nameReads += 1
            return 'bash'
          },
        })
        calls.push(call)
        entries.push(call, entry(`result-${index}`, call.id, 'tool_result', 'reused'))
      }
      const paired = await pairToolResults(entries)
      expect(calls.map((call) => paired.get(call)?.results[0]?.id)).toEqual(
        calls.map((_call, index) => `result-${index}`),
      )
      expect(nameReads).toBeLessThanOrEqual(count * 8)
      process.stdout.write(`reused-ID pairing: calls=${count} nameReads=${nameReads}\n`)
    },
  )

  it('yields so cancellation interrupts an in-flight pairing pass', async () => {
    const controller = new AbortController()
    const entries = Array.from({ length: 10000 }, (_value, index) =>
      entry(`call-${index}`, index === 0 ? null : `call-${index - 1}`, 'tool_call'),
    )
    const abort = setImmediate(() => controller.abort(new Error('Stop pairing')))
    try {
      await expect(
        (async () => pairToolResults(entries, new HistoryWork(controller.signal)))(),
      ).rejects.toThrow('Stop pairing')
    } finally {
      clearImmediate(abort)
    }
  })

  it('rejects input exceeding the pairing entry budget', async () => {
    const repeated = entry('call', null, 'tool_call')
    await expect(
      (async () =>
        pairToolResults(
          Array.from({ length: historyLimits.entries + 1 }, () => repeated),
          new HistoryWork(),
        ))(),
    ).rejects.toMatchObject({ code: 'WORK_LIMIT_EXCEEDED' })
  })

  it('restores ancestor bindings across sibling branches and separate roots', async () => {
    const root = entry('root-call', null, 'tool_call')
    const shadow = entry('shadow-call', root.id, 'tool_call')
    const sibling = entry('sibling-result', root.id, 'tool_result')
    const shadowResult = entry('shadow-result', shadow.id, 'tool_result')
    const unrelated = entry('unrelated-result', null, 'tool_result')
    const paired = await pairToolResults([root, shadow, sibling, shadowResult, unrelated])
    expect(paired.get(root)?.results).toEqual([sibling])
    expect(paired.get(shadow)?.results).toEqual([shadowResult])
  })

  it('keeps many duplicate identities ambiguous without repeating candidate scans', async () => {
    let reads = 0
    const calls = Array.from({ length: 1024 }, () => {
      const call = entry('duplicates', null, 'tool_call')
      Object.defineProperty(call, 'toolName', {
        get: () => {
          reads += 1
          return 'bash'
        },
      })
      return call
    })
    const results = Array.from({ length: 1024 }, (_value, index) =>
      entry(`result-${index}`, 'duplicates', 'tool_result'),
    )
    const paired = await pairToolResults([...calls, ...results])
    for (const call of calls) expect(paired.get(call)).toEqual({ ambiguous: true, results: [] })
    expect(reads).toBe(1024)
  })

  it('checks cancellation during ancestry traversal, not only indexing', async () => {
    const controller = new AbortController()
    let visited = 0
    let abort: ReturnType<typeof setImmediate> | undefined
    const entries = Array.from({ length: 2000 }, (_value, index) => {
      const call = entry(`call-${index}`, index === 0 ? null : `call-${index - 1}`, 'tool_call')
      Object.defineProperty(call, 'toolName', {
        get: () => {
          visited += 1
          abort ??= setImmediate(() => controller.abort(new Error('Stop traversal')))
          return 'bash'
        },
      })
      return call
    })
    try {
      await expect(pairToolResults(entries, new HistoryWork(controller.signal))).rejects.toThrow(
        'Stop traversal',
      )
      expect(visited).toBeGreaterThan(0)
      expect(visited).toBeLessThan(256)
    } finally {
      if (abort !== undefined) clearImmediate(abort)
    }
  })

  it('shares the pairing budget across selected sessions', async () => {
    const work = new HistoryWork()
    work.pair(historyLimits.entries - 1)
    await expect(
      pairToolResults([entry('one', null, 'tool_call'), entry('two', 'one', 'tool_result')], work),
    ).rejects.toMatchObject({ code: 'WORK_LIMIT_EXCEEDED' })
  })

  it('evaluates indexed pairing against the legacy scan on unique IDs', async () => {
    const entries: NormalizedEntry[] = []
    for (let index = 0; index < 10000; index += 1) {
      entries.push(
        entry(
          `call-${index}`,
          index === 0 ? null : `result-${index - 1}`,
          'tool_call',
          `id-${index}`,
        ),
      )
      entries.push(entry(`result-${index}`, `call-${index}`, 'tool_result', `id-${index}`))
    }
    const calls = entries.filter((item) => item.source === 'tool_call')
    const results = entries.filter((item) => item.source === 'tool_result')
    const legacyStart = performance.now()
    const legacy = calls.map((call) =>
      results.find((result) => result.toolCallId === call.toolCallId),
    )
    const legacyMs = performance.now() - legacyStart
    const indexedStart = performance.now()
    const paired = await pairToolResults(entries)
    const indexedMs = performance.now() - indexedStart
    expect(calls.map((call) => paired.get(call)?.results[0])).toEqual(legacy)
    expect(paired.size).toBe(10000)
    if (process.env.SESSION_HISTORY_EVAL === '1')
      process.stdout.write(`${JSON.stringify({ toolCalls: 10000, legacyMs, indexedMs })}\n`)
  })
})
