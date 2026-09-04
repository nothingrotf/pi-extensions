import { visibleWidth } from '@earendil-works/pi-tui'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { registerTimestamps, roleEntryType, timestampEntryType } from '../src/timestamp.ts'
import { WorkingStatus } from '../src/working.ts'

function harness(header, live, working) {
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
  const controls = registerTimestamps(api, live, header, working)
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
    update(message, assistantMessageEvent) {
      handlers.get('message_update')({ assistantMessageEvent, message }, ctx)
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
const assistant = (timestamp, content = []) => ({ content, role: 'assistant', timestamp, usage })

const liveUsage = () => ({ row: () => undefined, waiting: () => undefined })

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

    instance.start(assistant(200))
    expect(messages).toEqual([200])
    instance.turnStart(300)
    instance.start(assistant(400))
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

  test('replaces zeroed usage with waiting before the first response', () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const live = liveUsage()
    const instance = harness(undefined, live)
    instance.agentStart()
    instance.turnStart(99_000)
    expect(live.row()).toMatch(/^⠹ waiting for the model$/u)
    expect(live.waiting()?.message).toBe('waiting for the model')

    now = 5_000
    expect(live.row()).toContain(' · 4s')
    instance.update(assistant(200, [{ text: 'Hello', type: 'text' }]), {
      contentIndex: 0,
      delta: 'Hello',
      type: 'text_delta',
    })
    expect(live.waiting()).toBeUndefined()
    expect(live.row()).toMatch(/▪ 4s · \$0\.000 · 0 in · 0 out · ⛁ 0% cached/u)
  })

  test('keeps waiting through empty stream events', () => {
    const live = liveUsage()
    const instance = harness(undefined, live)
    instance.agentStart()
    instance.turnStart()
    instance.start(assistant(200))
    const empty = assistant(200, [{ text: '', type: 'text' }])
    instance.update(empty, {
      contentIndex: 0,
      type: 'text_start',
    })
    instance.end(empty)
    instance.turnStart()
    expect(live.row()).toContain('waiting for the model')
  })

  test('measures live and settled usage from the first turn receipt', () => {
    let now = 100
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const live = liveUsage()
    const instance = harness(undefined, live)
    instance.agentStart()
    now = 1_000
    instance.turnStart(99_000)
    instance.start(assistant(200, [{ text: 'Hello', type: 'text' }]))
    now = 2_400
    expect(live.row()).toContain('1s')
    instance.end(assistant(200, [{ text: 'Hello', type: 'text' }]))
    instance.agentEnd()
    expect(instance.entries.at(-1).data.durationMs).toBe(1_400)
  })

  test('places an extension wait message in the live usage slot', () => {
    const working = new WorkingStatus()
    const live = liveUsage()
    const instance = harness(undefined, live, working)
    instance.agentStart()
    instance.turnStart()
    instance.start(assistant(200, [{ text: 'Delegating', type: 'text' }]))
    working.setMessage('Waiting on 2 jobs')
    expect(live.waiting()).toBeUndefined()
    expect(live.row()).toContain('Waiting on 2 jobs')
    working.setMessage(undefined)
    expect(live.row()).toContain('▪')
  })

  test('records one usage row per agent run', () => {
    const instance = harness()
    instance.agentStart()
    instance.turnStart(150)
    instance.start({ role: 'user', timestamp: 100 })
    instance.end({ role: 'user', timestamp: 100 })
    instance.start(assistant(200))
    instance.end(assistant(200))
    instance.start({ role: 'toolResult', timestamp: 300 })
    instance.end({ role: 'toolResult', timestamp: 300 })
    instance.turnStart()
    instance.start(assistant(400))
    instance.end(assistant(400))
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
    instance.start(assistant(1))
    instance.end(assistant(1))
    instance.agentEnd()
    expect(instance.entries).toEqual([])
    expect(instance.render(data).render(80)).toEqual([])
    instance.toggle()
    expect(persistedUsage.render(80).length).toBeGreaterThan(0)
    expect(persistedRole.render(80).length).toBeGreaterThan(0)
    instance.agentStart()
    instance.turnStart()
    instance.start(assistant(1))
    instance.end(assistant(1))
    instance.agentEnd()
    expect(instance.entries).toHaveLength(2)
    expect(instance.entries.map((entry) => entry.customType)).toEqual([
      roleEntryType,
      timestampEntryType,
    ])
    expect(instance.render(data)).toBeDefined()
  })
})
