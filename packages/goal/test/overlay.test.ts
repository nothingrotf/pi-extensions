import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { renderGoalHudLines, type GoalOverlayTheme } from '../src/overlay.ts'
import { createGoalLoop, type GoalModeState } from '../src/state.ts'

const theme: GoalOverlayTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
}

function state(overrides: Partial<GoalModeState['goal']> = {}): GoalModeState {
  return {
    enabled: true,
    mode: 'active',
    loop: createGoalLoop(),
    goal: {
      createdAt: 1,
      id: 'goal-1',
      objective: 'Ship the editor dock',
      status: 'active',
      timeUsedSeconds: 65,
      tokenBudget: 5_000,
      tokensUsed: 1_200,
      updatedAt: 2,
      ...overrides,
    },
  }
}

describe('goal editor panel', () => {
  test('renders the goal strip geometry', () => {
    const lines = renderGoalHudLines(state(), theme, 120)
    expect(lines).toHaveLength(4)
    expect(lines.at(-1)).toBe('')
    expect(lines[0]).toMatch(/^   ⟲ goal · coding 1\/5 ▾ +1\.2k\/5k tokens · 1m 05s$/)
    expect(lines[1]).toBe('   Ship the editor dock')
    expect(lines[2]).toContain('working toward reviewer PASS')
    expect(lines[2]).toContain('/goal drop')
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
  })

  test('renders paused and budget-limited states truthfully', () => {
    const paused = state({ status: 'paused' })
    paused.enabled = false
    expect(renderGoalHudLines(paused, theme, 80).join('\n')).toContain('paused · /goal resume')
    const limited = state({ status: 'budget-limited' })
    limited.loop.phase = 'reviewing'
    expect(renderGoalHudLines(limited, theme, 80).join('\n')).toContain('fresh independent review')
    const stuck = state({ status: 'stuck' })
    stuck.enabled = false
    stuck.loop.stopReason = 'Iteration cap reached.'
    expect(renderGoalHudLines(stuck, theme, 80).join('\n')).toContain('Iteration cap reached.')
  })

  test('sanitizes and wraps the complete objective', () => {
    const lines = renderGoalHudLines(
      state({ objective: `Ship\u001B[31m the\u202E\u200B\n${'wide '.repeat(40)}` }),
      theme,
      56,
    )
    expect(
      lines
        .slice(1, -2)
        .map((line) => line.trim())
        .join(' '),
    ).toBe(`Ship the ${'wide '.repeat(40).trim()}`)
    expect(lines.slice(1, -2).join('\n')).not.toContain('…')
    expect(lines.join('\n')).not.toContain('\u001B[31m')
    expect(lines.join('\n')).not.toContain('\u202E')
    expect(lines.join('\n')).not.toContain('\u200B')
    expect(lines.every((line) => visibleWidth(line) <= 56)).toBe(true)
  })

  test.each([40, 55, 56, 79, 80, 109, 110, 120])(
    'wraps long objectives without moving the header or footer at width %i',
    (width) => {
      const objective = 'Keep the complete objective visible while working toward reviewer PASS. '
        .repeat(5)
        .trim()
      const lines = renderGoalHudLines(state({ objective }), theme, width)
      const shortLines = renderGoalHudLines(state(), theme, width)
      const body = lines.slice(1, -2)
      expect(body.length).toBeGreaterThan(1)
      expect(body.map((line) => line.trim()).join(' ')).toBe(objective)
      expect(body.every((line) => line.startsWith('   '))).toBe(true)
      expect(body.join('\n')).not.toContain('…')
      expect(lines[0]).toBe(shortLines[0])
      expect(lines.slice(-2)).toEqual(shortLines.slice(-2))
      expect(lines.every((line) => visibleWidth(line) <= width - 3)).toBe(true)
    },
  )

  test('preserves wide Unicode and combining characters across responsive widths', () => {
    const objective = '界語🚀e\u0301👍🏽'.repeat(30)
    for (let width = 8; width <= 140; width += 1) {
      const lines = renderGoalHudLines(state({ objective }), theme, width)
      const body = lines.slice(1, -2)
      expect(body.map((line) => line.slice(3)).join('')).toBe(objective)
      expect(body.every((line) => line.startsWith('   '))).toBe(true)
      expect(body.join('\n')).not.toContain('…')
      expect(lines.every((line) => visibleWidth(line) <= width - 3)).toBe(true)
    }
  })

  test('respects widths too narrow to display every Unicode glyph', () => {
    for (let width = 0; width < 8; width += 1) {
      const lines = renderGoalHudLines(state({ objective: '界🚀e\u0301'.repeat(10) }), theme, width)
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true)
      expect(lines.slice(1, -2).join('\n')).not.toContain('…')
    }
    expect(renderGoalHudLines(state(), theme, 0)).toEqual([])
  })

  test('keeps the muted color on every wrapped objective row', () => {
    const coloredTheme: GoalOverlayTheme = {
      ...theme,
      fg: (color, text) => (color === 'muted' ? `\u001B[90m${text}\u001B[39m` : text),
    }
    const objective = 'Keep all of this objective visible in its original muted color. '
      .repeat(4)
      .trim()
    const body = renderGoalHudLines(state({ objective }), coloredTheme, 56).slice(1, -2)
    expect(body.length).toBeGreaterThan(1)
    expect(body.every((line) => line.startsWith('   \u001B[90m'))).toBe(true)
    expect(body.every((line) => line.endsWith('\u001B[39m'))).toBe(true)
    expect(body.map((line) => stripTerminalSequences(line).trim()).join(' ')).toBe(objective)
    expect(body.every((line) => visibleWidth(line) <= 53)).toBe(true)
  })

  test('renders nothing without a goal', () => {
    expect(renderGoalHudLines(undefined, theme, 120)).toEqual([])
  })

  test('aligns widgets with the three-space text inset', () => {
    for (const item of [
      { inset: 3, width: 55 },
      { inset: 3, width: 56 },
      { inset: 3, width: 79 },
      { inset: 3, width: 80 },
      { inset: 3, width: 109 },
      { inset: 3, width: 110 },
    ]) {
      expect(renderGoalHudLines(state(), theme, item.width)[0]?.match(/^ */)?.[0].length).toBe(
        item.inset,
      )
    }
  })

  test('fits every responsive width', () => {
    for (let width = 8; width <= 140; width += 1) {
      expect(
        renderGoalHudLines(state(), theme, width).every((line) => visibleWidth(line) <= width),
      ).toBe(true)
    }
  })
})
