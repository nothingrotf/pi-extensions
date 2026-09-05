import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  SessionManager,
  type SessionEntry,
  type SessionMessageEntry,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import { normalizeEntries } from '../src/normalize.ts'
import type { SessionHistoryInput } from '../src/schema.ts'
import { SessionHistoryStore } from '../src/sessions.ts'

const date = '2026-01-01T00:00:00.000Z'
const sessionId = 'quality-corpus'

function message(
  id: string,
  content: SessionMessageEntry['message'],
  parentId: string | null = null,
): SessionMessageEntry {
  return { type: 'message', id, parentId, timestamp: date, message: content }
}

function assistant(text: string): Extract<SessionMessageEntry['message'], { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-responses',
    provider: 'openai',
    model: 'fixture',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 1,
  }
}

async function withStore(
  entries: readonly SessionEntry[],
  run: (store: SessionHistoryStore) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'session-history-quality-'))
  try {
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    const current = SessionManager.create(cwd, directory, { id: 'quality-current' })
    await writeFile(
      join(directory, 'quality.jsonl'),
      [
        JSON.stringify({ type: 'session', version: 3, id: sessionId, cwd, timestamp: date }),
        ...entries.map((entry) => JSON.stringify(entry)),
      ].join('\n'),
    )
    await run(new SessionHistoryStore(current))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it('does not claim completion for duplicate same-message tool call identities', async () => {
  const calls: SessionMessageEntry = message('duplicate-calls', {
    ...assistant(''),
    content: [
      { type: 'toolCall', id: 'duplicate', name: 'bash', arguments: { command: 'first' } },
      { type: 'toolCall', id: 'duplicate', name: 'bash', arguments: { command: 'second' } },
    ],
  })
  const result = message(
    'ambiguous-result',
    {
      role: 'toolResult',
      toolCallId: 'duplicate',
      toolName: 'bash',
      content: [{ type: 'text', text: 'Success' }],
      isError: false,
      timestamp: 2,
    },
    'duplicate-calls',
  )
  await withStore([calls, result], async (store) => {
    const activity = await store.execute({ action: 'tool_activity', session_id: sessionId })
    expect(activity.data).toHaveLength(2)
    for (const item of activity.data)
      expect(item).toMatchObject({
        status: 'unknown',
        resultReference: null,
        completedAt: null,
        result: null,
      })
  })
})

function corpus(): SessionEntry[] {
  return [
    message('portuguese', {
      role: 'user',
      content: 'Decisão: manter cache local para sessões antigas.',
      timestamp: 1,
    }),
    message('english', {
      role: 'user',
      content: 'Decision: use atomic writes for durable snapshots.',
      timestamp: 1,
    }),
    message('assistant', assistant('Verified deployment completed successfully.')),
    message('result', {
      role: 'toolResult',
      toolCallId: 'deploy-call',
      toolName: 'bash',
      content: [{ type: 'text', text: 'deployment completed successfully' }],
      isError: false,
      timestamp: 1,
    }),
    message('bash', {
      role: 'bashExecution',
      command: 'printf shellprobe',
      output: 'shellprobe output',
      exitCode: 0,
      cancelled: false,
      truncated: true,
      fullOutputPath: '/private/fixture/full-output.txt',
      timestamp: 1,
    }),
    message('custom', {
      role: 'custom',
      customType: 'fixture',
      content: 'Retomar revisão de permissões amanhã.',
      display: false,
      timestamp: 1,
    }),
    message('branch', {
      role: 'branchSummary',
      summary: 'Abandoned approach: remote indexing service.',
      fromId: 'english',
      timestamp: 1,
    }),
    message('compact', {
      role: 'compactionSummary',
      summary: 'Resumo: preservar referências estáveis.',
      tokensBefore: 500,
      timestamp: 1,
    }),
    message('distractor', {
      role: 'user',
      content:
        'cache misses; local changes; atomic counters; writes pending; revisão semanal; permissões removidas; remote logs; indexing backlog; referências antigas; estáveis testes',
      timestamp: 1,
    }),
  ].map((entry, index, entries) => ({ ...entry, parentId: entries[index - 1]?.id ?? null }))
}

interface RetrievalLabel {
  label: string
  query: string
  relevant: string[]
  entryTypes?: string[]
}

const retrievalLabels: RetrievalLabel[] = [
  { label: 'pt exact lexical', query: 'cache local', relevant: ['portuguese'] },
  { label: 'en exact lexical', query: 'atomic writes', relevant: ['english'] },
  {
    label: 'assistant claims',
    query: 'deployment completed',
    relevant: ['assistant'],
    entryTypes: ['assistant_message'],
  },
  {
    label: 'tool evidence',
    query: 'deployment completed',
    relevant: ['result'],
    entryTypes: ['tool_result'],
  },
  { label: 'native bash', query: 'shellprobe', relevant: ['bash'] },
  { label: 'pt native custom', query: 'revisão de permissões', relevant: ['custom'] },
  { label: 'en native branch', query: 'remote indexing', relevant: ['branch'] },
  { label: 'pt native compaction', query: 'referências estáveis', relevant: ['compact'] },
]

const secretFields = [
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'API-KEY',
  'accessToken',
  'access_token',
  'refreshToken',
  'id_token',
  'clientSecret',
  'private_key',
  'sessionToken',
  'set-cookie',
  'x-api-key',
  'Proxy-Authorization',
]
const normalFields = [
  'tokenCount',
  'tokenizer',
  'secretCount',
  'passwordPolicy',
  'authorizationMode',
  'cookieOptions',
  'publicKey',
  'apiKeyName',
  'refreshTokenExpiresAt',
  'accessibility',
]

function structuredPayload() {
  return {
    nested: [
      {
        credentials: Object.fromEntries(
          secretFields.map((field, index) => [field, `synthetic-leak-${index}-end`]),
        ),
      },
    ],
    normal: Object.fromEntries(
      normalFields.map((field, index) => [field, `normal-control-${index}-end`]),
    ),
  }
}

function payloadEntries(): SessionEntry[] {
  const payload = structuredPayload()
  const call = assistant('Preparing request')
  if (call.role !== 'assistant') throw new Error('Expected assistant fixture')
  call.content = [{ type: 'toolCall', id: 'payload-call', name: 'request', arguments: payload }]
  return [
    {
      type: 'custom',
      id: 'payload-custom',
      parentId: null,
      timestamp: date,
      customType: 'fixture',
      data: payload,
    },
    message('payload-tool', call, 'payload-custom'),
  ]
}

function report(value: string): void {
  if (process.env.SESSION_HISTORY_EVAL === '1') process.stdout.write(`${value}\n`)
}

describe('deterministic quality evaluation', () => {
  it('measures labeled retrieval recall and reciprocal rank through persisted history', async () => {
    await withStore(corpus(), async (store) => {
      const samples = []
      for (const label of retrievalLabels) {
        const input: SessionHistoryInput = { action: 'search', query: label.query }
        if (label.entryTypes !== undefined) input.entry_types = label.entryTypes
        const result = await store.execute(input)
        const ids = result.data.map((item) => ('entryId' in item ? item.entryId : null))
        const rank = ids.findIndex((id) => label.relevant.includes(String(id))) + 1
        samples.push({
          label: label.label,
          recallAt1:
            label.relevant.filter((id) => ids.slice(0, 1).includes(id)).length /
            label.relevant.length,
          recallAt5:
            label.relevant.filter((id) => ids.slice(0, 5).includes(id)).length /
            label.relevant.length,
          reciprocalRank: rank === 0 ? 0 : 1 / rank,
        })
      }
      const metrics = {
        queries: samples.length,
        recallAt1: samples.reduce((sum, sample) => sum + sample.recallAt1, 0) / samples.length,
        recallAt5: samples.reduce((sum, sample) => sum + sample.recallAt5, 0) / samples.length,
        mrr: samples.reduce((sum, sample) => sum + sample.reciprocalRank, 0) / samples.length,
      }
      report(JSON.stringify({ retrieval: metrics, samples }))
      expect(metrics).toEqual({ queries: 8, recallAt1: 1, recallAt5: 1, mrr: 1 })
    })
  })

  it('keeps negative controls empty without translating or fabricating tool evidence', async () => {
    await withStore(corpus(), async (store) => {
      for (const query of ['inexistente', 'nonexistent', 'berechtigungen']) {
        expect((await store.execute({ action: 'search', query })).data).toEqual([])
      }
      expect(
        (await store.execute({ action: 'tool_activity', session_id: sessionId })).data,
      ).toEqual([])
      expect(
        (
          await store.execute({
            action: 'search',
            query: 'shellprobe',
            entry_types: ['tool_result', 'tool_call'],
          })
        ).data,
      ).toEqual([])
    })
  })

  it('preserves native role provenance and references without output file metadata', async () => {
    await withStore(corpus(), async (store) => {
      const read = await store.execute({ action: 'read', session_id: sessionId })
      for (const [id, role, source] of [
        ['bash', 'bashExecution', 'bash_execution'],
        ['custom', 'custom', 'custom_message'],
        ['branch', 'branchSummary', 'branch_summary'],
        ['compact', 'compactionSummary', 'compaction_summary'],
      ]) {
        expect(read.data).toContainEqual(
          expect.objectContaining({
            id,
            role,
            source,
            type: 'message',
            branchState: 'active',
            reference: `pi-session://${sessionId}/${id}`,
            toolCallId: null,
            toolName: null,
            isError: null,
          }),
        )
      }
      expect(read.data).toContainEqual(
        expect.objectContaining({ id: 'bash', truncated: true, parentId: 'result' }),
      )
      expect(JSON.stringify(read)).not.toContain('/private/fixture/full-output.txt')
      expect(JSON.stringify(read)).not.toContain('fullOutputPath')
      const timeline = await store.execute({ action: 'timeline', session_id: sessionId })
      expect(timeline.data).toContainEqual(
        expect.objectContaining({
          id: 'bash',
          source: 'bash_execution',
          toolCallId: null,
          isError: null,
        }),
      )
    })
  })

  it('reports only paired tool evidence as completed rather than assistant claims or native shell records', async () => {
    const call = assistant('deployment completed successfully')
    if (call.role !== 'assistant') throw new Error('Expected assistant fixture')
    call.content.push({
      type: 'toolCall',
      id: 'deploy-call',
      name: 'bash',
      arguments: { command: 'deploy' },
    })
    const entries = corpus().map((entry) =>
      entry.id === 'assistant'
        ? ({ ...entry, type: 'message', message: call } satisfies SessionMessageEntry)
        : entry,
    )
    await withStore(entries, async (store) => {
      const activity = await store.execute({ action: 'tool_activity', session_id: sessionId })
      expect(activity.data).toHaveLength(1)
      expect(activity.data[0]).toMatchObject({
        status: 'completed',
        toolCallId: 'deploy-call',
        callReference: `pi-session://${sessionId}/assistant`,
        resultReference: `pi-session://${sessionId}/result`,
      })
    })
  })

  it.each([
    { exitCode: 0, cancelled: false },
    { exitCode: 1, cancelled: false },
    { exitCode: undefined, cancelled: true },
  ])('keeps native shell status explicit without a synthetic tool result: %j', (status) => {
    const entries = [
      message('shell', {
        role: 'bashExecution',
        command: 'fixture',
        output: 'output',
        truncated: false,
        timestamp: 1,
        ...status,
      }),
    ]
    const normalized = normalizeEntries(entries, sessionId, new Set())
    expect(normalized[0]).toMatchObject({
      source: 'bash_execution',
      branchState: 'abandoned',
      truncated: false,
      toolCallId: null,
      toolName: null,
      isError: null,
    })
    expect(normalized[0]?.content).toContain(`Exit code: ${status.exitCode ?? 'unknown'}`)
    expect(normalized[0]?.content).toContain(`Cancelled: ${status.cancelled}`)
  })

  it('does not mark ordinary structured fields as redacted', () => {
    const entries: SessionEntry[] = [
      {
        type: 'custom',
        id: 'normal-only',
        parentId: null,
        timestamp: date,
        customType: 'fixture',
        data: structuredPayload().normal,
      },
    ]
    const normalized = normalizeEntries(entries, sessionId, new Set(['normal-only']))
    expect(normalized[0]).toMatchObject({ redacted: false, truncated: false })
    for (let index = 0; index < normalFields.length; index += 1) {
      expect(normalized[0]?.content).toContain(`normal-control-${index}-end`)
    }
  })

  it('measures structured secret leakage and normal field retention', async () => {
    const entries = payloadEntries()
    const normalized = normalizeEntries(
      entries,
      sessionId,
      new Set(entries.map((entry) => entry.id)),
      true,
    )
    const contents = normalized.map((entry) => entry.content)
    const leaked = contents.reduce(
      (total, content) =>
        total +
        secretFields.filter((_, index) => content.includes(`synthetic-leak-${index}-end`)).length,
      0,
    )
    const retained = contents.reduce(
      (total, content) =>
        total +
        normalFields.filter((_, index) => content.includes(`normal-control-${index}-end`)).length,
      0,
    )
    report(
      JSON.stringify({
        structuredSecrets: {
          cases: secretFields.length * contents.length,
          leaked,
          leakageRate: leaked / (secretFields.length * contents.length),
        },
        normalControls: {
          cases: normalFields.length * contents.length,
          retained,
          falsePositiveRate: 1 - retained / (normalFields.length * contents.length),
        },
      }),
    )
    await withStore(entries, async (store) => {
      const read = await store.execute({
        action: 'read',
        session_id: sessionId,
        include_tool_payloads: true,
      })
      const serialized = JSON.stringify(read)
      expect(
        normalFields.every((_, index) => serialized.includes(`normal-control-${index}-end`)),
      ).toBe(true)
      expect(serialized).not.toContain('synthetic-leak-')
      expect((await store.execute({ action: 'search', query: 'synthetic-leak-' })).data).toEqual([])
    })
    expect(leaked).toBe(0)
    expect(retained).toBe(normalFields.length * contents.length)
    expect(normalized.every((entry) => entry.redacted)).toBe(true)
  })
})
