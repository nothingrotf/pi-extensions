import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import hud from '../src/index.ts'

function harness() {
  const handlers = new Map()
  const commands = new Map()
  const appended = []
  let footerFactory
  let footerComponent
  let renders = 0
  let cleared = false
  const widgets = new Map()
  const eventHandlers = new Map()
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    events: {
      emit(channel, data) {
        eventHandlers.get(channel)?.(data)
      },
      on(channel, handler) {
        eventHandlers.set(channel, handler)
        return () => eventHandlers.delete(channel)
      },
    },
    getThinkingLevel() {
      return 'medium'
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
    registerEntryRenderer() {},
    registerMarkdownTransformer() {},
    registerTool() {},
    appendEntry(customType, data) {
      appended.push({ customType, data })
    },
  }
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd: process.cwd(),
    model: undefined,
    sessionManager: {
      getBranch: () => [],
    },
    getContextUsage() {
      return { tokens: 0, contextWindow: 272_000, percent: 0 }
    },
    ui: {
      setFooter(value) {
        if (value === undefined) {
          cleared = true
          footerComponent?.dispose()
          footerComponent = undefined
          return
        }
        footerFactory = value
      },
      notify() {},
      onTerminalInput() {
        return () => undefined
      },
      select() {},
      setWorkingVisible() {},
      setHiddenThinkingLabel() {},
      setWidget(key, factory) {
        if (factory === undefined) {
          widgets.delete(key)
          return
        }
        widgets.set(
          key,
          factory(
            { children: [], requestRender() {} },
            { fg: (_color, text) => text, getFgAnsi: () => '' },
          ),
        )
      },
    },
  }
  hud(api)
  const emit = async (name, event = {}) => {
    const handler = handlers.get(name)
    if (handler === undefined) {
      throw new Error(`Missing ${name} handler`)
    }
    await handler(event, ctx)
  }
  const mount = () => {
    if (footerFactory === undefined) {
      throw new Error('Footer factory was not installed')
    }
    footerComponent = footerFactory(
      {
        requestRender: () => {
          renders += 1
        },
      },
      { fg: (_color, text) => text },
      {
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => undefined,
      },
    )
    return footerComponent
  }
  return {
    appended: () => appended,
    commandNames: () => [...commands.keys()],
    emit,
    emitEvent: (channel, data) => eventHandlers.get(channel)?.(data),
    mount,
    renderCount: () => renders,
    wasCleared: () => cleared,
    widget: (key) => widgets.get(key),
    widgetKeys: () => [...widgets.keys()],
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

describe('HUD lifecycle', () => {
  test('registers one settings command', () => {
    expect(harness().commandNames()).toEqual(['hud'])
  })

  test('opens and persists a standalone rail action', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    const report = {
      doneLabel: 'Indexed',
      status: 'ok',
      toolCallId: 'external',
    }
    instance.emitEvent('hud:rail-action', report)
    instance.emitEvent('hud:rail-action', report)
    expect(instance.appended().map((entry) => entry.customType)).toEqual([
      'hud-rail',
      'hud-rail-state',
    ])
  })

  test('persists a final built-in action snapshot', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    await instance.emit('tool_execution_start', {
      args: { path: 'package.json' },
      toolCallId: 'read-1',
      toolName: 'read',
    })
    await instance.emit('tool_execution_end', { isError: false, toolCallId: 'read-1' })
    await instance.emit('agent_end')
    expect(instance.appended().map((entry) => entry.customType)).toEqual([
      'hud-rail',
      'hud-rail-state',
    ])
    expect(instance.appended()[1]?.data.report.status).toBe('ok')
    expect(instance.appended()[1]?.data.report.durationMs).toBeTypeOf('number')
  })

  test('ignores rail reports outside an active agent turn', () => {
    const instance = harness()
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Historical',
      status: 'ok',
      toolCallId: 'old',
    })
    expect(instance.appended()).toEqual([])
  })

  test('stops background updates when another footer replaces it', async () => {
    const instance = harness()
    await instance.emit('session_start')
    const component = instance.mount()
    component.dispose()
    await settle()
    const count = instance.renderCount()
    await instance.emit('agent_end')
    await settle()
    expect(instance.renderCount()).toBe(count)
    await instance.emit('session_shutdown')
    expect(instance.wasCleared()).toBe(false)
  })

  test('clears its footer during session shutdown while it still owns the slot', async () => {
    const instance = harness()
    await instance.emit('session_start')
    instance.mount()
    await instance.emit('session_shutdown')
    expect(instance.wasCleared()).toBe(true)
  })

  test('removes the working widget when a TUI session restarts', async () => {
    const instance = harness()
    await instance.emit('session_start')
    instance.mount()
    await instance.emit('turn_start')
    expect(instance.widgetKeys()).toEqual(['hud-working'])
    await instance.emit('session_start')
    expect(instance.widgetKeys()).toEqual([])
    instance.mount()
    await instance.emit('session_shutdown')
  })

  test('owns the working loader widget from turn start to agent end', async () => {
    const instance = harness()
    await instance.emit('session_start')
    expect(instance.widgetKeys()).toEqual([])
    await instance.emit('turn_start')
    expect(instance.widgetKeys()).toEqual(['hud-working'])
    const widget = instance.widget('hud-working')
    expect(stripTerminalSequences(widget.render(80)[0])).toContain('waiting for the model')
    instance.emitEvent('hud:working-message', 'Waiting on 2 jobs')
    expect(stripTerminalSequences(widget.render(80)[0])).toContain('Waiting on 2 jobs')
    instance.emitEvent('hud:working-message', null)
    expect(stripTerminalSequences(widget.render(80)[0])).toContain('waiting for the model')
    expect(stripTerminalSequences(widget.render(80)[0])).toMatch(/ · \d+s$/)
    await instance.emit('agent_end')
    expect(widget.render(80)).toEqual([])
    await instance.emit('session_shutdown')
    expect(instance.widgetKeys()).toEqual([])
  })

  test('formats the elapsed counter and the spinner', async () => {
    const { formatElapsed, spinnerFrame } = await import('../src/working.ts')
    expect(spinnerFrame(0)).toBe('⠋')
    expect(spinnerFrame(80)).toBe('⠙')
    expect(spinnerFrame(800)).toBe('⠋')
    expect(formatElapsed(400)).toBe('0s')
    expect(formatElapsed(9_400)).toBe('9s')
    expect(formatElapsed(62_000)).toBe('1m2s')
    expect(formatElapsed(120_000)).toBe('2m')
    expect(formatElapsed(3_720_000)).toBe('1h2m')
  })
})
