import { appendFile, mkdtemp, rename, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vite-plus/test'

import { fileVersion, sessionHeaderLine, sessionLines } from '../src/session-file.ts'
import { HistoryWork, historyLimits } from '../src/work.ts'

const directories: string[] = []
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'session-lines-'))
  directories.push(root)
  const path = join(root, 'session.jsonl')
  await writeFile(path, 'first\nsecond\n')
  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('preserves Unicode across chunk boundaries and a final line without newline', async () => {
  const path = await fixture()
  const text = `${'x'.repeat(65535)}Ω日本語`
  await writeFile(path, `${text}\nlast`)
  const lines: string[] = []
  for await (const line of sessionLines(path, new HistoryWork())) lines.push(line)
  expect(lines).toEqual([text, 'last'])
})

it.each(['append', 'replace', 'delete'])('rejects %s during an open snapshot', async (action) => {
  const path = await fixture()
  const expected = fileVersion(await stat(path))
  const consume = async () => {
    let first = true
    for await (const line of sessionLines(path, new HistoryWork(), expected)) {
      expect(line.length).toBeGreaterThan(0)
      if (!first) continue
      first = false
      if (action === 'append') await appendFile(path, 'changed\n')
      if (action === 'delete') await rm(path)
      if (action === 'replace') {
        await writeFile(`${path}.new`, 'replacement\n')
        await rename(`${path}.new`, path)
      }
    }
  }
  await expect(consume()).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
})

it('rejects oversized files before reading their contents', async () => {
  const path = await fixture()
  await truncate(path, historyLimits.fileBytes + 1)
  const consume = async () => {
    for await (const line of sessionLines(path, new HistoryWork())) expect(line).toBe('unreachable')
  }
  await expect(consume()).rejects.toMatchObject({ code: 'WORK_LIMIT_EXCEEDED' })
})

it('cancels between streamed lines rather than returning partial success', async () => {
  const path = await fixture()
  const controller = new AbortController()
  const consume = async () => {
    for await (const line of sessionLines(path, new HistoryWork(controller.signal))) {
      expect(line.length).toBeGreaterThan(0)
      controller.abort(new Error('cancelled stream'))
    }
  }
  await expect(consume()).rejects.toThrow('cancelled stream')
})

it('reads only a bounded first nonblank header with Unicode and no final newline', async () => {
  const path = await fixture()
  const header = `${'x'.repeat(1019)}Ω日本語`
  await writeFile(path, `\n \n${header}`)
  expect(await sessionHeaderLine(path, new HistoryWork(), fileVersion(await stat(path)))).toBe(
    header,
  )
  await writeFile(path, `${header}\n${'body'.repeat(100_000)}`)
  const work = new HistoryWork()
  expect(await sessionHeaderLine(path, work, fileVersion(await stat(path)))).toBe(header)
  expect(work.usage().bytesRead).toBe(2048)
})

it('fails closed on oversized identity headers without charging the rest of the file', async () => {
  const path = await fixture()
  await writeFile(path, `${'x'.repeat(historyLimits.headerBytes)}\nbody`)
  const work = new HistoryWork()
  await expect(sessionHeaderLine(path, work, fileVersion(await stat(path)))).rejects.toMatchObject({
    code: 'WORK_LIMIT_EXCEEDED',
  })
  expect(work.usage().bytesRead).toBe(historyLimits.headerBytes)
})

it('rejects identity drift before consuming a header', async () => {
  const path = await fixture()
  const version = fileVersion(await stat(path))
  await appendFile(path, 'changed\n')
  const work = new HistoryWork()
  await expect(sessionHeaderLine(path, work, version)).rejects.toMatchObject({
    code: 'SESSION_CHANGED',
  })
  expect(work.usage().bytesRead).toBe(0)
})

it('bounds aggregate bytes and normalized blocks independently', () => {
  expect(() => new HistoryWork().read(historyLimits.requestBytes + 1)).toThrow('history work limit')
  expect(() => new HistoryWork().normalize(historyLimits.entries + 1)).toThrow('history work limit')
})
