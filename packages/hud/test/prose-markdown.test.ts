import { readFile } from 'node:fs/promises'

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

  test('renders quoted pipe labels without treating their quotes as content', () => {
    for (const edge of ['-->', '-.->', '==>']) {
      const source = `\`\`\`mermaid\nflowchart TD\nA ${edge}|"Resposta"| B\n\`\`\``
      const lines = plain(renderProseMarkdown(source, 80))

      expect(lines).not.toContain('│ flowchart TD')
      expect(lines.some((line) => line.includes('Resposta'))).toBe(true)
      expect(lines.every((line) => visibleWidth(line) <= 80)).toBe(true)
    }
  })

  test('compacts a quoted edge label when Unicode art truncates it', () => {
    const source = [
      '```mermaid',
      'flowchart TD',
      'A -->|"Credencial ou créditos inválidos"| B',
      '```',
    ].join('\n')
    const lines = plain(renderProseMarkdown(source, 100))

    expect(lines[0]).toBe('│ Flowchart')
    expect(lines.join(' ')).toContain('Credencial ou créditos inválidos')
  })

  test('compacts the full captured flowchart without losing labels or relations', async () => {
    const source = await readFile(
      new URL('./fixtures/hud-capture-flow.mmd', import.meta.url),
      'utf8',
    )
    const lines = plain(renderProseMarkdown(`\`\`\`mermaid\n${source}\`\`\``, 120))
    const output = lines
      .map((line) => line.replace(/^│ ?/u, ''))
      .join(' ')
      .replaceAll(/\s+/gu, ' ')
    const nodeLabels = [...source.matchAll(/(?:\[|\{)"([^"]+)"/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )
    const edgeLabels = [...source.matchAll(/\|"([^"]+)"\|/gu)].flatMap((match) =>
      match[1] === undefined ? [] : [match[1]],
    )
    const edgeCount = source.split('\n').filter((line) => line.includes('-->')).length
    const connections = lines.indexOf('│ Connections')

    expect(lines[0]).toBe('│ Flowchart')
    expect(connections).toBeGreaterThan(-1)
    for (const label of nodeLabels) {
      expect(output).toContain(label.replaceAll(/<br\s*\/?\s*>/giu, ' '))
    }
    for (const label of edgeLabels) expect(output).toContain(label)
    expect(lines.slice(connections + 1)).toHaveLength(edgeCount)
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
  })

  test('renders every documented flowchart direction', () => {
    for (const direction of ['TD', 'TB', 'BT', 'LR', 'RL']) {
      const source = `\`\`\`mermaid\nflowchart ${direction}\nA[Start] --> B[Done]\n\`\`\``
      expect(plain(renderProseMarkdown(source, 100))).not.toContain(`│ flowchart ${direction}`)
    }
  })

  test('renders chained edges with visual class directives', () => {
    const source = [
      '```mermaid',
      'flowchart TD',
      'A[One]',
      'B[Two]',
      'C[Three]',
      'A --> B --> C',
      'classDef support fill:#f1f5f9,stroke:#64748b,stroke-dasharray:5 5,color:#334155',
      'class B support',
      '```',
    ].join('\n')
    const lines = plain(renderProseMarkdown(source, 80))

    expect(lines).not.toContain('│ flowchart TD')
    expect(lines.some((line) => line.includes('│ One │'))).toBe(true)
    expect(lines.some((line) => line.includes('│ Two │'))).toBe(true)
    expect(lines.some((line) => line.includes('│ Three │'))).toBe(true)
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

  test('falls back to original code for unsupported syntax', () => {
    expect(plain(renderProseMarkdown('```mermaid\npie\n"A" : 1\n```', 80))).toEqual([
      '│ pie',
      '│ "A" : 1',
    ])
    expect(
      plain(renderProseMarkdown('```mermaid\nflowchart TD\nA --> B\ngarbage???\n```', 80)),
    ).toEqual(['│ flowchart TD', '│ A --> B', '│ garbage???'])
  })

  test('compacts narrow parallel edges with quoted labels', () => {
    const source = [
      '```mermaid',
      'flowchart TD',
      'A[First named node] -->|"first quoted relation"| B[Second named node]',
      'A -->|"second quoted relation"| B',
      '```',
    ].join('\n')
    const lines = plain(renderProseMarkdown(source, 24))
    const output = lines
      .map((line) => line.replace(/^│ ?/u, ''))
      .join(' ')
      .replaceAll(/\s+/gu, ' ')

    expect(lines[0]).toBe('│ Flowchart')
    expect(output).toContain('First named node')
    expect(output).toContain('Second named node')
    expect(output).toContain('first quoted relation')
    expect(output).toContain('second quoted relation')
    expect(lines.every((line) => visibleWidth(line) <= 24)).toBe(true)
  })

  test('compacts inline edge labels without turning them into nodes', () => {
    for (const [edge, operator] of [
      ['-- yes -->', '-->'],
      ['== yes ==>', '==>'],
      ['-. yes .->', '.->'],
    ]) {
      const source = [
        '```mermaid',
        'flowchart TD',
        `A[First node deliberately made wide] ${edge} B[Second node deliberately made wide]`,
        '```',
      ].join('\n')
      const lines = plain(renderProseMarkdown(source, 24))
      const output = lines
        .map((line) => line.replace(/^│ ?/u, ''))
        .join(' ')
        .replaceAll(/\s+/gu, ' ')

      expect(lines[0]).toBe('│ Flowchart')
      expect(lines).not.toContain('│ 2. yes')
      expect(output).toContain(`1 ${operator} 2 · yes`)
    }
  })

  test('compacts unspaced Mermaid links without phantom node IDs', () => {
    for (const operator of ['---', '-.->', '-->']) {
      const source = [
        '```mermaid',
        'flowchart TD',
        `A[First node deliberately made wide]${operator}B[Second node deliberately made wide]`,
        '```',
      ].join('\n')
      const lines = plain(renderProseMarkdown(source, 24))
      const output = lines
        .map((line) => line.replace(/^│ ?/u, ''))
        .join(' ')
        .replaceAll(/\s+/gu, ' ')

      expect(lines[0]).toBe('│ Flowchart')
      expect(output).toContain(`1 ${operator} 2`)
    }
  })

  test('falls back rather than compacting malformed links or directives', () => {
    for (const source of [
      'A[First node deliberately made wide] - B[Second node deliberately made wide]',
      'A[First node deliberately made wide] ><-- B[Second node deliberately made wide]',
      'A[First node deliberately made wide] --> B[Second node deliberately made wide]\nend',
    ]) {
      const markdown = `\`\`\`mermaid\nflowchart TD\n${source}\n\`\`\``

      expect(plain(renderProseMarkdown(markdown, 24))[0]).toBe('│ flowchart TD')
    }
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
