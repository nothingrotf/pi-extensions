import { describe, expect, it } from 'vite-plus/test'

import { readArtifact } from '../src/artifacts.ts'
import { selectJson, SelectorError } from '../src/json-select.ts'
import { structureProblem } from '../src/structure.ts'

describe('structureProblem', () => {
  it('reports an unclosed delimiter with its line', () => {
    expect(structureProblem('function a() {\n  return 1\n', '.ts')).toEqual({
      kind: 'balance',
      message: 'unclosed "{" opened at line 1',
    })
    expect(structureProblem('const a = [1, 2\n', '.js')).toMatchObject({ kind: 'balance' })
    expect(structureProblem('const a = 1)\n', '.ts')).toEqual({
      kind: 'balance',
      message: 'unexpected ")" at line 1',
    })
  })

  it('accepts delimiters inside strings, templates, comments, and regular expressions', () => {
    const source = [
      'const brace = "{"',
      "const other = '}'",
      'const template = `${value} }`',
      '// unbalanced ( comment',
      '/* unbalanced { block */',
      'const pattern = /[)]/u',
      'const done = { ok: true }',
    ].join('\n')

    expect(structureProblem(source, '.ts')).toBeUndefined()
  })

  it('checks JSON exactly and skips unknown languages', () => {
    expect(structureProblem('{"a": 1}', '.json')).toBeUndefined()
    expect(structureProblem('{"a": 1,}', '.json')).toMatchObject({ kind: 'json' })
    expect(structureProblem('unbalanced ( text', '.md')).toBeUndefined()
    expect(structureProblem('x'.repeat(600_000), '.ts')).toBeUndefined()
  })
})

describe('readArtifact', () => {
  it('detects bounded read output and native truncation notices', () => {
    expect(readArtifact('[bounded read] a.ts has 10 lines')).toBe('[bounded read]')
    expect(readArtifact('code\n\n[Showing lines 1-200 of 900. Use offset=201 to continue.]')).toBe(
      '[Showing lines 1-200 of 900',
    )
    expect(readArtifact('code\n\n[42 more lines in file. Use offset=8 to continue.]')).toBe(
      '[42 more lines in file. Use offset=8 to continue.]',
    )
    expect(readArtifact('const a = 1\n')).toBeUndefined()
  })
})

describe('selectJson', () => {
  const document = {
    value: {
      'dotted.key': 'quoted',
      scripts: { 'test:domain': 'vp test run' },
      items: [{ id: 0 }, { id: 1 }, { id: 2 }],
      report: { total: 3, verdict: 'pass' },
    },
  }

  it('selects fields, indexes, slices, quoted keys, and lengths', () => {
    expect(selectJson(document, '.').value).toEqual(document.value)
    expect(selectJson(document, '.report.verdict').value).toBe('pass')
    expect(selectJson(document, '.items[1].id').value).toBe(1)
    expect(selectJson(document, '.items[0:2]').value).toEqual([{ id: 0 }, { id: 1 }])
    expect(selectJson(document, '.items[5:9]').value).toEqual([])
    expect(selectJson(document, '.items.length').value).toBe(3)
    expect(selectJson(document, '.["dotted.key"]').value).toBe('quoted')
    expect(selectJson(document, '.scripts.test:domain').value).toBe('vp test run')
  })

  it('fails instead of returning a silently wrong value', () => {
    for (const selector of [
      'report',
      '.missing',
      '.items[9]',
      '.items[3:1]',
      '.report.length',
      '.items[*]',
      '.report[0]',
    ]) {
      expect(() => selectJson(document, selector)).toThrow(SelectorError)
    }
  })
})
