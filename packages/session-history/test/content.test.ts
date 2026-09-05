import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it } from 'vite-plus/test'

import { SessionHistoryStore, type ContentReadInput } from '../src/index.ts'

const directories: string[] = []

async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'history-content-'))
  directories.push(cwd)
  const manager = SessionManager.create(cwd, join(cwd, 'sessions'))
  const text = `start ${'abc\n😀'.repeat(1_000)} end`
  const entry_id = manager.appendMessage({ role: 'user', content: text, timestamp: 1 })
  const resultId = manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'call',
    toolName: 'bash',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: 2,
  })
  const store = new SessionHistoryStore(manager)
  const input: ContentReadInput = { session_id: manager.getSessionId(), entry_id, limit: 511 }
  return { cwd, manager, store, input, text, resultId }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('reconstructs long messages and results and returns to earlier windows', async () => {
  const state = await fixture()
  for (const entry_id of [state.input.entry_id, state.resultId]) {
    const input = { ...state.input, entry_id, include_tool_payloads: true }
    const first = await state.store.readContent(input)
    let page = first
    let text = page.data[0].content
    const references = new Set([page.data[0].chunkReference])
    while (page.pagination.cursor !== null) {
      const previous = page
      page = await state.store.readContent({ ...input, cursor: page.pagination.cursor })
      expect(page.pagination.offset).toBe(previous.pagination.end)
      expect(page.pagination.previousCursor).not.toBeNull()
      if (page.pagination.previousCursor === null) throw new Error('Missing previous cursor.')
      const back = await state.store.readContent({
        ...input,
        cursor: page.pagination.previousCursor,
      })
      expect(back).toEqual(previous)
      references.add(page.data[0].chunkReference)
      text += page.data[0].content
    }
    expect(text).toBe(state.text)
    expect(references.size).toBe(Math.ceil(state.text.length / 511))
    expect(first.pagination.previousCursor).toBeNull()
    expect(page.data[0].sourceTruncated).toBe(false)
  }
})

it('keeps references and cursors stable after appends and cache eviction', async () => {
  const { manager, store, input } = await fixture()
  const first = await store.readContent(input)
  const cursor = first.pagination.cursor
  if (cursor === null) throw new Error('Missing cursor.')
  const second = await store.readContent({ ...input, cursor })
  manager.appendMessage({ role: 'user', content: 'unrelated', timestamp: 3 })
  store.clearCache()
  expect(await store.readContent(input)).toEqual(first)
  expect(await new SessionHistoryStore(manager).readContent({ ...input, cursor })).toEqual(second)
  expect(await store.execute({ action: 'content', ...input })).toEqual(first)
})

it('enforces payload omission, scope, views, cancellation, and input bounds', async () => {
  const { manager, store, input, resultId } = await fixture()
  const omitted = await store.readContent({ ...input, entry_id: resultId })
  expect(omitted.data[0].payloadOmitted).toBe(true)
  expect(omitted.data[0].content).toBe('[tool payload omitted]')
  for (const options of [
    { limit: 0 },
    { limit: 16_001 },
    { offset: -1 },
    { block_index: -1 },
    { cursor: 'bad', offset: 0 },
  ]) {
    await expect(store.readContent({ ...input, ...options })).rejects.toMatchObject({
      code: 'INVALID_QUERY',
    })
  }
  for (const options of [{ cursor: 'bad' }, { offset: 100_000 }]) {
    await expect(store.readContent({ ...input, ...options })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    })
  }
  await expect(store.readContent({ ...input, session_id: 'outside' })).rejects.toMatchObject({
    code: 'OUT_OF_SCOPE',
  })
  await expect(store.readContent({ ...input, block_index: 1 })).rejects.toMatchObject({
    code: 'ENTRY_NOT_FOUND',
  })
  const controller = new AbortController()
  controller.abort(new Error('cancel content'))
  await expect(store.readContent(input, controller.signal)).rejects.toThrow('cancel content')
  manager.branch(input.entry_id)
  await expect(store.readContent({ ...input, entry_id: resultId })).rejects.toMatchObject({
    code: 'ENTRY_NOT_FOUND',
  })
  expect(
    (await store.readContent({ ...input, entry_id: resultId, view: 'audit' })).data[0].branchState,
  ).toBe('abandoned')
})

it('rejects cursors reused for different content, options, or entries', async () => {
  const { store, input, resultId } = await fixture()
  const first = await store.readContent(input)
  const cursor = first.pagination.cursor
  if (cursor === null) throw new Error('Missing cursor.')
  const changes: Partial<ContentReadInput>[] = [
    { entry_id: resultId },
    { limit: 512 },
    { view: 'audit' },
    { include_tool_payloads: true },
  ]
  for (const options of changes) {
    await expect(store.readContent({ ...input, ...options, cursor })).rejects.toMatchObject({
      code: 'INVALID_CURSOR',
    })
  }
})

it('reads persisted content without writes and invalidates changed content cursors', async () => {
  const { manager, input, text, cwd } = await fixture()
  const path = manager.getSessionFile()
  if (path === undefined) throw new Error('Missing session path.')
  const original =
    [manager.getHeader(), ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join('\n') + '\n'
  await writeFile(path, original)
  const current = SessionManager.create(cwd, manager.getSessionDir())
  const store = new SessionHistoryStore(current)
  const first = await store.readContent(input)
  const cursor = first.pagination.cursor
  if (cursor === null) throw new Error('Missing cursor.')
  expect(await readFile(path, 'utf8')).toBe(original)
  await writeFile(
    path,
    original.replace(JSON.stringify(text), JSON.stringify(text.replace('start', 'other'))),
  )
  await expect(store.readContent({ ...input, cursor })).rejects.toMatchObject({
    code: 'INVALID_CURSOR',
  })
  expect((await store.readContent(input)).data[0].chunkReference).not.toBe(
    first.data[0].chunkReference,
  )
})

it('handles empty content and exact end offsets', async () => {
  const { manager, store, input, text } = await fixture()
  const entry_id = manager.appendMessage({ role: 'user', content: '', timestamp: 3 })
  const empty = await store.readContent({ ...input, entry_id })
  expect(empty.pagination).toEqual({
    cursor: null,
    previousCursor: null,
    offset: 0,
    end: 0,
    total: 0,
  })
  expect(empty.truncated).toBe(false)
  const end = await store.readContent({ ...input, offset: text.length })
  expect(end.data[0].content).toBe('')
  expect(end.pagination.cursor).toBeNull()
  expect(end.pagination.previousCursor).not.toBeNull()
})
