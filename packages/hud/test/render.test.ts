import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { emptyGitStatus } from '../src/git.ts'
import {
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
    modelLabel: 'Opus 4.8',
    effortLabel: 'High',
    effortLevel: 'high',
    contextLabel: '42%/1.0M',
    contextPercent: 42,
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
  test('paints the effort label with the thinking level color', () => {
    const tagged: HudTheme = {
      fg: (token, text) => `<${token}>${text}</${token}>`,
    }
    const value = state({ effortLevel: 'max', effortLabel: 'Max', usage: null })
    const [line = ''] = renderHud(tagged, value, new Map(), 400)

    expect(line).toContain('<thinkingMax>(Max)</thinkingMax>')
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

    expect(line).toContain('…/projects/pi-extensions · feature/hud [+1 !2]')
    expect(line).toContain(' · anthropic/Opus 4.8 (High)')
    expect(line).toContain(' · 🎯 goal: shipping')
    expect(line).toContain('5h 3% 3h37m   wk 92% 1d19h · 42%/1.0M')
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

  test('omits separators for absent optional data', () => {
    const [line = ''] = renderHud(
      theme,
      state({ providerLabel: '', modelLabel: 'no-model', usage: null }),
      new Map(),
      120,
    )
    expect(line).toContain('…/projects/pi-extensions')
    expect(line).toContain('42%/1.0M')
    expect(line).not.toContain(' ·  · ')
  })
})
