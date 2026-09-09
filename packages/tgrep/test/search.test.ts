import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'

import { search } from '../src/search.ts'

const available = spawnSync('tgrep', ['--version']).status === 0
let cwd = ''
beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'pi-tgrep-'))
})
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true })
})

describe.skipIf(!available)('Microsoft tgrep integration', () => {
  test('searches hidden files, respects ignores, and scopes globs', async () => {
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.gitignore'), 'ignored.ts\n')
    await writeFile(join(cwd, 'ignored.ts'), 'needle')
    await writeFile(join(cwd, '.hidden.ts'), 'needle')
    await writeFile(join(cwd, 'other.txt'), 'needle')
    const result = await search({ pattern: 'needle', glob: '*.ts' }, cwd)
    expect(result.content[0]?.text).toBe('.hidden.ts:1: needle')
  })

  test('supports literal, case, context, and individual paths', async () => {
    await writeFile(join(cwd, 'a file.ts'), 'before\nA.B\naXb\nafter\n')
    const result = await search(
      { pattern: 'a.b', literal: true, ignoreCase: true, context: 1, path: '@a file.ts' },
      cwd,
    )
    expect(result.content[0]?.text).toBe('a file.ts-1- before\na file.ts:2: A.B\na file.ts-3- aXb')
  })

  test('treats subcommand names and flags as patterns', async () => {
    await writeFile(join(cwd, 'a.txt'), 'serve\n--help\n')
    expect((await search({ pattern: 'serve' }, cwd)).content[0]?.text).toContain('a.txt:1: serve')
    expect((await search({ pattern: '--help' }, cwd)).content[0]?.text).toContain('a.txt:2: --help')
  })

  test('distinguishes no matches, invalid regex, and missing paths', async () => {
    await writeFile(join(cwd, 'a.txt'), 'hello')
    expect((await search({ pattern: 'absent' }, cwd)).content[0]?.text).toBe('No matches found')
    await expect(search({ pattern: '[' }, cwd)).rejects.toThrow(/regex|pattern|parse/i)
    await expect(search({ pattern: 'x', path: 'missing' }, cwd)).rejects.toThrow('ENOENT')
  })

  test('caps global matches and long lines', async () => {
    await writeFile(join(cwd, 'a.txt'), `${'x'.repeat(600)}\nx\nx\n`)
    const result = await search({ pattern: 'x', limit: 1 }, cwd)
    expect(result.details.matchLimitReached).toBe(1)
    expect(result.details.linesTruncated).toBe(true)
    expect(result.content[0]?.text).not.toContain('a.txt:2:')
  })

  test('caps output bytes and reports truncation', async () => {
    await writeFile(join(cwd, 'a.txt'), `${'x'.repeat(490)}\n`.repeat(200))
    const result = await search({ pattern: 'x', limit: 200 }, cwd)
    expect(result.details.truncation?.truncated).toBe(true)
    expect(result.content[0]?.text).toContain('Output truncated')
  })

  test('fresh searches find files created after indexing', async () => {
    await writeFile(join(cwd, 'old.txt'), 'old')
    execFileSync('tgrep', ['index', cwd, '--no-max-filesize'], { stdio: 'pipe' })
    await writeFile(join(cwd, 'new.txt'), 'new needle')
    expect((await search({ pattern: 'needle' }, cwd)).content[0]?.text).toContain(
      'new.txt:1: new needle',
    )
    const indexed = await search({ pattern: 'old' }, cwd, true)
    expect(indexed.content[0]?.text).toContain('old.txt:1: old')
    expect(indexed.content[0]?.text).toContain('Indexed mode')
  })
})

test('reports missing executable with installation guidance', async () => {
  await expect(search({ pattern: 'x' }, cwd, false, join(cwd, 'missing-tgrep'))).rejects.toThrow(
    'Install Microsoft tgrep',
  )
})

test('honors cancellation before execution', async () => {
  const controller = new AbortController()
  controller.abort(new Error('cancelled by test'))
  await expect(search({ pattern: 'x' }, cwd, false, 'tgrep', controller.signal)).rejects.toThrow(
    'cancelled by test',
  )
})
