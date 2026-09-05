import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it } from 'vite-plus/test'

import { SessionDiscovery } from '../src/discovery.ts'
import { SessionHistoryStore } from '../src/sessions.ts'
import { HistoryWork } from '../src/work.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('matches native discovery metadata without retaining conversation bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-metadata-'))
  directories.push(root)
  const manager = SessionManager.create(root, join(root, 'sessions'), { id: 'metadata' })
  manager.appendMessage({ role: 'user', content: 'first Ω message \ud800', timestamp: 1000 })
  manager.appendMessage({ role: 'user', content: 'z'.repeat(1000000), timestamp: 2000 })
  manager.appendSessionInfo(' Metadata Ω name \ud800 ')
  const path = manager.getSessionFile()
  if (path === undefined) throw new Error('Missing fixture path.')
  const persist = () =>
    writeFile(
      path,
      [manager.getHeader(), ...manager.getEntries()]
        .map((entry) => JSON.stringify(entry))
        .join('\n'),
    )
  await persist()
  const native = (await SessionManager.listAll(manager.getSessionDir()))[0]
  if (native === undefined) throw new Error('Missing native metadata.')
  const discovery = new SessionDiscovery()
  const cold = new HistoryWork()
  const first = await discovery.info(path, await stat(path), cold)
  expect(first).toEqual({ ...native, allMessagesText: '' })
  expect(JSON.stringify(first)).not.toContain('z'.repeat(1000))
  const warm = new HistoryWork()
  expect(await discovery.info(path, await stat(path), warm)).toEqual(first)
  expect(cold.usage().bytesRead).toBe((await stat(path)).size)
  expect(warm.usage().bytesRead).toBe(0)
  manager.appendSessionInfo('')
  await persist()
  const updated = new HistoryWork()
  expect(await discovery.info(path, await stat(path), updated)).not.toHaveProperty('name')
  expect(updated.usage().bytesRead).toBeGreaterThan(0)
})

it('counts a corrupted session body instead of listing valid-looking metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-corrupt-body-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory, { id: 'current' })
  const path = join(directory, 'corrupt.jsonl')
  const header = {
    type: 'session',
    version: 3,
    id: 'corrupt',
    cwd: root,
    timestamp: '2026-01-01T00:00:00.000Z',
  }
  await writeFile(path, `${JSON.stringify(header)}\n\n{broken json\n`)
  const discovery = new SessionDiscovery()
  expect(await discovery.info(path, await stat(path), new HistoryWork())).toBeNull()
  const store = new SessionHistoryStore(current)
  const result = await store.execute({ action: 'list' })
  expect(result.data).toEqual([])
  expect(result.skippedSessions).toBe(1)
  expect(discovery.diagnostics().entries).toBe(0)
  await expect(store.execute({ action: 'read', session_id: 'corrupt' })).rejects.toMatchObject({
    code: 'MALFORMED_SESSION',
  })
  await writeFile(
    path,
    `${JSON.stringify({ ...header, cwd: join(root, 'other-project') })}\n{broken json\n`,
  )
  await expect(store.execute({ action: 'read', session_id: 'corrupt' })).rejects.toMatchObject({
    code: 'OUT_OF_SCOPE',
  })
  await writeFile(path, `${JSON.stringify(header)}\n`)
  expect((await store.execute({ action: 'read', session_id: 'corrupt' })).data).toEqual([])
})

it('rejects discovery beyond its file budget instead of returning exhaustive-looking results', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-discovery-limit-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  await mkdir(directory)
  await Promise.all(
    Array.from({ length: 1001 }, (_, index) => writeFile(join(directory, `${index}.jsonl`), '')),
  )
  await expect(new SessionDiscovery().files(directory, new HistoryWork())).rejects.toMatchObject({
    code: 'WORK_LIMIT_EXCEEDED',
  })
})
