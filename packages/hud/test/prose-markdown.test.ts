import { setCapabilities, stripTerminalSequences } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { ansiForeground, hudBrand, hudBrandAlt, hudTextDim, hudTextPrimary } from '../src/colors.ts'
import { type FileCandidate } from '../src/prose-links.ts'
import { ProseMarkdown, renderProseMarkdown } from '../src/prose-markdown.ts'
import { stabilizeMarkdown } from '../src/prose-stream.ts'

const osc8 = (url: string) => `\x1b]8;;${url}\x1b\\`
const osc8End = '\x1b]8;;\x1b\\'

function plain(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd())
}

afterEach(() => {
  setCapabilities({ hyperlinks: true, images: null, trueColor: true })
})

describe('prose markdown links', () => {
  test('shows the destination beside a named link and keeps both clickable', () => {
    setCapabilities({ hyperlinks: true, images: null, trueColor: true })
    const [line] = renderProseMarkdown('See [Docs](https://example.com/docs).', 80)
    expect(plain([line ?? ''])).toEqual(['See Docs (https://example.com/docs).'])
    expect(line).toContain(
      `${osc8('https://example.com/docs')}${ansiForeground(hudBrandAlt)}Docs\x1b[0m${osc8End}`,
    )
    expect(line).toContain(
      `${osc8('https://example.com/docs')}${ansiForeground(hudTextDim)} (https://example.com/docs)\x1b[0m${osc8End}`,
    )
  })

  test('keeps the destination visible without terminal hyperlinks', () => {
    setCapabilities({ hyperlinks: false, images: null, trueColor: true })
    const lines = renderProseMarkdown('See [Docs](https://example.com/docs).', 80)
    expect(plain(lines)).toEqual(['See Docs (https://example.com/docs).'])
    expect(lines[0]).not.toContain('\x1b]8;;')
  })

  test('does not repeat autolinks or file destinations', () => {
    expect(
      plain(renderProseMarkdown('https://pi.dev and [src/a.ts](file:///repo/src/a.ts)', 80)),
    ).toEqual(['https://pi.dev and src/a.ts'])
  })

  test('keeps link color inside nested strong text', () => {
    const [line] = renderProseMarkdown('[**Docs**](https://example.com)', 80)
    expect(line).toContain(`\x1b[1m${ansiForeground(hudBrandAlt)}Docs\x1b[0m`)
    expect(line).not.toContain(`${ansiForeground(hudBrandAlt)}${ansiForeground(hudTextPrimary)}`)
  })
})

describe('prose markdown blocks', () => {
  test('conceals heading markers and separates heading levels', () => {
    const lines = renderProseMarkdown('# One\n\n### Three', 40)
    expect(plain(lines)).toEqual(['One', '', 'Three'])
    expect(lines[0]).toContain(`\x1b[1m${ansiForeground(hudTextPrimary)}One`)
    expect(lines[2]).not.toContain(ansiForeground(hudTextPrimary))
  })

  test('draws code blocks with a brand border instead of fences', () => {
    const lines = renderProseMarkdown('```ts\nconst a = 1\n\nconst b = 2\n```', 40, (code) =>
      code.split('\n').map((line) => `<${line}>`),
    )
    expect(plain(lines)).toEqual(['│ <const a = 1>', '│ <>', '│ <const b = 2>'])
    expect(lines[0]).toContain(`${ansiForeground(hudBrand)}│ `)
  })

  test('renders list markers, task states, and nested lists', () => {
    const lines = renderProseMarkdown('1. first\n2. second\n   - [x] done\n   - [ ] open', 40)
    expect(plain(lines)).toEqual(['1. first', '2. second', '   - [x] done', '   - [ ] open'])
  })

  test('renders rounded tables with a header rule only', () => {
    expect(
      plain(renderProseMarkdown('| Name | Role |\n| --- | --- |\n| Ana | Dev |\n| Bo | Ops |', 40)),
    ).toEqual([
      '╭──────┬──────╮',
      '│ Name │ Role │',
      '├──────┼──────┤',
      '│ Ana  │ Dev  │',
      '│ Bo   │ Ops  │',
      '╰──────┴──────╯',
    ])
  })

  test('renders quotes, rules, and inline code', () => {
    const lines = renderProseMarkdown('> quoted `code`\n\n---', 20)
    expect(plain(lines)).toEqual(['│ quoted code', '', '────────────────────'])
    expect(lines[0]).toContain(`${ansiForeground(hudBrand)}code`)
  })

  test('wraps paragraphs to the available width', () => {
    expect(plain(renderProseMarkdown('alpha beta gamma delta', 11))).toEqual([
      'alpha beta',
      'gamma delta',
    ])
  })
})

describe('streaming stabilization', () => {
  test('closes open fences and balances inline markers', () => {
    expect(stabilizeMarkdown('```ts\nconst a')).toBe('```ts\nconst a\n```')
    expect(stabilizeMarkdown('some **bold')).toBe('some **bold**')
    expect(stabilizeMarkdown('some `code')).toBe('some `code`')
    expect(stabilizeMarkdown('see [Docs](https://x')).toBe('see [Docs](https://x)')
  })

  test('drops incomplete trailing markers', () => {
    expect(stabilizeMarkdown('text\n##')).toBe('text\n')
    expect(stabilizeMarkdown('text\n``')).toBe('text\n')
    expect(stabilizeMarkdown('word *')).toBe('word ')
  })
})

describe('prose markdown component', () => {
  test('re-renders when the file index revision or streaming state changes', () => {
    let revision = 0
    let streaming = true
    const resolve = (candidate: FileCandidate) =>
      revision > 0 && candidate.path === 'src/a.ts' ? candidate.path : undefined
    const component = new ProseMarkdown('open src/a.ts today', {
      cwd: () => '/repo',
      resolve,
      revision: () => revision,
      streaming: () => streaming,
    })
    expect(component.render(40)[0]).not.toContain('file:///repo/src/a.ts')
    revision = 1
    streaming = false
    expect(component.render(40)[0]).toContain(`${osc8('file:///repo/src/a.ts')}`)
    expect(plain(component.render(40))).toEqual(['open src/a.ts today'])
  })
})
