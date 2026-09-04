import { describe, expect, test, vi } from 'vite-plus/test'

import { SubagentTui } from '../src/ui.ts'

const theme = {
  bg(_color, text) {
    return text
  },
  bold(text) {
    return text
  },
  fg(_color, text) {
    return text
  },
  getFgAnsi() {
    return ''
  },
}

function runtimeHarness() {
  let listener
  let snapshots = []
  return {
    runtime: {
      async cancel() {
        return false
      },
      listSnapshots() {
        return snapshots
      },
      subscribe(next) {
        listener = next
      },
    },
    update(next) {
      snapshots = next
      listener?.()
    },
  }
}

function context(mode) {
  const widgetCalls = []
  const tui = { requestRender: vi.fn() }
  return {
    ctx: {
      hasUI: true,
      mode,
      model: { id: 'parent-model' },
      ui: {
        async custom() {},
        notify() {},
        setWidget(key, factory, options) {
          widgetCalls.push({ key, factory, options })
          if (factory !== undefined) factory(tui, theme)
        },
      },
    },
    tui,
    widgetCalls,
  }
}

describe('subagent editor panel lifecycle', () => {
  test('does not register or animate outside TUI mode', async () => {
    vi.useFakeTimers()
    try {
      const harness = runtimeHarness()
      const ui = context('rpc')
      const panel = new SubagentTui(harness.runtime)
      panel.sessionStart(ui.ctx)
      harness.update([{ running: true }])
      await vi.advanceTimersByTimeAsync(500)
      expect(ui.widgetCalls).toEqual([])
      expect(ui.tui.requestRender).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  test('registers once and clears animation timers on shutdown', () => {
    vi.useFakeTimers()
    try {
      const harness = runtimeHarness()
      harness.update([{ running: true }])
      const ui = context('tui')
      const panel = new SubagentTui(harness.runtime)
      panel.sessionStart(ui.ctx)
      panel.agentStart(ui.ctx)
      expect(ui.widgetCalls).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(1)
      panel.sessionShutdown(ui.ctx)
      expect(ui.widgetCalls.at(-1)).toMatchObject({ key: 'subagents', factory: undefined })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
