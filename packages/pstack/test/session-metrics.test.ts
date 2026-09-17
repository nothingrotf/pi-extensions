import { describe, expect, it } from 'vite-plus/test'

import { formatSessionMetrics, sessionMetrics } from '../src/session-metrics.ts'

interface TranscriptPart {
  id?: string
  name?: string
  text?: string
  type: string
}

interface TranscriptMessage {
  content?: TranscriptPart[]
  model?: string
  role: string
  toolCallId?: string
  toolName?: string
  usage?: { cacheRead?: number; cost?: { total: number }; input?: number; output?: number }
}

function entry(timestamp: string, message: TranscriptMessage): string {
  return JSON.stringify({ message, timestamp, type: 'message' })
}

const transcript = [
  entry('2026-09-17T00:00:00.000Z', { content: [{ text: 'work', type: 'text' }], role: 'user' }),
  entry('2026-09-17T00:00:10.000Z', {
    content: [
      { text: 'plan', type: 'text' },
      { id: 'a', name: 'read', type: 'toolCall' },
      { id: 'b', name: 'read', type: 'toolCall' },
    ],
    model: 'gpt-5.6-sol',
    role: 'assistant',
    usage: { cacheRead: 1000, cost: { total: 0.5 }, input: 10, output: 20 },
  }),
  entry('2026-09-17T00:00:12.000Z', {
    content: [{ text: 'first file', type: 'text' }],
    role: 'toolResult',
    toolCallId: 'a',
    toolName: 'read',
  }),
  entry('2026-09-17T00:00:13.000Z', {
    content: [{ text: 'second', type: 'text' }],
    role: 'toolResult',
    toolCallId: 'b',
    toolName: 'read',
  }),
  entry('2026-09-17T00:00:25.000Z', {
    content: [{ id: 'c', name: 'bash', type: 'toolCall' }],
    model: 'gpt-5.6-sol',
    role: 'assistant',
    usage: { cacheRead: 2000, cost: { total: 0.25 }, input: 5, output: 15 },
  }),
  entry('2026-09-17T00:00:31.000Z', {
    content: [{ text: 'EXIT=0', type: 'text' }],
    role: 'toolResult',
    toolCallId: 'c',
    toolName: 'bash',
  }),
  entry('2026-09-17T00:00:32.000Z', {
    content: [
      { text: 'Your terminal delivery report was rejected. Return only JSON.', type: 'text' },
    ],
    role: 'user',
  }),
  entry('2026-09-17T00:00:40.000Z', {
    content: [{ text: '{}', type: 'text' }],
    model: 'gpt-5.6-sol',
    role: 'assistant',
    usage: { cacheRead: 3000, output: 5 },
  }),
].join('\n')

describe('session metrics', () => {
  it('separates generation latency from tool latency across a recorded session', () => {
    const metrics = sessionMetrics(transcript)
    expect(metrics.assistantTurns).toBe(3)
    expect(metrics.singleCallTurns).toBe(1)
    expect(metrics.toolCalls).toBe(3)
    expect(metrics.modelMs).toBe(10_000 + 12_000 + 8_000)
    expect(metrics.toolMs).toBe(2_000 + 1_000 + 6_000)
    expect(metrics.durationMs).toBe(40_000)
    expect(metrics.models).toEqual(['gpt-5.6-sol'])
    expect(metrics.cacheReadTokens).toBe(6_000)
    expect(metrics.costUsd).toBeCloseTo(0.75)
    expect(metrics.outputTokens).toBe(40)
    expect(metrics.terminalRejections).toBe(1)
    expect(metrics.readResultChars).toBe('first file'.length + 'second'.length)
  })

  it('attributes concurrent calls to their own tool without double counting a turn', () => {
    const metrics = sessionMetrics(transcript)
    const read = metrics.tools.find((tool) => tool.name === 'read')
    const bash = metrics.tools.find((tool) => tool.name === 'bash')
    if (read === undefined || bash === undefined) throw new Error('Missing tool metrics.')
    expect(read.calls).toBe(2)
    expect(read.wallMs).toBe(2_000 + 3_000)
    expect(bash.calls).toBe(1)
    expect(bash.wallMs).toBe(6_000)
    expect(metrics.tools[0]?.name).toBe('read')
  })

  it('ignores unparsable and unrelated lines instead of failing the report', () => {
    const metrics = sessionMetrics(`not json\n\n${transcript}\n{"type":"custom","data":{}}`)
    expect(metrics.assistantTurns).toBe(3)
    expect(formatSessionMetrics(metrics)).toContain('turns 3')
    expect(formatSessionMetrics(metrics)).toContain('single-call turns 1')
  })

  it('reports an empty session without inventing a window', () => {
    const metrics = sessionMetrics('')
    expect(metrics.assistantTurns).toBe(0)
    expect(metrics.durationMs).toBe(0)
    expect(metrics.startedAt).toBeUndefined()
    expect(formatSessionMetrics(metrics)).toContain('window unknown -> unknown')
  })
})
