import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import { SessionHistoryStore } from '../../src/sessions.ts'

const collect = globalThis.gc
if (collect === undefined) throw new Error('Run the heap evaluation with --expose-gc.')
const mode = process.argv[2]
if (mode !== 'blocks' && mode !== 'payloads' && mode !== 'previews')
  throw new Error('Unknown heap corpus.')

async function memory() {
  for (let pass = 0; pass < 3; pass += 1) {
    await setImmediate()
    collect?.()
  }
  return process.memoryUsage().heapUsed
}

async function createCorpus(cwd: string, directory: string) {
  const ids: string[] = []
  for (let session = 0; session < 32; session += 1) {
    const id = `heap-${session}`
    ids.push(id)
    const timestamp = '2026-01-01T00:00:00.000Z'
    const lines = [JSON.stringify({ type: 'session', version: 3, id, cwd, timestamp })]
    const count = mode === 'blocks' ? 200 : mode === 'previews' ? 1 : 30
    for (let index = 0; index < count; index += 1) {
      const marker = createHash('sha256').update(`${id}:${index}`).digest('hex')
      const content =
        mode === 'previews'
          ? marker.repeat(16384)
          : mode === 'blocks'
            ? Array.from({ length: 6 }, (_, block) => ({
                type: 'text',
                text: `${marker}:${block}:short evidence`,
              }))
            : [{ type: 'text', text: `Ω${marker.repeat(320)}` }]
      lines.push(
        JSON.stringify({
          type: 'message',
          id: `${id}-${index}`,
          parentId: index === 0 ? null : `${id}-${index - 1}`,
          timestamp,
          message: { role: mode === 'previews' ? 'user' : 'assistant', content, timestamp: index },
        }),
      )
    }
    await writeFile(join(directory, `${id}.jsonl`), `${lines.join('\n')}\n`)
  }
  return ids
}

const root = await mkdtemp(join(tmpdir(), 'session-history-heap-'))
try {
  const cwd = join(root, 'project')
  const directory = join(root, 'sessions')
  await mkdir(directory)
  const ids = await createCorpus(cwd, directory)
  const current = SessionManager.create(cwd, directory, { id: 'heap-current' })
  const store = new SessionHistoryStore(current)
  const first = ids[0]
  if (first === undefined) throw new Error('Missing heap fixture.')
  await store.execute({ action: 'read', session_id: first, limit: 1 })
  store.clearCache()
  const baselineHeap = await memory()
  let sampledPeakHeap = baselineHeap
  for (const session_id of ids) {
    await store.execute({ action: 'read', session_id, limit: 1 })
    sampledPeakHeap = Math.max(sampledPeakHeap, process.memoryUsage().heapUsed)
  }
  const filledHeap = await memory()
  const filledCache = store.cacheDiagnostics()
  for (const session_id of ids) {
    await store.execute({ action: 'read', session_id, limit: 1 })
    sampledPeakHeap = Math.max(sampledPeakHeap, process.memoryUsage().heapUsed)
  }
  const churnHeap = await memory()
  const churnCache = store.cacheDiagnostics()
  store.clearCache()
  const clearedHeap = await memory()
  const clearedCache = store.cacheDiagnostics()
  process.stdout.write(
    `${JSON.stringify({ mode, sessions: ids.length, baselineHeap, filledHeap, churnHeap, clearedHeap, retainedDelta: churnHeap - clearedHeap, sampledPeakHeap, maximumRssBytes: process.resourceUsage().maxRSS * 1024, filledCache, churnCache, clearedCache })}\n`,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
