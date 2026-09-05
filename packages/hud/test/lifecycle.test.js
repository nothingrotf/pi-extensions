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
      const listeners = handlers.get(name) ?? []
      listeners.push(handler)
      handlers.set(name, listeners)
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
        footerComponent?.dispose()
        footerComponent = undefined
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
    const listeners = handlers.get(name)
    if (listeners === undefined) {
      throw new Error(`Missing ${name} handler`)
    }
    for (const handler of listeners) await handler(event, ctx)
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
    async runCommand(name, args) {
      const command = commands.get(name)
      if (command === undefined) throw new Error(`Missing ${name} command`)
      await command.handler(args, ctx)
    },
    wasCleared: () => cleared,
    widget: (key) => widgets.get(key),
    widgetKeys: () => [...widgets.keys()],
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

describe('HUD lifecycle', () => {
  test('disposing an old footer twice does not disable its replacement', async () => {
    const instance = harness()
    await instance.emit('session_start')
    const previous = instance.mount()
    await instance.emit('session_start')
    instance.mount()
    previous.dispose()
    const count = instance.renderCount()
    await instance.emit('agent_start')
    expect(instance.renderCount()).toBeGreaterThan(count)
    await instance.emit('session_shutdown')
  })

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
      'hud-rail-replacement',
      'hud-rail-state',
    ])
  })

  test('persists state changes instead of alternating call and result render reports', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    const call = {
      detail: 'Inspect the repository',
      doneLabel: 'Task',
      runningLabel: 'Task',
      iconKey: 'agent',
      status: 'pending',
      toolCallId: 'task',
      toolName: 'Task',
    }
    const result = { ...call, output: 'Agent started' }
    for (let frame = 0; frame < 1000; frame += 1) {
      instance.emitEvent('hud:rail-action', call)
      instance.emitEvent('hud:rail-action', result)
    }
    const reports = () =>
      instance.appended().filter((entry) => entry.customType === 'hud-rail-state')
    expect(reports()).toHaveLength(2)
    expect(reports().at(-1)?.data.report).toMatchObject({
      output: 'Agent started',
      summary: 'Agent started',
    })
    instance.emitEvent('hud:rail-action', { ...result, status: 'ok', output: 'Done' })
    instance.emitEvent('hud:rail-action', call)
    expect(reports()).toHaveLength(3)
    expect(reports().at(-1)?.data.report).toMatchObject({ status: 'ok', output: 'Done' })
    await instance.emit('agent_end')
    expect(reports()).toHaveLength(3)
  })

  test('deduplicates child snapshots without losing child progress', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      toolCallId: 'parent',
      iconKey: 'agent',
      status: 'pending',
    })
    const child = {
      toolCallId: 'child',
      parentToolCallId: 'parent',
      iconKey: 'read',
      status: 'pending',
    }
    for (let frame = 0; frame < 1000; frame += 1) {
      instance.emitEvent('hud:rail-action', child)
      instance.emitEvent('hud:rail-action', { ...child, output: 'Read file' })
    }
    const reports = instance.appended().filter((entry) => entry.customType === 'hud-rail-state')
    expect(reports).toHaveLength(3)
    expect(reports.at(-1)?.data.report).toMatchObject({
      toolCallId: 'child',
      parentToolCallId: 'parent',
      output: 'Read file',
    })
    await instance.emit('agent_end')
  })

  test('persists a final built-in action snapshot', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    await instance.emit('tool_execution_start', {
      args: { path: 'package.json' },
      toolCallId: 'read-1',
      toolName: 'read',
    })
    await instance.emit('tool_execution_end', {
      isError: false,
      result: { content: [{ text: '{}', type: 'text' }], details: undefined },
      toolCallId: 'read-1',
      toolName: 'read',
    })
    await instance.emit('agent_end')
    expect(instance.appended().map((entry) => entry.customType)).toEqual([
      'hud-rail',
      'hud-rail-replacement',
      'hud-rail-state',
    ])
    expect(instance.appended()[2]?.data.report.status).toBe('ok')
    expect(instance.appended()[2]?.data.report.durationMs).toBeTypeOf('number')
  })

  test('renders an unmapped tool through the event fallback', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    await instance.emit('tool_execution_start', {
      args: { value: 'hello' },
      toolCallId: 'custom-1',
      toolName: 'custom_echo',
    })
    await instance.emit('tool_execution_end', {
      isError: false,
      result: { content: [{ text: 'echo hello', type: 'text' }] },
      toolCallId: 'custom-1',
      toolName: 'custom_echo',
    })
    await instance.emit('agent_end')
    expect(instance.appended().map((entry) => entry.customType)).toEqual([
      'hud-rail',
      'hud-rail-replacement',
      'hud-rail-state',
    ])
    expect(instance.appended()[2]?.data.report).toMatchObject({
      doneLabel: 'Custom echo',
      output: 'echo hello',
      status: 'ok',
      summary: 'echo hello',
      toolCallId: 'custom-1',
    })
  })

  test('does not add disabled-turn tools after the rail returns', async () => {
    const instance = harness()
    await instance.runCommand('hud', 'rail off')
    await instance.emit('agent_start')
    await instance.emit('tool_execution_start', {
      args: { value: 'hello' },
      toolCallId: 'custom-1',
      toolName: 'custom_echo',
    })
    await instance.emit('tool_execution_end', {
      isError: false,
      result: { content: [{ text: 'echo hello', type: 'text' }] },
      toolCallId: 'custom-1',
      toolName: 'custom_echo',
    })
    await instance.emit('agent_end')
    await instance.runCommand('hud', 'rail on')
    expect(instance.appended()).toEqual([])
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

  test('does not register an above-editor working widget', async () => {
    const instance = harness()
    await instance.emit('session_start')
    instance.mount()
    await instance.emit('agent_start')
    await instance.emit('turn_start')
    instance.emitEvent('hud:working-message', 'Waiting on 2 jobs')
    instance.emitEvent('hud:working-message', null)
    expect(instance.widgetKeys()).toEqual([])
    await instance.emit('agent_end')
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
