import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { GoalActivityTracker } from '../src/activity.ts'
import { renderGoalHudLines } from '../src/overlay.ts'
import { createGoalLoop, type GoalModeState } from '../src/state.ts'

const theme = {
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  fg: (_color: string, text: string) => text,
}

function state(): GoalModeState {
  return {
    enabled: true,
    mode: 'active',
    loop: { ...createGoalLoop(), phase: 'reviewing' },
    goal: {
      id: 'goal',
      objective: 'Verify the complete objective',
      status: 'active',
      tokensUsed: 10,
      timeUsedSeconds: 2,
      createdAt: 0,
      updatedAt: 0,
    },
  }
}

describe('goal live activity', () => {
  test('bounds check storage and releases review details on transition', () => {
    let now = 0
    const tracker = new GoalActivityTracker(
      () => {},
      () => now,
    )
    tracker.transition('goal', 'checks', 'Checking')
    for (let index = 0; index < 1000; index += 1) {
      tracker.progress({
        type: 'check-start',
        kind: 'test',
        label: 'Tests',
        command: 'bun run test',
      })
      tracker.progress({
        type: 'check-end',
        check: {
          kind: 'test',
          label: 'Tests',
          status: 'passed',
          durationMs: 1,
          output: 'private output',
        },
      })
    }
    expect(tracker.get()?.checks).toHaveLength(1)
    expect(JSON.stringify(tracker.get())).not.toContain('private output')
    tracker.progress({
      type: 'reviewer',
      phase: 'reviewing',
      model: 'local/reviewer',
      tool: 'read',
      tokens: 50,
    })
    now = 500
    tracker.progress({ type: 'reviewer', phase: 'reviewing', tokens: 60 })
    expect(tracker.get()?.tool).toBeUndefined()
    expect(tracker.get()?.startedAt).toBe(0)
    tracker.transition('goal', 'waiting', 'Continuing')
    expect(tracker.get()?.model).toBeUndefined()
    expect(tracker.get()?.tokens).toBe(0)
    tracker.transition('other', 'coding', 'New goal')
    expect(tracker.get()?.checks).toEqual([])
    tracker.clear()
    expect(tracker.get()).toBeUndefined()
  })

  test('renders elapsed activity without claiming inferred progress or completion', () => {
    const tracker = new GoalActivityTracker(
      () => {},
      () => 0,
    )
    tracker.transition('goal', 'checks', 'Checking')
    tracker.progress({ type: 'check-start', kind: 'test', label: 'Tests', command: 'bun run test' })
    const live = { activity: tracker.get(), usage: { tokensUsed: 10, timeUsedSeconds: 12 } }
    const lines = renderGoalHudLines(state(), theme, 120, live, 10000).join('\n')
    expect(lines).toContain('checking 1/5')
    expect(lines).toContain('Tests · running · 10s')
    expect(lines).toContain('No new activity event for 10s')
    expect(lines).toContain('Goal open')
    expect(lines).not.toContain('Goal completed')
    expect(tracker.get()?.updatedAt).toBe(0)
    for (const width of [1, 8, 40, 56, 80, 120]) {
      expect(
        renderGoalHudLines(state(), theme, width, live, 10000).every(
          (line) => visibleWidth(line) <= width,
        ),
      ).toBe(true)
    }
  })

  test('prioritizes operation and tokens over long model names in narrow terminals', () => {
    const tracker = new GoalActivityTracker(
      () => {},
      () => 0,
    )
    tracker.transition('goal', 'reviewing', 'Reviewing')
    tracker.progress({
      type: 'reviewer',
      phase: 'reviewing',
      model: 'provider/very-long-reviewer-model-name',
      tool: 'read',
      tokens: 120,
    })
    const live = { activity: tracker.get(), usage: undefined }
    const narrow = renderGoalHudLines(state(), theme, 60, live, 1000).join('\n')
    expect(narrow).toContain('reviewer · read · 120 tokens')
    expect(narrow).not.toContain('very-long-reviewer-model-name')
    expect(renderGoalHudLines(state(), theme, 120, live, 1000).join('\n')).toContain(
      'provider/very-long-reviewer-model-name',
    )
  })

  test('hides activity belonging to another goal or a paused owner', () => {
    const tracker = new GoalActivityTracker(() => {})
    tracker.transition('other', 'reviewing', 'Stale')
    const live = { activity: tracker.get(), usage: undefined }
    expect(renderGoalHudLines(state(), theme, 120, live).join('\n')).not.toContain('reviewer ·')
    const paused = state()
    paused.enabled = false
    paused.goal.status = 'paused'
    tracker.transition('goal', 'reviewing', 'Stale')
    expect(
      renderGoalHudLines(paused, theme, 120, { ...live, activity: tracker.get() }).join('\n'),
    ).not.toContain('reviewer ·')
  })
})
