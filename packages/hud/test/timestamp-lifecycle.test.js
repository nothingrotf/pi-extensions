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
    emit(message) {
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

describe('timestamp lifecycle', () => {
  test('records user and assistant messages by default', () => {
    const instance = harness()
    instance.emit({ role: 'user', timestamp: 100 })
    instance.emit({ role: 'assistant', stopReason: 'toolUse', timestamp: 200 })
    instance.emit({ role: 'toolResult', timestamp: 300 })
    expect(instance.entries).toEqual([
      {
        customType: timestampEntryType,
        data: { kind: 'user', role: 'user', timestamp: 100 },
      },
      {
        customType: timestampEntryType,
        data: { kind: 'tool', role: 'assistant', timestamp: 200 },
      },
    ])
  })

  test('toggles timestamp recording and rendering', async () => {
    const instance = harness()
    const data = { kind: 'user', role: 'user', timestamp: Date.now() }
    expect(instance.render(data)).toBeDefined()
    await instance.toggle()
    instance.emit(data)
    expect(instance.entries).toEqual([])
    expect(instance.render(data)).toBeUndefined()
    expect(instance.notifications).toEqual([{ message: 'hud: timestamps disabled', level: 'info' }])
    await instance.toggle()
    instance.emit(data)
    expect(instance.entries).toHaveLength(1)
    expect(instance.render(data)).toBeDefined()
  })
})
