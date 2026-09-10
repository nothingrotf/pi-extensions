import { setCapabilities, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
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

describe('Mermaid code blocks', () => {
  test('renders the complete IAM flowchart as Unicode art', () => {
    const source = [
      '```mermaid',
      'flowchart TD',
      'A["Fluxo IAM<br/>recuperação, verificação ou convite"]',
      'T["Transação PostgreSQL<br/>mudança IAM + intenção de e-mail"]',
      'O[("Outbox durável")]',
      'D["Worker de envio"]',
      'P["Cloudflare Email Sending"]',
      'R["Worker de reconciliação"]',
      'S[("Estado da entrega")]',
      'A -. "integração pendente" .-> T',
      'T --> O',
      'O --> D',
      'D --> P',
      'D --> S',
      'P -. "evidências via Analytics" .-> R',
      'R --> S',
      '```',
    ].join('\n')
    const lines = plain(renderProseMarkdown(source, 100))

    expect(lines).toContain('│  │ Fluxo IAM recuperação, │')
    expect(lines.slice(0, 4).map((line) => visibleWidth(line))).toEqual([29, 29, 29, 29])
    expect(lines).toContain('│               ▼integração pendente')
    expect(lines).toContain('│      │ Outbox durável │')
    expect(lines).toContain('│               ▼evidências via Analytics  │')
    expect(lines).toContain('│     │ Estado da entrega │◄───────────────┘')
    expect(lines).not.toContain('│ flowchart TD')
  })

  test('renders every documented flowchart direction', () => {
    for (const direction of ['TD', 'TB', 'BT', 'LR', 'RL']) {
      const source = `\`\`\`mermaid\nflowchart ${direction}\nA[Start] --> B[Done]\n\`\`\``
      expect(plain(renderProseMarkdown(source, 100))).not.toContain(`│ flowchart ${direction}`)
    }
  })

  test('renders sequence participants and messages', () => {
    const source = [
      '```mermaid',
      'sequenceDiagram',
      'participant A as Alice',
      'participant B as Bob',
      'A->>B: Hello',
      'B-->>A: World',
      '```',
    ].join('\n')

    expect(plain(renderProseMarkdown(source, 80))).toEqual([
      '│ ┌───────┐  ┌─────┐',
      '│ │ Alice │  │ Bob │',
      '│ └───┬───┘  └──┬──┘',
      '│     │         │',
      '│     │  Hello  │',
      '│     ├────────▶│',
      '│     │         │',
      '│     │  World  │',
      '│     │◄╌╌╌╌╌╌╌╌┤',
      '│     │         │',
      '│ ┌───┴───┐  ┌──┴──┐',
      '│ │ Alice │  │ Bob │',
      '│ └───────┘  └─────┘',
    ])
  })

  test('falls back to original code for unsupported syntax and narrow widths', () => {
    expect(plain(renderProseMarkdown('```mermaid\npie\n"A" : 1\n```', 80))).toEqual([
      '│ pie',
      '│ "A" : 1',
    ])
    expect(
      plain(renderProseMarkdown('```mermaid\nflowchart TD\nA --> B\ngarbage???\n```', 80)),
    ).toEqual(['│ flowchart TD', '│ A --> B', '│ garbage???'])
    expect(
      plain(
        renderProseMarkdown(
          '```mermaid\nflowchart LR\nA[An exceptionally wide starting node] --> B[Done]\n```',
          24,
        ),
      )[0],
    ).toBe('│ flowchart LR')
  })

  test('falls back when parallel routing or label placement loses content', () => {
    const parallel = '```mermaid\nflowchart TD\nA -->|yes| B\nA -->|no| B\n```'
    const collision = [
      '```mermaid',
      'flowchart TD',
      'A --> B',
      'C --> D',
      'A -->|long collision label| D',
      'C -->|other label| B',
      '```',
    ].join('\n')

    expect(plain(renderProseMarkdown(parallel, 100))).toEqual([
      '│ flowchart TD',
      '│ A -->|yes| B',
      '│ A -->|no| B',
    ])
    expect(plain(renderProseMarkdown(collision, 100))).toContain('│ C -->|other label| B')
  })

  test('falls back for grapheme widths that differ from Pi', () => {
    const thai = '```mermaid\nflowchart TD\nA["กำ"] --> B[Done]\n```'
    const indic = '```mermaid\nflowchart TD\nA["कर्म"] --> B[Done]\n```'

    expect(plain(renderProseMarkdown(thai, 100))[0]).toBe('│ flowchart TD')
    expect(plain(renderProseMarkdown(indic, 100))[0]).toBe('│ flowchart TD')
  })

  test('does not render a synthetically closed streaming fence', () => {
    const options = {
      cwd: () => '/repo',
      resolve: () => undefined,
      revision: () => 0,
      streaming: () => true,
    }
    const incomplete = new ProseMarkdown('```mermaid\nflowchart LR\nA --> B', options)
    const complete = new ProseMarkdown('```mermaid\nflowchart LR\nA --> B\n```', options)

    expect(plain(incomplete.render(80))).toEqual(['│ flowchart LR', '│ A --> B'])
    expect(plain(complete.render(80))).not.toContain('│ flowchart LR')
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
