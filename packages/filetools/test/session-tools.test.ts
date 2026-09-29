import { readFile, rm, symlink } from 'node:fs/promises'
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

describe('structured results for programmatic callers', () => {
  it('returns per-file records, unread paths, and selected JSON values', async () => {
    harness = await createFiletoolsHarness([
      { content: 'export const a = 1\n', name: 'a.ts' },
      { content: large, name: 'big.ts' },
      { content: report, name: 'report.json' },
    ])
    const read = harness.tool('read')

    const multi = await read.execute('call-20', { paths: ['a.ts', 'big.ts'] })
    expect(multi.structuredContent).toEqual({
      files: [
        { bounded: false, images: 0, path: 'a.ts', text: 'export const a = 1\n' },
        {
          bounded: true,
          images: 0,
          path: 'big.ts',
          text: expect.stringContaining('[bounded read] big.ts has 3002 lines'),
        },
      ],
      unread: [],
    })

    const projected = await read.execute('call-21', {
      json: ['.verdict', '.items.length'],
      path: 'report.json',
    })
    expect(projected.structuredContent).toMatchObject({ value: ['pass', 500] })

    const patched = await harness.tool('patch').execute('call-22', {
      files: [
        { edits: [{ newText: 'export const a = 2', oldText: 'export const a = 1' }], path: 'a.ts' },
        { content: '{"broken": \n', path: 'new.json' },
      ],
    })
    expect(patched.structuredContent).toEqual({
      files: [
        { created: false, edits: 1, lineDelta: 0, path: 'a.ts' },
        {
          created: true,
          edits: 1,
          lineDelta: 1,
          path: 'new.json',
          warning: expect.stringContaining('json'),
        },
      ],
    })
  })
})

describe('patch mutation safety', () => {
  it('keeps every edit when parallel patches change the same file', async () => {
    const lines = Array.from({ length: 8 }, (_value, index) => `line ${index}`)
    harness = await createFiletoolsHarness([{ content: `${lines.join('\n')}\n`, name: 'a.ts' }])
    const patch = harness.tool('patch')

    await Promise.all(
      lines.map((line, index) =>
        patch.execute(`call-3${index}`, {
          files: [{ edits: [{ newText: `${line} changed`, oldText: line }], path: 'a.ts' }],
        }),
      ),
    )

    expect(await readFile(join(harness.cwd, 'a.ts'), 'utf8')).toBe(
      `${lines.map((line) => `${line} changed`).join('\n')}\n`,
    )
  })

  it('rejects one file named twice through a symbolic link', async () => {
    harness = await createFiletoolsHarness([{ content: 'x\ny\n', name: 'a.ts' }])
    await symlink(join(harness.cwd, 'a.ts'), join(harness.cwd, 'alias.ts'))

    await expect(
      harness.tool('patch').execute('call-40', {
        files: [
          { edits: [{ newText: '1', oldText: 'x' }], path: 'a.ts' },
          { edits: [{ newText: '2', oldText: 'y' }], path: 'alias.ts' },
        ],
      }),
    ).rejects.toThrow(/occurs more than once/)
    expect(await readFile(join(harness.cwd, 'a.ts'), 'utf8')).toBe('x\ny\n')
  })
})

describe('codemode scripts', () => {
  it('read structured values and patch files through the tool pipeline', async () => {
    harness = await createFiletoolsHarness(
      [
        { content: 'export const a = 1\n', name: 'a.ts' },
        { content: report, name: 'report.json' },
      ],
      { codemode: true, tools: ['read', 'patch', 'codemode'] },
    )

    const result = await harness.runScript(
      [
        'const [source, verdict] = await Promise.all([',
        "  tools.read({ path: 'a.ts' }),",
        "  tools.read({ path: 'report.json', json: '.verdict' }),",
        '])',
        "const patched = await tools.patch({ files: [{ path: 'a.ts', edits: [{ oldText: 'a = 1', newText: 'a = 2' }] }] })",
        'return { text: source.files[0].text, verdict: verdict.value, delta: patched.files[0].lineDelta }',
      ].join('\n'),
    )

    expect(result.isError).toBe(false)
    expect(result.text).toContain('{"text":"export const a = 1\\n","verdict":"pass","delta":0}')
    expect(result.nestedCalls.map((call) => `${call.name}:${call.status}`)).toEqual([
      'read:ok',
      'read:ok',
      'patch:ok',
    ])
    expect(await readFile(join(harness.cwd, 'a.ts'), 'utf8')).toBe('export const a = 2\n')
  })

  it('cannot reach patch from a script when patch is inactive', async () => {
    harness = await createFiletoolsHarness([{ content: 'export const a = 1\n', name: 'a.ts' }], {
      codemode: true,
      tools: ['read', 'codemode'],
    })

    const result = await harness.runScript(
      "await tools.patch({ files: [{ path: 'a.ts', content: 'gone' }] })",
    )

    expect(harness.activeTools()).toEqual(['read', 'codemode'])
    expect(result.isError).toBe(true)
    expect(result.nestedCalls).toEqual([])
    expect(await readFile(join(harness.cwd, 'a.ts'), 'utf8')).toBe('export const a = 1\n')
  })
})
