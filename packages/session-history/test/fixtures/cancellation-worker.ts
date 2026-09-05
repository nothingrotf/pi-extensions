import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'

import { SessionHistoryStore } from '../../src/sessions.ts'

const root = await mkdtemp(join(tmpdir(), 'history-cancellation-'))
try {
  const directory = join(root, 'sessions')
  await mkdir(directory)
  const timestamp = '2026-01-01T00:00:00.000Z'
  for (let index = 0; index < 32; index += 1) {
    await writeFile(
      join(directory, `${index}.jsonl`),
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: `cancel-${index}`,
          cwd: root,
          timestamp,
        }),
        JSON.stringify({
          type: 'message',
          id: 'entry',
          parentId: null,
          timestamp,
          message: { role: 'user', content: 'x'.repeat(1024 * 1024), timestamp: 1 },
        }),
      ].join('\n'),
    )
  }
  const store = new SessionHistoryStore(
    SessionManager.create(root, directory, { id: 'cancel-current' }),
  )
  const controller = new AbortController()
  const reason = new Error('cancelled evaluation')
  const started = performance.now()
  let signaledAt = started
  const timer = setTimeout(() => {
    signaledAt = performance.now()
    controller.abort(reason)
  }, 5)
  let cancelled = false
  try {
    await store.execute({ action: 'search', query: 'absent_marker' }, controller.signal)
  } catch (error) {
    if (error !== reason) throw error
    cancelled = true
  } finally {
    clearTimeout(timer)
  }
  const finished = performance.now()
  process.stdout.write(
    `${JSON.stringify({ cancelled, totalMs: finished - started, abortDelayMs: finished - signaledAt, sessions: 32, payloadBytes: 32 * 1024 * 1024 })}\n`,
  )
} finally {
  await rm(root, { recursive: true, force: true })
}
