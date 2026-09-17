import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { fileOutline, FULL_READ_BYTES, outlineNotice } from '../src/outline.ts'
import { boundedReadPlan } from '../src/read.ts'

const large = `${'const filler = 1\n'.repeat(2000)}export function target(): void {}\n`

interface SeedFile {
  content: string
  name: string
}

async function workspace(files: readonly SeedFile[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'filetools-read-'))
  for (const file of files) {
    await writeFile(join(directory, file.name), file.content, 'utf8')
  }
  return directory
}

describe('boundedReadPlan', () => {
  it('bounds a large file read without an explicit window', async () => {
    const cwd = await workspace([{ content: large, name: 'big.ts' }])

    const plan = await boundedReadPlan({ path: 'big.ts' }, cwd)

    expect(plan?.bytes).toBeGreaterThan(FULL_READ_BYTES)
  })

  it('returns a small file unbounded', async () => {
    const cwd = await workspace([{ content: 'export const a = 1\n', name: 'small.ts' }])

    expect(await boundedReadPlan({ path: 'small.ts' }, cwd)).toBeUndefined()
  })

  it('honors an explicit window', async () => {
    const cwd = await workspace([{ content: large, name: 'big.ts' }])

    expect(await boundedReadPlan({ limit: 40, offset: 10, path: 'big.ts' }, cwd)).toBeUndefined()
    expect(await boundedReadPlan({ offset: 10, path: 'big.ts' }, cwd)).toBeUndefined()
  })

  it('leaves a missing file to the native tool', async () => {
    const cwd = await workspace([])

    expect(await boundedReadPlan({ path: 'gone.ts' }, cwd)).toBeUndefined()
  })
})

describe('fileOutline', () => {
  it('collects declarations, headings, and methods', () => {
    const outline = fileOutline(
      [
        '# Title',
        'const skipped = 1',
        'export function alpha(): void {}',
        'class Beta {',
        '  gamma(value: string) {}',
        '}',
      ].join('\n'),
    )

    expect(outline.lines).toBe(6)
    expect(outline.entries.map((entry) => entry.line)).toEqual([1, 2, 3, 4, 5])
    expect(outline.entries[2]?.text).toBe('export function alpha(): void {}')
  })

  it('caps the entry count and marks truncation', () => {
    const source = Array.from(
      { length: 120 },
      (_, index) => `export function fn${index}(): void {}`,
    )

    const outline = fileOutline(source.join('\n'))

    expect(outline.entries).toHaveLength(60)
    expect(outline.truncatedEntries).toBe(true)
  })

  it('collapses repeated declaration lines', () => {
    const outline = fileOutline(
      `${'const filler = 1\n'.repeat(200)}export function target(): void {}`,
    )

    expect(outline.entries).toHaveLength(2)
    expect(outline.entries[1]).toMatchObject({
      line: 201,
      text: 'export function target(): void {}',
    })
  })

  it('renders a notice that names the next step', () => {
    const notice = outlineNotice('big.ts', fileOutline(large), 200, 34_000)

    expect(notice).toContain('big.ts has 2002 lines and 34000 bytes')
    expect(notice).toContain('Continue with offset=201')
    expect(notice).toContain('export function target(): void {}')
  })
})
