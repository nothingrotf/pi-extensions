import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { contextFileIn, directoryChain, discoverContextFiles } from '../src/discovery.ts'
import { deliveredFiles, messageType, touchedPaths } from '../src/index.ts'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true })
})

async function root(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'subdir-discovery-')))
  roots.push(dir)
  return dir
}

describe('touchedPaths', () => {
  test('reads paths from arguments of supported tools only', () => {
    expect(touchedPaths('read', { path: 'a.ts' })).toEqual(['a.ts'])
    expect(touchedPaths('read', { paths: ['a.ts', 'b/c.ts'] })).toEqual(['a.ts', 'b/c.ts'])
    expect(touchedPaths('grep', { path: 'src', pattern: 'x' })).toEqual(['src'])
    expect(touchedPaths('find', { pattern: '*.ts' })).toEqual([])
    expect(touchedPaths('edit', { edits: [], path: 'a.ts' })).toEqual(['a.ts'])
    expect(touchedPaths('patch', { files: [{ path: 'a.ts' }, { path: 'b.ts' }] })).toEqual([
      'a.ts',
      'b.ts',
    ])
    expect(touchedPaths('bash', { command: 'cat a.ts', path: 'a.ts' })).toEqual([])
    expect(touchedPaths('read', 'a.ts')).toEqual([])
  })
})

describe('directoryChain', () => {
  test('lists directories below the root, outer first', async () => {
    const dir = await root()
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'file.ts'), '')
    expect(await directoryChain(dir, 'a/b/file.ts')).toEqual([join(dir, 'a'), join(dir, 'a', 'b')])
    expect(await directoryChain(dir, join(dir, 'a', 'b'))).toEqual([
      join(dir, 'a'),
      join(dir, 'a', 'b'),
    ])
    expect(await directoryChain(dir, '.')).toEqual([])
  })

  test('uses the nearest existing parent of a new path', async () => {
    const dir = await root()
    await mkdir(join(dir, 'a'))
    expect(await directoryChain(dir, 'a/new/dir/file.ts')).toEqual([join(dir, 'a')])
  })

  test('rejects paths outside the root', async () => {
    const dir = await root()
    expect(await directoryChain(dir, '../elsewhere/file.ts')).toEqual([])
    expect(await directoryChain(join(dir, 'sub'), dir)).toEqual([])
  })
})

describe('context files', () => {
  test('prefers the override file, like Pi', async () => {
    const dir = await root()
    await writeFile(join(dir, 'CLAUDE.md'), 'claude')
    await writeFile(join(dir, 'AGENTS.override.md'), 'override')
    expect(await contextFileIn(dir)).toBe(join(dir, 'AGENTS.override.md'))
  })

  test('strips a byte order mark and reports root-relative paths', async () => {
    const dir = await root()
    await mkdir(join(dir, 'pkg'))
    await writeFile(join(dir, 'pkg', 'AGENTS.md'), '\uFEFFrule')
    const [file] = await discoverContextFiles(dir, ['pkg/missing.ts'])
    expect(file).toMatchObject({ content: 'rule', path: 'pkg/AGENTS.md' })
  })
})

describe('deliveredFiles', () => {
  const base = { parentId: null, timestamp: '0' } as const
  const delivery = (id: string, path: string, sha256: string): SessionEntry => ({
    ...base,
    content: 'rules',
    customType: messageType,
    details: { files: [{ path, sha256 }], version: 1 },
    display: true,
    id,
    type: 'custom_message',
  })

  test('forgets deliveries that a compaction removed from the context', () => {
    const branch: SessionEntry[] = [
      delivery('1', 'a/AGENTS.md', 'one'),
      delivery('2', 'b/AGENTS.md', 'two'),
      {
        ...base,
        firstKeptEntryId: '2',
        id: '3',
        summary: 'summary',
        tokensBefore: 10,
        type: 'compaction',
      },
      delivery('4', 'c/AGENTS.md', 'three'),
    ]
    expect([...deliveredFiles(branch)]).toEqual([
      ['b/AGENTS.md', 'two'],
      ['c/AGENTS.md', 'three'],
    ])
  })
})
