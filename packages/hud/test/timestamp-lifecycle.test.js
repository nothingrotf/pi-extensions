import { describe, expect, test } from 'vite-plus/test'

import { registerTimestamps, roleEntryType, timestampEntryType } from '../src/timestamp.ts'

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
    start(message) {
      handlers.get('message_start')({ message }, ctx)
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

const usage = { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 }

describe('transcript lifecycle', () => {
  test('records role headers and assistant usage rows', () => {
    const instance = harness()
    instance.turnStart()
    instance.start({ role: 'user', timestamp: 100 })
    instance.end({ role: 'user', timestamp: 100 })
    instance.start({ role: 'assistant', timestamp: 200 })
    instance.end({ role: 'assistant', timestamp: 200, usage })
    instance.start({ role: 'toolResult', timestamp: 300 })
    instance.end({ role: 'toolResult', timestamp: 300 })
    expect(instance.entries.map((entry) => entry.customType)).toEqual([
      roleEntryType,
      roleEntryType,
      timestampEntryType,
    ])
    expect(instance.entries[0].data.role).toBe('user')
    expect(instance.entries[1].data.role).toBe('assistant')
    expect(instance.entries[2].data).toMatchObject({
      cacheRead: 0,
      input: 1,
      output: 2,
      timestamp: 200,
    })
    expect(instance.entries[2].data.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('toggles transcript recording and rendering', async () => {
    const instance = harness()
    const data = { cacheRead: 0, durationMs: 1_000, input: 1, output: 2, timestamp: Date.now() }
    expect(instance.render(data)).toBeDefined()
    expect(instance.render({ role: 'user', timestamp: Date.now() }, roleEntryType)).toBeDefined()
    await instance.toggle()
    instance.start({ role: 'user', timestamp: 1 })
    instance.end({ role: 'assistant', timestamp: 1, usage })
    expect(instance.entries).toEqual([])
    expect(instance.render(data)).toBeUndefined()
    expect(instance.notifications).toEqual([{ message: 'hud: timestamps disabled', level: 'info' }])
    await instance.toggle()
    instance.end({ role: 'assistant', timestamp: 1, usage })
    expect(instance.entries).toHaveLength(1)
    expect(instance.render(data)).toBeDefined()
  })
})
