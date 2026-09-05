import { afterEach, describe, expect, test } from 'vite-plus/test'

import { argumentGlyphs, extractArgumentPaths, fileTypeKey } from '../src/arg-glyphs.ts'
import { setIconMode } from '../src/icons.ts'
import { decodeRailAction } from '../src/rail-channel.ts'
import { railPatchForCall } from '../src/rail-tools.ts'

afterEach(() => setIconMode('ascii'))

describe('extractArgumentPaths', () => {
  test('uses a scalar path from tool arguments', () => {
    expect(extractArgumentPaths({ path: 'src/index.ts' })).toEqual(['src/index.ts'])
  })

  test('reads and deduplicates file arrays', () => {
    expect(
      extractArgumentPaths({
        files: ['a.ts', { filePath: 'b.py' }, { path: 'a.ts' }],
      }),
    ).toEqual(['a.ts', 'b.py'])
  })

  test('supports spaces and rejects scalar flags', () => {
    expect(extractArgumentPaths({ path: 'a path with spaces.ts' })).toEqual([
      'a path with spaces.ts',
    ])
    expect(extractArgumentPaths('--flag')).toEqual([])
  })

  test('uses paths when the files list is empty', () => {
    expect(extractArgumentPaths({ files: [], paths: ['src/index.ts'] })).toEqual(['src/index.ts'])
  })

  test('combines scalar files and paths fields', () => {
    expect(extractArgumentPaths({ files: 'src/a.ts', paths: 'src/b.py' })).toEqual([
      'src/a.ts',
      'src/b.py',
    ])
  })
})

describe('fileTypeKey', () => {
  test('matches exact names and compound extensions', () => {
    expect(fileTypeKey('.gitignore')).toBe('git')
    expect(fileTypeKey('src/types.d.ts')).toBe('ts')
    expect(fileTypeKey('Dockerfile')).toBe('docker')
  })

  test('distinguishes directories and plain files', () => {
    expect(fileTypeKey('src/')).toBe('dir')
    expect(fileTypeKey('README')).toBe('plain')
  })
})

describe('argumentGlyphs', () => {
  test('emits the file glyph in Nerd Font mode', () => {
    setIconMode('nerd')
    expect(argumentGlyphs('read', { path: 'src/index.ts' })).toEqual(['\uE628'])
  })

  test('deduplicates glyphs and keeps the first three', () => {
    setIconMode('nerd')
    expect(
      argumentGlyphs('read', {
        files: ['a.ts', 'b.mts', 'c.py', 'd.go', 'e.rs'],
      }),
    ).toEqual(['\uE628', '\uE73C', '\uE627'])
  })

  test('supports the Pi edit and write aliases', () => {
    setIconMode('nerd')
    expect(argumentGlyphs('edit', { path: 'src/index.ts' })).toEqual(['\uE628'])
    expect(argumentGlyphs('write', { path: 'src/index.ts' })).toEqual(['\uE628'])
  })

  test('adds glyphs to a built-in rail patch', () => {
    setIconMode('nerd')
    const patch = railPatchForCall({ arguments: { path: 'src/index.ts' }, toolName: 'read' }, '')
    expect(patch.argGlyphs).toEqual(['\uE628'])
  })

  test('emits nothing without Nerd Font mode', () => {
    setIconMode('ascii')
    expect(argumentGlyphs('read', { path: 'src/index.ts' })).toEqual([])
  })

  test('emits nothing for an ineligible tool', () => {
    setIconMode('nerd')
    expect(argumentGlyphs('grep', { path: 'src/index.ts' })).toEqual([])
  })

  test('decodes only supported persisted glyphs', () => {
    const report = decodeRailAction({
      argGlyphs: ['\uE628', '\u{F031B}'],
      status: 'ok',
      toolCallId: 'call-1',
    })
    expect(report?.argGlyphs).toEqual(['\uE628', '\u{F031B}'])
    for (const glyphs of [
      ['a', 'b', 'c', 'd'],
      ['\n'],
      [`${String.fromCharCode(27)}[31m`],
      ['\uE628\uE73C'],
      ['x'.repeat(1_000)],
      ['😀'],
    ]) {
      expect(
        decodeRailAction({
          argGlyphs: glyphs,
          status: 'ok',
          toolCallId: 'call-1',
        }),
      ).toBeUndefined()
    }
  })
})
