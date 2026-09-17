import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { formatPatchResults, PatchError, planPatch, writePatch } from '../src/patch.ts'

interface SeedFile {
  content: string
  name: string
}

async function workspace(files: readonly SeedFile[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'filetools-'))
  for (const file of files) {
    await writeFile(join(directory, file.name), file.content, 'utf8')
  }
  return directory
}

describe('planPatch', () => {
  it('applies ordered edits across several files', async () => {
    const cwd = await workspace([
      { content: 'const a = 1\nconst b = 2\n', name: 'a.ts' },
      { content: 'export const c = 3\n', name: 'b.ts' },
    ])
    const plan = await planPatch(
      {
        files: [
          { edits: [{ newText: 'const a = 9', oldText: 'const a = 1' }], path: 'a.ts' },
          {
            edits: [{ newText: 'export const c = 4', oldText: 'export const c = 3' }],
            path: 'b.ts',
          },
        ],
      },
      cwd,
    )
    const results = await writePatch(plan)

    expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('const a = 9\nconst b = 2\n')
    expect(await readFile(join(cwd, 'b.ts'), 'utf8')).toBe('export const c = 4\n')
    expect(results.map((result) => result.path)).toEqual(['a.ts', 'b.ts'])
    expect(formatPatchResults(results)).toContain('Patched 2 files.')
  })

  it('writes nothing when one edit fails to match', async () => {
    const cwd = await workspace([
      { content: 'const a = 1\n', name: 'a.ts' },
      { content: 'const b = 2\n', name: 'b.ts' },
    ])

    await expect(
      planPatch(
        {
          files: [
            { edits: [{ newText: 'const a = 9', oldText: 'const a = 1' }], path: 'a.ts' },
            { edits: [{ newText: 'x', oldText: 'missing' }], path: 'b.ts' },
          ],
        },
        cwd,
      ),
    ).rejects.toBeInstanceOf(PatchError)
    expect(await readFile(join(cwd, 'a.ts'), 'utf8')).toBe('const a = 1\n')
  })

  it('rejects an ambiguous edit', async () => {
    const cwd = await workspace([{ content: 'value\nvalue\n', name: 'a.ts' }])

    await expect(
      planPatch({ files: [{ edits: [{ newText: 'x', oldText: 'value' }], path: 'a.ts' }] }, cwd),
    ).rejects.toThrow(/more than once/)
  })

  it('creates a file from content and reports the line delta', async () => {
    const cwd = await workspace([])
    const plan = await planPatch({ files: [{ content: 'one\ntwo\n', path: 'nested/new.ts' }] }, cwd)
    const results = await writePatch(plan)

    expect(await readFile(join(cwd, 'nested/new.ts'), 'utf8')).toBe('one\ntwo\n')
    expect(results[0]).toMatchObject({ created: true, lineDelta: 2, path: 'nested/new.ts' })
  })

  it('rejects a file that declares both content and edits', async () => {
    const cwd = await workspace([{ content: 'x\n', name: 'a.ts' }])

    await expect(
      planPatch(
        { files: [{ content: 'y', edits: [{ newText: 'y', oldText: 'x' }], path: 'a.ts' }] },
        cwd,
      ),
    ).rejects.toThrow(/either content or edits/)
  })

  it('rejects the same file twice in one patch', async () => {
    const cwd = await workspace([{ content: 'x\ny\n', name: 'a.ts' }])

    await expect(
      planPatch(
        {
          files: [
            { edits: [{ newText: '1', oldText: 'x' }], path: 'a.ts' },
            { edits: [{ newText: '2', oldText: 'y' }], path: './a.ts' },
          ],
        },
        cwd,
      ),
    ).rejects.toThrow(/occurs more than once/)
  })

  it('rejects edits on a missing file', async () => {
    const cwd = await workspace([])

    await expect(
      planPatch({ files: [{ edits: [{ newText: 'b', oldText: 'a' }], path: 'gone.ts' }] }, cwd),
    ).rejects.toThrow(/does not exist/)
  })
})
