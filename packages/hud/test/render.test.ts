import { stripVTControlCharacters } from 'node:util'

import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { emptyGitStatus } from '../src/git.ts'
import {
  branchSegment,
  effortColor,
  goalStatusKey,
  renderHud,
  type HudState,
  type HudTheme,
} from '../src/render.ts'

const theme: HudTheme = {
  fg: (_color, text) => text,
}

function state(overrides: Partial<HudState> = {}): HudState {
  return {
    cwd: '/Users/dev/projects/pi-extensions',
    git: emptyGitStatus(),
    providerLabel: 'anthropic',
    modelLabel: 'claude-opus-4-8',
    effortLabel: 'high',
    effortLevel: 'high',
    contextLabel: '42%/1.0M',
    contextPercent: 42,
    cacheLabel: '⛁ 80% cached',
    usage: {
      provider: 'Claude',
      fetchedAt: 0,
      windows: [
        { label: '5h', usedPercent: 3, resetsIn: '3h37m' },
        { label: 'wk', usedPercent: 92, resetsIn: '1d19h' },
      ],
    },
    ...overrides,
  }
}

describe('effortColor', () => {
  test('maps each thinking level to its editor border color', () => {
    expect(effortColor('minimal')).toBe('thinkingMinimal')
    expect(effortColor('low')).toBe('thinkingLow')
    expect(effortColor('medium')).toBe('thinkingMedium')
    expect(effortColor('high')).toBe('thinkingHigh')
    expect(effortColor('xhigh')).toBe('thinkingXhigh')
    expect(effortColor('max')).toBe('thinkingMax')
  })

  test('falls back to the off color for unknown levels', () => {
    expect(effortColor('')).toBe('thinkingOff')
    expect(effortColor('off')).toBe('thinkingOff')
    expect(effortColor('weird')).toBe('thinkingOff')
  })

  test('ignores case and surrounding whitespace', () => {
    expect(effortColor(' MAX ')).toBe('thinkingMax')
  })
})

