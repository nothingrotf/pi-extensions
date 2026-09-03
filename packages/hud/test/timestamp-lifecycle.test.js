import { describe, expect, test } from 'vite-plus/test'

import { registerTimestamps, timestampEntryType } from '../src/timestamp.ts'

function harness() {
  const handlers = new Map()
  const commands = new Map()
  const entries = []
  const notifications = []
  const renderers = new Map()
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    appendEntry(customType, data) {
      entries.push({ customType, data })
    },
    registerEntryRenderer(customType, value) {
      renderers.set(customType, value)
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
  }
  const ctx = {
    ui: {
      notify(message, level) {
        notifications.push({ message, level })
      },
    },
  }
  registerTimestamps(api)
  return {
    turnStart() {
      handlers.get('turn_start')({}, ctx)
    },
    agentStart() {
      handlers.get('agent_start')({}, ctx)
    },
    agentEnd() {
      handlers.get('agent_end')({}, ctx)
    },
    end(message) {
      handlers.get('message_end')({ message }, ctx)
    },
    render(data, customType = timestampEntryType) {
      return renderers.get(customType)(
        { data },
        {},
        { bold: (text) => text, fg: (_color, text) => text },
      )
    },
    toggle() {
      return commands.get('hud-timestamp').handler('', ctx)
    },
    entries,
    notifications,
  }
}

const usage = { cacheRead: 0, cacheWrite: 0, cost: { total: 0 }, input: 1, output: 2 }

describe('transcript lifecycle', () => {
  test('records one usage row per agent run', () => {
    const instance = harness()
    instance.agentStart()
    instance.turnStart()
    instance.end({ role: 'user', timestamp: 100 })
    instance.end({ role: 'assistant', timestamp: 200, usage })
    instance.end({ role: 'toolResult', timestamp: 300 })
    instance.turnStart()
    instance.end({ role: 'assistant', timestamp: 400, usage })
    expect(instance.entries).toEqual([])
    instance.agentEnd()
    expect(instance.entries.map((entry) => entry.customType)).toEqual([timestampEntryType])
    expect(instance.entries[0].data).toMatchObject({ cacheRead: 0, cost: 0, input: 2, output: 4 })
    expect(instance.entries[0].data.durationMs).toBeGreaterThanOrEqual(0)
    instance.agentEnd()
    expect(instance.entries).toHaveLength(1)
  })

  test('toggles transcript recording and rendering', async () => {
    const instance = harness()
    const data = {
      cacheRead: 0,
      cost: 0,
      durationMs: 1_000,
      input: 1,
      output: 2,
      timestamp: Date.now(),
    }
    expect(instance.render(data)).toBeDefined()
    await instance.toggle()
    instance.agentStart()
    instance.turnStart()
    instance.end({ role: 'assistant', timestamp: 1, usage })
    instance.agentEnd()
    expect(instance.entries).toEqual([])
    expect(instance.render(data)).toBeUndefined()
    expect(instance.notifications).toEqual([{ message: 'hud: timestamps disabled', level: 'info' }])
    await instance.toggle()
    instance.agentStart()
    instance.turnStart()
    instance.end({ role: 'assistant', timestamp: 1, usage })
    instance.agentEnd()
    expect(instance.entries).toHaveLength(1)
    expect(instance.render(data)).toBeDefined()
  })
})
