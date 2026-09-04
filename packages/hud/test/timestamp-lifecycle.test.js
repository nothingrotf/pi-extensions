import { visibleWidth } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { registerTimestamps, roleEntryType, timestampEntryType } from '../src/timestamp.ts'

function harness(header, live) {
  const handlers = new Map()
  const entries = []
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
  }
  const ctx = { ui: {} }
  const controls = registerTimestamps(api, live, header)
  return {
    turnStart(timestamp = Date.now()) {
      handlers.get('turn_start')({ timestamp }, ctx)
    },
    agentStart() {
      handlers.get('agent_start')({}, ctx)
    },
    start(message) {
      handlers.get('message_start')({ message }, ctx)
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
      return controls.toggle()
    },
    entries,
  }
}

const usage = { cacheRead: 0, cacheWrite: 0, cost: { total: 0 }, input: 1, output: 2 }

afterEach(() => vi.restoreAllMocks())

describe('transcript lifecycle', () => {
  test('opens the assistant header after the user message and adopts the assistant timestamp', () => {
    let closed = 0
    const opened = []
    const messages = []
    const instance = harness({
      onClose: () => {
        closed += 1
      },
      onMessage: (timestamp) => messages.push(timestamp),
      onOpen: (timestamp) => opened.push(timestamp),
      source: (timestamp) => ({
        active: true,
        motion: true,
        tick: 0,
        timestamp,
      }),
    })
    instance.agentStart()
    instance.turnStart(150)
    expect(instance.entries).toEqual([])
    expect(opened).toEqual([])

    instance.start({ role: 'user', timestamp: 100 })
    instance.end({ role: 'user', timestamp: 100 })
    expect(instance.entries).toEqual([
      { customType: roleEntryType, data: { role: 'user', timestamp: 100 } },
      {
        customType: roleEntryType,
        data: { label: 'no-model', role: 'assistant', timestamp: 150 },
      },
    ])
    expect(opened).toEqual([150])
    expect(messages).toEqual([])

    instance.start({ role: 'assistant', timestamp: 200 })
    expect(messages).toEqual([200])
    instance.turnStart(300)
    instance.start({ role: 'assistant', timestamp: 400 })
    expect(opened).toEqual([150])
    expect(messages).toEqual([200, 400])
    instance.agentEnd()
    expect(closed).toBe(1)
  })

  test('records the source timestamp for a user header', () => {
    const instance = harness()
    instance.start({ role: 'user', timestamp: 123 })
    expect(instance.entries[0]).toEqual({
      customType: roleEntryType,
      data: { role: 'user', timestamp: 123 },
    })
  })

  test('shows a zeroed live usage row before token metrics arrive', () => {
    const live = { row: () => undefined }
    const instance = harness(undefined, live)
    instance.agentStart()
    instance.turnStart(Date.now() + 1_000)
    expect(live.row()).toMatch(/▪ 0s · \$0\.000 · 0 in · 0 out · ⛁ 0% cached/u)
  })

  test('measures live and settled usage from the first turn receipt', () => {
    let now = 100
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const live = { row: () => undefined }
    const instance = harness(undefined, live)
    instance.agentStart()
    now = 1_000
    instance.turnStart(99_000)
    now = 2_400
    expect(live.row()).toContain('1s')
    instance.start({ role: 'assistant', timestamp: 200 })
    instance.end({ role: 'assistant', timestamp: 200, usage })
    instance.agentEnd()
    expect(instance.entries.at(-1).data.durationMs).toBe(1_400)
  })

  test('records one usage row per agent run', () => {
    const instance = harness()
    instance.agentStart()
    instance.turnStart(150)
    instance.start({ role: 'user', timestamp: 100 })
    instance.end({ role: 'user', timestamp: 100 })
    instance.start({ role: 'assistant', timestamp: 200 })
    instance.end({ role: 'assistant', timestamp: 200, usage })
    instance.start({ role: 'toolResult', timestamp: 300 })
    instance.end({ role: 'toolResult', timestamp: 300 })
    instance.turnStart()
    instance.start({ role: 'assistant', timestamp: 400 })
    instance.end({ role: 'assistant', timestamp: 400, usage })
    expect(instance.entries.map((entry) => entry.customType)).toEqual([
      roleEntryType,
      roleEntryType,
    ])
    expect(instance.entries.map((entry) => entry.data.role)).toEqual(['user', 'assistant'])
    instance.agentEnd()
    expect(instance.entries.map((entry) => entry.customType)).toEqual([
      roleEntryType,
      roleEntryType,
      timestampEntryType,
    ])
    expect(instance.entries[2].data).toMatchObject({ cacheRead: 0, cost: 0, input: 2, output: 4 })
    expect(instance.entries[2].data.durationMs).toBeGreaterThanOrEqual(0)
    instance.agentEnd()
    expect(instance.entries).toHaveLength(3)
  })

  test('toggles transcript recording and rendering', () => {
    const instance = harness()
    const data = {
      cacheRead: 0,
      cost: 0,
      durationMs: 1_000,
      input: 1,
      output: 2,
      timestamp: Date.now(),
    }
    const persistedUsage = instance.render(data)
    const persistedRole = instance.render({ role: 'user', timestamp: Date.now() }, roleEntryType)
    expect(persistedUsage).toBeDefined()
    expect(persistedUsage.render(80)[0].startsWith('   ▪')).toBe(true)
    expect(visibleWidth(persistedUsage.render(80)[0])).toBe(80)
    expect(persistedRole).toBeDefined()
    instance.toggle()
    expect(persistedUsage.render(80)).toEqual([])
    expect(persistedRole.render(80)).toEqual([])
    instance.agentStart()
    instance.turnStart()
    instance.start({ role: 'user', timestamp: 1 })
    instance.end({ role: 'user', timestamp: 1 })
    instance.start({ role: 'assistant', timestamp: 1 })
    instance.end({ role: 'assistant', timestamp: 1, usage })
    instance.agentEnd()
    expect(instance.entries).toEqual([])
    expect(instance.render(data).render(80)).toEqual([])
    instance.toggle()
    expect(persistedUsage.render(80).length).toBeGreaterThan(0)
    expect(persistedRole.render(80).length).toBeGreaterThan(0)
    instance.agentStart()
    instance.turnStart()
    instance.start({ role: 'assistant', timestamp: 1 })
    instance.end({ role: 'assistant', timestamp: 1, usage })
    instance.agentEnd()
    expect(instance.entries).toHaveLength(2)
    expect(instance.entries.map((entry) => entry.customType)).toEqual([
      roleEntryType,
      timestampEntryType,
    ])
    expect(instance.render(data)).toBeDefined()
  })
})
