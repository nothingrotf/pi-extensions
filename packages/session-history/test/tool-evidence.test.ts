import { performance } from 'node:perf_hooks'

import { describe, expect, it } from 'vite-plus/test'

import type { NormalizedEntry } from '../src/normalize.ts'
import { pairToolResults } from '../src/tool-evidence.ts'

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
  it('rejects preceding results and mismatched tool names', () => {
    const before = entry('before', null, 'tool_result')
    const call = entry('call', 'before', 'tool_call')
    const wrongName = { ...entry('wrong', 'call', 'tool_result'), toolName: 'read' }
    expect(pairToolResults([before, call, wrongName]).get(call)).toBeUndefined()
  })

  it('keeps conflicting descendant results instead of choosing success', () => {
    const call = entry('call', null, 'tool_call')
    const success = entry('success', 'call', 'tool_result')
    const failure = { ...entry('failure', 'success', 'tool_result'), isError: true }
    expect(pairToolResults([call, success, failure]).get(call)).toEqual({
      results: [success, failure],
      ambiguous: false,
    })
  })

  it('marks same-message duplicate call identities as ambiguous', () => {
    const first = entry('message', null, 'tool_call')
    const second = { ...entry('message', null, 'tool_call'), content: 'second call' }
    const result = entry('result', 'message', 'tool_result')
    const paired = pairToolResults([first, second, result])
    expect(paired.get(first)).toEqual({ results: [], ambiguous: true })
    expect(paired.get(second)).toEqual({ results: [], ambiguous: true })
  })

  it('attributes sequentially reused IDs to the nearest call', () => {
    const first = entry('first', null, 'tool_call')
    const firstResult = entry('first-result', 'first', 'tool_result')
    const second = entry('second', 'first-result', 'tool_call')
    const secondResult = entry('second-result', 'second', 'tool_result')
    const paired = pairToolResults([first, firstResult, second, secondResult])
    expect(paired.get(first)).toEqual({ results: [firstResult], ambiguous: false })
    expect(paired.get(second)).toEqual({ results: [secondResult], ambiguous: false })
  })

  it('evaluates indexed pairing against the legacy scan on unique IDs', () => {
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
    const paired = pairToolResults(entries)
    const indexedMs = performance.now() - indexedStart
    expect(calls.map((call) => paired.get(call)?.results[0])).toEqual(legacy)
    expect(paired.size).toBe(10000)
    if (process.env.SESSION_HISTORY_EVAL === '1')
      process.stdout.write(`${JSON.stringify({ toolCalls: 10000, legacyMs, indexedMs })}\n`)
  })
})
