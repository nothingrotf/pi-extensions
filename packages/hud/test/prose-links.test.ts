import { describe, expect, test } from 'vite-plus/test'

import {
  type FileCandidate,
  fileUrl,
  findFileCandidates,
  findUrls,
  linkifyMarkdown,
  normalizeProjectPath,
  ProjectFileIndex,
  segmentProse,
} from '../src/prose-links.ts'

const cwd = '/repo'

function knownFiles(...paths: string[]) {
  const known = new Set(paths)
  return (candidate: FileCandidate) => (known.has(candidate.path) ? candidate.path : undefined)
}

describe('url detection', () => {
  test('keeps paths, queries, and fragments while trimming trailing punctuation', () => {
    expect(findUrls('see https://example.com/a/b?x=1#frag.')).toEqual([
      {
        end: 36,
        start: 4,
        text: 'https://example.com/a/b?x=1#frag',
        url: 'https://example.com/a/b?x=1#frag',
      },
    ])
  })

  test('drops unmatched closing brackets and adds a scheme to bare hosts', () => {
    expect(findUrls('(www.example.com/docs)').map((match) => match.url)).toEqual([
      'https://www.example.com/docs',
    ])
    expect(
      findUrls('github.com/org/repo, mailto:dev@example.com').map((match) => match.text),
    ).toEqual(['github.com/org/repo', 'mailto:dev@example.com'])
  })
})

describe('file candidates', () => {
  test('separates line and column suffixes from the path', () => {
    expect(findFileCandidates('open src/index.ts:42:7 now')).toEqual([
      { col: 7, end: 22, full: 'src/index.ts:42:7', line: 42, path: 'src/index.ts', start: 5 },
    ])
  })

  test('accepts shell-escaped spaces and unescapes them for lookup', () => {
    const [candidate] = findFileCandidates('open /tmp/My\\ Shots/Screenshot\\ 1.png now')
    expect(candidate?.full).toBe('/tmp/My\\ Shots/Screenshot\\ 1.png')
    expect(normalizeProjectPath(candidate?.path ?? '', cwd)).toBe('/tmp/My Shots/Screenshot 1.png')
    expect(fileUrl('/tmp/My Shots/Screenshot 1.png', cwd)).toBe(
      'file:///tmp/My%20Shots/Screenshot%201.png',
    )
  })

  test('ignores path-like text inside urls and words without slash or extension', () => {
    expect(findFileCandidates('https://example.com/a/b.ts plain README')).toEqual([])
    expect(findFileCandidates('.env and README.md').map((candidate) => candidate.path)).toEqual([
      '.env',
      'README.md',
    ])
  })
})

describe('markdown linkification', () => {
  const resolve = knownFiles('src/index.ts', 'README.md')

  test('links known bare paths and backticked paths, leaving unknown paths alone', () => {
    expect(
      linkifyMarkdown('Read src/index.ts, `README.md`, and docs/missing.md.', { cwd, resolve }),
    ).toBe(
      'Read [src/index.ts](file:///repo/src/index.ts), [`README.md`](file:///repo/README.md), and docs/missing.md.',
    )
  })

  test('preserves visible line suffixes in the label', () => {
    expect(linkifyMarkdown('src/index.ts:42', { cwd, resolve })).toBe(
      '[src/index.ts:42](file:///repo/src/index.ts)',
    )
  })

  test('protects fenced code, explicit links, and urls', () => {
    const source =
      '```\nsrc/index.ts\n```\n[src/index.ts](https://example.com/src/index.ts) <https://x.dev/README.md>'
    expect(linkifyMarkdown(source, { cwd, resolve })).toBe(source)
  })

  test('skips a candidate touching the end while streaming', () => {
    expect(linkifyMarkdown('see src/index.ts', { cwd, resolve, streaming: true })).toBe(
      'see src/index.ts',
    )
    expect(linkifyMarkdown('see src/index.ts now', { cwd, resolve, streaming: true })).toBe(
      'see [src/index.ts](file:///repo/src/index.ts) now',
    )
  })
})

describe('plain segmentation', () => {
  test('splits text into url, file, and text segments', () => {
    expect(segmentProse('go https://pi.dev and README.md!', knownFiles('README.md'), cwd)).toEqual([
      { kind: 'text', text: 'go ' },
      { kind: 'url', text: 'https://pi.dev', url: 'https://pi.dev' },
      { kind: 'text', text: ' and ' },
      { kind: 'file', text: 'README.md', url: 'file:///repo/README.md' },
      { kind: 'text', text: '!' },
    ])
  })
})

describe('project file index', () => {
  test('resolves asynchronously, caches misses, and publishes one revision per batch', async () => {
    let changes = 0
    const checked: string[] = []
    const index = new ProjectFileIndex({
      cwd: () => cwd,
      exists: (path) => {
        checked.push(path)
        return Promise.resolve(path.endsWith('README.md'))
      },
      onChange: () => {
        changes += 1
      },
      settleMs: 1,
    })
    const readme = findFileCandidates('README.md')[0]
    const missing = findFileCandidates('docs/none.md')[0]
    if (readme === undefined || missing === undefined) throw new Error('fixture')
    expect(index.resolve(readme)).toBeUndefined()
    expect(index.resolve(missing)).toBeUndefined()
    expect(index.resolve(readme)).toBeUndefined()
    await new Promise((done) => setTimeout(done, 20))
    expect(checked).toEqual(['/repo/README.md', '/repo/docs/none.md'])
    expect(index.resolve(readme)).toBe('README.md')
    expect(index.resolve(missing)).toBeUndefined()
    expect(index.revision).toBe(1)
    expect(changes).toBe(1)
    index.dispose()
  })

  test('normalizes absolute project paths and ./ prefixes', async () => {
    const index = new ProjectFileIndex({
      cwd: () => cwd,
      exists: () => Promise.resolve(true),
      onChange: () => {},
      settleMs: 1,
    })
    const candidate = findFileCandidates('/repo/src/index.ts')[0]
    if (candidate === undefined) throw new Error('fixture')
    index.resolve(candidate)
    await new Promise((done) => setTimeout(done, 10))
    expect(index.resolve(candidate)).toBe('src/index.ts')
    const relative = findFileCandidates('./src/index.ts')[0]
    if (relative === undefined) throw new Error('fixture')
    expect(index.resolve(relative)).toBe('src/index.ts')
    index.dispose()
  })
})
