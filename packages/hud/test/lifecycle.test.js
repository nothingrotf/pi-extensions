import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, test } from 'vite-plus/test'

import hud from '../src/index.ts'

function harness(sessionManager = SessionManager.inMemory()) {
  const renderers = new Map()
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
    registerEntryRenderer(name, renderer) {
      renderers.set(name, renderer)
    },
    registerMarkdownTransformer() {},
    registerTool() {},
    appendEntry(customType, data) {
      appended.push({ customType, data })
      sessionManager.appendCustomEntry(customType, data)
    },
  }
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd: process.cwd(),
    model: undefined,
    sessionManager,
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
    sessionManager,
    transcript: () =>
      sessionManager
        .buildContextEntries()
        .flatMap((entry) => {
          if (entry.type !== 'custom') return []
          const component = renderers.get(entry.customType)?.(
            entry,
            { expanded: false },
            { bold: (text) => text, fg: (_color, text) => text },
          )
          return component?.render(100) ?? []
        })
        .join('\n'),
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
  test('restores cache share and updates it after responses and tree navigation', async () => {
    const session = SessionManager.inMemory()
    const appendUsage = (input, cacheRead, cacheWrite) =>
      session.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Done' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        stopReason: 'stop',
        timestamp: Date.now(),
        usage: {
          input,
          cacheRead,
          cacheWrite,
          output: 10,
          totalTokens: input + cacheRead + cacheWrite + 10,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      })
    const first = appendUsage(100, 800, 100)
    const instance = harness(session)
    await instance.emit('session_start')
    const footer = instance.mount()
    try {
      expect(footer.render(180).join('')).toContain('0%/272k · ⛁ 80% cached')
      const next = {
        ...session.getLeafEntry().message,
        usage: {
          ...session.getLeafEntry().message.usage,
          input: 300,
          cacheRead: 100,
          cacheWrite: 100,
        },
      }
      await instance.emit('message_end', { message: next })
      expect(footer.render(180).join('')).toContain('⛁ 60% cached')
      session.appendMessage(next)
      session.branch(first)
      await instance.emit('session_tree')
      expect(footer.render(180).join('')).toContain('⛁ 80% cached')
      appendUsage(0, 0, 0)
      await instance.emit('message_end', { message: session.getLeafEntry().message })
      expect(footer.render(180).join('')).toContain('⛁ 80% cached')
    } finally {
      await instance.emit('session_shutdown')
    }
  })

  test('keeps the live rail visible after split-turn compaction and reload', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      detail: 'repository',
      doneLabel: 'Indexed',
      status: 'ok',
      toolCallId: 'external',
    })
    expect(instance.transcript()).toContain('Indexed')
    const kept = instance.sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Continue the task' }],
      timestamp: Date.now(),
    })
    instance.sessionManager.appendCompaction('Earlier work', kept, 100_000)
    await instance.emit('session_compact')
    expect(instance.transcript()).toContain('Indexed')
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Verified',
      status: 'ok',
      toolCallId: 'next',
    })
    expect(instance.transcript()).toContain('Verified')
    const restored = harness(instance.sessionManager)
    await restored.emit('session_start')
    expect(restored.transcript()).toContain('Indexed')
    expect(restored.transcript()).toContain('Verified')
    await restored.emit('session_shutdown')
    await instance.emit('session_shutdown')
  })

  test('does not duplicate retained anchors and repairs repeated compactions', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Indexed',
      status: 'ok',
      toolCallId: 'external',
    })
    const original = instance.sessionManager.getBranch()[0]
    instance.sessionManager.appendCompaction('Earlier work', original.id, 100_000)
    await instance.emit('session_compact')
    expect(instance.appended().filter((entry) => entry.customType === 'hud-rail')).toHaveLength(1)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const kept = instance.sessionManager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Continue' }],
        timestamp: Date.now(),
      })
      instance.sessionManager.appendCompaction('Earlier work', kept, 100_000)
      await instance.emit('session_compact')
      await instance.emit('session_compact')
      expect(instance.transcript().match(/Indexed/g)).toHaveLength(1)
    }
    expect(instance.appended().filter((entry) => entry.customType === 'hud-rail')).toHaveLength(3)
    await instance.emit('session_shutdown')
  })

  test('keeps a restored anchor attached to its original turn', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Indexed',
      status: 'ok',
      toolCallId: 'external',
    })
    const kept = instance.sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'external', name: 'read', arguments: { path: 'a.ts' } }],
      timestamp: Date.now(),
    })
    await instance.emit('agent_end')
    instance.sessionManager.appendMessage({
      role: 'user',
      content: 'Next task',
      timestamp: Date.now(),
    })
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Verified',
      status: 'ok',
      toolCallId: 'next',
    })
    instance.sessionManager.appendCompaction('Earlier work', kept, 100_000)
    await instance.emit('session_compact')
    expect(instance.transcript().match(/Indexed/g)).toHaveLength(1)
    expect(instance.transcript().match(/Verified/g)).toHaveLength(1)
    const restored = harness(instance.sessionManager)
    await restored.emit('session_start')
    expect(restored.transcript().match(/Indexed/g)).toHaveLength(1)
    expect(restored.transcript().match(/Verified/g)).toHaveLength(1)
    await restored.emit('session_shutdown')
    await instance.emit('session_shutdown')
  })

  test('repairs a missing anchor when a compacted session resumes', async () => {
    const instance = harness()
    await instance.emit('agent_start')
    instance.emitEvent('hud:rail-action', {
      doneLabel: 'Indexed',
      status: 'ok',
      toolCallId: 'external',
    })
    const kept = instance.sessionManager.appendMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'Continue' }],
      timestamp: Date.now(),
    })
    instance.sessionManager.appendCompaction('Earlier work', kept, 100_000)
    expect(instance.transcript()).not.toContain('Indexed')
    const restored = harness(instance.sessionManager)
    await restored.emit('session_start')
    expect(restored.transcript()).toContain('Indexed')
    await restored.emit('session_shutdown')
    await instance.emit('session_shutdown')
  })

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
