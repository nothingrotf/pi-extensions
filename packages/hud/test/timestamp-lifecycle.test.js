import { describe, expect, test } from 'vite-plus/test'

import { registerTimestamps, timestampEntryType } from '../src/timestamp.ts'

function harness() {
  const handlers = new Map()
  const commands = new Map()
  const entries = []
  const notifications = []
  let renderer
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    appendEntry(customType, data) {
      entries.push({ customType, data })
    },
    registerEntryRenderer(customType, value) {
      expect(customType).toBe(timestampEntryType)
      renderer = value
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
    end(message) {
      handlers.get('message_end')({ message }, ctx)
    },
    render(data) {
      return renderer({ data }, {}, { fg: (_color, text) => text })
    },
    toggle() {
      return commands.get('hud-timestamp').handler('', ctx)
    },
    entries,
    notifications,
  }
}

const usage = { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 }

describe('usage row lifecycle', () => {
  test('records assistant messages only', () => {
    const instance = harness()
    instance.end({ role: 'user', timestamp: 100 })
    instance.turnStart()
    instance.end({ role: 'assistant', timestamp: 200, usage })
    instance.end({ role: 'toolResult', timestamp: 300 })
    expect(instance.entries).toHaveLength(1)
    expect(instance.entries[0].customType).toBe(timestampEntryType)
    expect(instance.entries[0].data).toMatchObject({
      cacheRead: 0,
      input: 1,
      output: 2,
      timestamp: 200,
    })
    expect(instance.entries[0].data.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('toggles usage recording and rendering', async () => {
    const instance = harness()
    const data = { cacheRead: 0, durationMs: 1_000, input: 1, output: 2, timestamp: Date.now() }
    expect(instance.render(data)).toBeDefined()
    await instance.toggle()
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
