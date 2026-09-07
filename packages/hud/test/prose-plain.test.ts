import { setCapabilities, stripTerminalSequences } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { ansiForeground, hudInfo, hudTextPrimary } from '../src/colors.ts'
import type { FileCandidate } from '../src/prose-links.ts'
import { renderProsePlain } from '../src/prose-plain.ts'

const resolve = (candidate: FileCandidate) =>
  candidate.path === 'README.md' ? candidate.path : undefined

afterEach(() => {
  setCapabilities({ hyperlinks: true, images: null, trueColor: true })
})

describe('plain prose', () => {
  test('keeps markdown punctuation literal', () => {
    const lines = renderProsePlain(
      '# Title **bold** `code` [x](https://a.dev)',
      80,
      resolve,
      '/repo',
    )
    expect(lines.map((line) => stripTerminalSequences(line))).toEqual([
      '# Title **bold** `code` [x](https://a.dev)',
    ])
    expect(lines[0]).toContain(`${ansiForeground(hudTextPrimary)}# Title **bold** \`code\` [x](`)
  })

  test('underlines urls and known files as anchors', () => {
    setCapabilities({ hyperlinks: true, images: null, trueColor: true })
    const [line] = renderProsePlain('see README.md and https://pi.dev.', 80, resolve, '/repo')
    expect(line).toContain(
      `\x1b]8;;file:///repo/README.md\x1b\\\x1b[4m${ansiForeground(hudInfo)}README.md\x1b[0m\x1b]8;;\x1b\\`,
    )
    expect(line).toContain(
      `\x1b]8;;https://pi.dev\x1b\\\x1b[4m${ansiForeground(hudInfo)}https://pi.dev`,
    )
    expect(stripTerminalSequences(line ?? '')).toBe('see README.md and https://pi.dev.')
  })

  test('wraps long lines and trims blank edges', () => {
    expect(
      renderProsePlain('\nalpha beta gamma\n\n\n', 11, resolve, '/repo').map((line) =>
        stripTerminalSequences(line),
      ),
    ).toEqual(['alpha beta', 'gamma'])
    expect(
      renderProsePlain('one\n\ntwo', 11, resolve, '/repo').map((line) =>
        stripTerminalSequences(line),
      ),
    ).toEqual(['one', '', 'two'])
  })
})
