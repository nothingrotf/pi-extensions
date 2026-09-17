import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { createFiletoolsHarness, resultText, type FiletoolsHarness } from './harness.ts'

const large = `${'const filler = 1\n'.repeat(3000)}export function target(): void {}\n`
const report = JSON.stringify({
  items: Array.from({ length: 500 }, (_value, index) => ({ id: index })),
  verdict: 'pass',
})

let harness: FiletoolsHarness | undefined

afterEach(async () => {
  if (harness === undefined) return
  harness.dispose()
  await rm(harness.cwd, { force: true, recursive: true })
  harness = undefined
})

describe('read in a real session', () => {
  it('reads several files in one call and bounds the large one', async () => {
    harness = await createFiletoolsHarness([
      { content: 'export const a = 1\n', name: 'a.ts' },
      { content: 'export const b = 2\n', name: 'b.ts' },
      { content: large, name: 'big.ts' },
    ])

    const result = await harness
      .tool('read')
      .execute('call-1', { paths: ['a.ts', 'b.ts', 'big.ts'] })
    const text = resultText(result)

    expect(text).toContain('===== a.ts =====')
    expect(text).toContain('export const a = 1')
    expect(text).toContain('===== b.ts =====')
    expect(text).toContain('[bounded read] big.ts has 3002 lines')
    expect(text).toContain('Continue with offset=201')
    expect(text.length).toBeLessThan(6000)
  })

  it('caps every file of a multi-path read with one limit', async () => {
    harness = await createFiletoolsHarness([
      { content: 'a1\na2\na3\n', name: 'a.ts' },
      { content: 'b1\nb2\nb3\n', name: 'b.ts' },
    ])

    const text = resultText(
      await harness.tool('read').execute('call-11', { limit: 1, paths: ['a.ts', 'b.ts'] }),
    )

    expect(text).toContain('a1')
    expect(text).not.toContain('a2')
    expect(text).toContain('b1')
    expect(text).not.toContain('b2')
  })

  it('projects JSON before any truncation', async () => {
    harness = await createFiletoolsHarness([{ content: report, name: 'report.json' }])

    const result = await harness.tool('read').execute('call-2', {
      json: ['.verdict', '.items.length', '.items[0:2]'],
      path: 'report.json',
    })
    const text = resultText(result)

    expect(JSON.parse(text)).toEqual(['pass', 500, [{ id: 0 }, { id: 1 }]])
    expect(text.length).toBeLessThan(200)
  })

  it('rejects option combinations that would hide a wrong result', async () => {
    harness = await createFiletoolsHarness([
      { content: 'export const a = 1\n', name: 'a.ts' },
      { content: report, name: 'report.json' },
    ])
    const read = harness.tool('read')

    await expect(read.execute('call-3', { path: 'a.ts', paths: ['a.ts'] })).rejects.toThrow(
      /either path or paths/,
    )
    await expect(read.execute('call-4', { offset: 2, paths: ['a.ts'] })).rejects.toThrow(
      /no offset/,
    )
    await expect(
      read.execute('call-5', { json: '.verdict', paths: ['report.json'] }),
    ).rejects.toThrow(/no json selector/)
    await expect(read.execute('call-6', { json: '.missing', path: 'report.json' })).rejects.toThrow(
      /has no key "missing"/,
    )
    await expect(read.execute('call-7', { json: '.a', path: 'a.ts' })).rejects.toThrow(
      /not valid JSON/,
    )
  })
})

describe('patch in a real session', () => {
  it('reports a structural problem introduced by an edit', async () => {
    harness = await createFiletoolsHarness([
      { content: 'export function a(): void {\n  return\n}\n', name: 'a.ts' },
    ])

    const result = await harness.tool('patch').execute('call-8', {
      files: [
        {
          edits: [
            {
              newText: 'export function a(): void {\n  return',
              oldText: 'export function a(): void {\n  return\n}',
            },
          ],
          path: 'a.ts',
        },
      ],
    })

    expect(resultText(result)).toContain('check: balance: unclosed "{" opened at line 1')
  })

  it('refuses content that carries a bounded read marker', async () => {
    harness = await createFiletoolsHarness([{ content: large, name: 'big.ts' }])
    const bounded = resultText(await harness.tool('read').execute('call-9', { path: 'big.ts' }))

    await expect(
      harness.tool('patch').execute('call-10', { files: [{ content: bounded, path: 'big.ts' }] }),
    ).rejects.toThrow(/bounded read marker/)
    expect(await readFile(join(harness.cwd, 'big.ts'), 'utf8')).toBe(large)
  })
})