describe('compact HUD', () => {
  test('renders the branch glyph and dirty marker in one color', () => {
    const git = {
      ...emptyGitStatus(),
      branch: 'main',
      modified: 63,
      untracked: 27,
      dirty: true,
    }
    expect(branchSegment(theme, git)).toBe('⎇ main*')
    expect(branchSegment({ fg: (token, text) => `<${token}>${text}</${token}>` }, git)).toBe(
      '<warning>⎇ main*</warning>',
    )
  })

  test('omits other tools and places fast mode after effort', () => {
    const statuses = new Map([
      ['fast-mode', 'Fast requested'],
      ['pi-goal', 'goal: shipping'],
      ['pi-loop', 'loop: active'],
      ['other', '\x1b[31mReview\nready\x1b[0m'],
    ])
    const [line = ''] = renderHud(theme, state(), statuses, 220)
    expect(line).toContain('🎯 goal: shipping · ↻ loop: active')
    expect(line).not.toContain('Review ready')
    expect(line).toContain('claude-opus-4-8:high [fast]')
    expect(line.trimEnd()).toMatch(/42%\/1\.0M · ⛁ 80% cached · 5h 3% 3h37m · wk 92% 1d19h$/u)
    expect(line.match(/fast/gu)).toHaveLength(1)
    expect(line).not.toContain('\x1b')
  })

  test('keeps model left and context cache right without MCP statuses', () => {
    const value = state({
      providerLabel: 'openai-codex',
      modelLabel: 'gpt-6-astra',
      effortLabel: 'xhigh',
      effortLevel: 'xhigh',
      usage: null,
    })
    for (const fast of [false, true]) {
      const statuses = new Map([['mcp', 'MCPs: figma linear']])
      if (fast) statuses.set('fast-mode', 'Fast requested')
      const [line = ''] = renderHud(theme, value, statuses, 100)
      expect(line).toContain(`gpt-6-astra:xhigh${fast ? ' [fast]' : ''}`)
      expect(line.trimEnd()).toMatch(/42%\/1\.0M · ⛁ 80% cached$/u)
      expect(line).not.toContain('MCPs')
      expect(line).not.toContain('openai-codex')
    }
  })

  test('hides unavailable fast mode and preserves error diagnostics', () => {
    const [unavailable = ''] = renderHud(
      theme,
      state(),
      new Map([['fast-mode', 'Fast unavailable']]),
      180,
    )
    expect(unavailable).not.toContain('Fast unavailable')
    expect(unavailable).toContain('claude-opus-4-8:high')

    const [error = ''] = renderHud(
      theme,
      state(),
      new Map([['fast-mode', 'Fast state error']]),
      180,
    )
    expect(error).toContain('claude-opus-4-8:high Fast state error')

    const [disabled = ''] = renderHud(
      theme,
      state({ cacheLabel: '', effortLabel: '' }),
      new Map(),
      180,
    )
    expect(disabled).not.toContain('Fast')
    expect(disabled).not.toContain('cached')
    expect(disabled).toContain('claude-opus-4-8')
    expect(disabled.trimEnd()).toMatch(/42%\/1\.0M · 5h 3% 3h37m · wk 92% 1d19h$/u)
  })

  test('uses the assigned colors for footer identity segments', () => {
    const tagged: HudTheme = {
      fg: (token, text) => `<${token}>${text}</${token}>`,
    }
    const value = state({
      git: { ...emptyGitStatus(), branch: 'main', dirty: true, modified: 1 },
      effortLevel: 'max',
      effortLabel: 'max',
      usage: null,
    })
    const [line = ''] = renderHud(tagged, value, new Map([['fast-mode', 'Fast requested']]), 400)

    expect(line).toContain('<accent>pi-extensions</accent>')
    expect(line).toContain('<muted> · </muted>')
    expect(line).toContain('<warning>⎇ main*</warning>')
    expect(line).toContain('<text>claude-opus-4-8</text><text>:max</text> <text>[fast]</text>')
    expect(line).toContain('<success>42%/1.0M</success><muted> · </muted><dim>⛁ 80% cached</dim>')
  })

  test('draws the compact layout in one physical row', () => {
    const value = state({
      git: {
        ...emptyGitStatus(),
        branch: 'feature/hud',
        dirty: true,
        modified: 2,
        staged: 1,
      },
    })
    const [line = ''] = renderHud(theme, value, new Map([[goalStatusKey, 'goal: shipping']]), 200)

    expect(line).toContain(
      'pi-extensions · ⎇ feature/hud* · claude-opus-4-8:high · 🎯 goal: shipping',
    )
    expect(line.trimEnd()).toMatch(/5h 3% 3h37m · wk 92% 1d19h$/u)
    expect(line).toContain(' · ')
    expect(visibleWidth(line)).toBe(200)
    expect(line).not.toContain('ctx ')
    expect(line).not.toContain('\n')
  })

  test('never exceeds the terminal width', () => {
    const value = state({
      git: {
        ...emptyGitStatus(),
        branch: 'feature/a-very-long-branch-name',
        dirty: true,
        untracked: 20,
        ahead: 4,
      },
    })
    for (let width = 0; width <= 200; width += 1) {
      const rows = renderHud(theme, value, new Map(), width)
      expect(rows).toHaveLength(1)
      expect(visibleWidth(rows[0] ?? '')).toBeLessThanOrEqual(width)
    }
  })

  test('removes terminal controls and physical line breaks', () => {
    const value = state({
      cwd: '/tmp/a\nb\x1b]0;workspace\x07',
      contextLabel: '42%\n/1M',
      git: { ...emptyGitStatus(), branch: 'main\x1b[2J' },
    })
    const [line = ''] = renderHud(
      theme,
      value,
      new Map([[goalStatusKey, '\x1b]0;title\x07goal\nactive']]),
      160,
    )
    expect(line).toContain('goal active')
    expect(line).not.toContain('\x1b[2J')
    expect(line).not.toContain('\x1b]0;')
    expect(line).not.toContain('workspace')
    expect(line).not.toContain('\n')
    expect(line).not.toContain('\r')
  })

  test('omits empty styled groups without leaving phantom separators', () => {
    const ansiTheme: HudTheme = { fg: (_token, text) => `\x1b[31m${text}\x1b[39m` }
    const value = state({ cacheLabel: '', usage: null, effortLabel: '' })
    const [line = ''] = renderHud(ansiTheme, value, new Map(), 100)
    expect(stripVTControlCharacters(line)).toMatch(
      /^ pi-extensions · claude-opus-4-8 +42%\/1\.0M $/u,
    )
    expect(visibleWidth(line)).toBe(100)
  })

  test('omits separators for absent optional data', () => {
    const [line = ''] = renderHud(
      theme,
      state({ providerLabel: '', modelLabel: 'no-model', usage: null }),
      new Map(),
      120,
    )
    expect(line.trim()).toMatch(/^pi-extensions +42%\/1\.0M · ⛁ 80% cached$/u)
  })
})
