import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { renderGoalHudLines, type GoalOverlayTheme } from '../src/overlay.ts'
import type { GoalModeState } from '../src/state.ts'

const theme: GoalOverlayTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
}

function state(overrides: Partial<GoalModeState['goal']> = {}): GoalModeState {
  return {
    enabled: true,
    mode: 'active',
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
  test('renders the Empryo goal strip geometry', () => {
    const lines = renderGoalHudLines(state(), theme, 120)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^    ╭─ ⟲ goal · active ▾ .*1\.2k\/5k tokens · 1m 05s ─╮$/)
    expect(lines[1]).toContain('Ship the editor dock')
    expect(lines[2]).toContain('continuing toward the objective')
    expect(lines[2]).toContain('/goal drop')
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
  })

  test('renders paused and budget-limited states truthfully', () => {
    const paused = state({ status: 'paused' })
    paused.enabled = false
    expect(renderGoalHudLines(paused, theme, 80).join('\n')).toContain('paused · /goal resume')
    expect(renderGoalHudLines(state({ status: 'budget-limited' }), theme, 80).join('\n')).toContain(
      'token budget reached',
    )
  })

  test('sanitizes and truncates the objective', () => {
    const lines = renderGoalHudLines(
      state({ objective: `Ship\u001B[31m the\u202E\u200B\n${'wide '.repeat(40)}` }),
      theme,
      56,
    )
    expect(lines.join('\n')).not.toContain('\u001B[31m')
    expect(lines.join('\n')).not.toContain('\u202E')
    expect(lines.join('\n')).not.toContain('\u200B')
    expect(lines.every((line) => visibleWidth(line) <= 56)).toBe(true)
  })

  test('renders nothing without a goal', () => {
    expect(renderGoalHudLines(undefined, theme, 120)).toEqual([])
  })

  test('uses the responsive dock insets', () => {
    for (const item of [
      { inset: 1, width: 55 },
      { inset: 2, width: 56 },
      { inset: 2, width: 79 },
      { inset: 3, width: 80 },
      { inset: 3, width: 109 },
      { inset: 4, width: 110 },
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
