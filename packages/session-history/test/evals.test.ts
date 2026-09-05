import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vite-plus/test'

import { SessionHistoryStore } from '../src/sessions.ts'

it('evaluates retrieval accuracy and cold and warm latency on a fixed corpus', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-history-eval-'))
  try {
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    await mkdir(directory)
    const date = '2026-01-01T00:00:00.000Z'
    for (let session = 0; session < 30; session += 1) {
      const id = `eval-${String(session).padStart(2, '0')}`
      const entries = Array.from({ length: 100 }, (_, index) => ({
        type: 'message',
        id: `${id}-${index}`,
        parentId: index === 0 ? null : `${id}-${index - 1}`,
        timestamp: date,
        message: {
          role: 'user',
          content: `${'background context '.repeat(30)} ${index === 99 ? `decision_${id}` : 'distractor'}`,
          timestamp: index,
        },
      }))
      await writeFile(
        join(directory, `${id}.jsonl`),
        [
          JSON.stringify({ type: 'session', version: 3, id, cwd, timestamp: date }),
          ...entries.map((entry) => JSON.stringify(entry)),
        ].join('\n'),
      )
    }
    const current = SessionManager.create(cwd, directory, { id: 'eval-current' })
    let inspections = 0
    let discoveryMs = 0
    const coldStart = performance.now()
    const store = new SessionHistoryStore(current, (path) => {
      if (++inspections === 31) discoveryMs = performance.now() - coldStart
      return stat(path)
    })
    const cold = await store.execute({ action: 'search', query: 'decision_eval-00' })
    const coldMs = performance.now() - coldStart
    expect(cold.data).toHaveLength(1)
    const samples: number[] = []
    let hits = 0
    for (let query = 0; query < 30; query += 1) {
      const id = `eval-${String(query).padStart(2, '0')}`
      const start = performance.now()
      const result = await store.execute({ action: 'search', query: `decision_${id}` })
      samples.push(performance.now() - start)
      expect(result.data).toHaveLength(1)
      expect(result.data[0]).toMatchObject({ sessionId: id, entryId: `${id}-99` })
      hits += 1
    }
    expect((await store.execute({ action: 'search', query: 'absent_marker' })).data).toEqual([])
    samples.sort((left, right) => left - right)
    if (process.env.SESSION_HISTORY_EVAL === '1') {
      process.stdout.write(
        `${JSON.stringify({ corpus: { sessions: 30, entries: 3000 }, recallAt1: hits / 30, coldMs, discoveryMs, warmP50Ms: samples[14], warmP95Ms: samples[28] })}\n`,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
