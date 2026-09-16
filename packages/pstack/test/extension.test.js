import { describe, expect, it } from 'vite-plus/test'

import pstack from '../src/index.ts'

function harness() {
  const listeners = new Map()
  const shutdownHandlers = []
  const registrations = []
  const capabilityRegistrations = []
  const events = {
    emit(channel, value) {
      for (const listener of listeners.get(channel) ?? []) listener(value)
    },
    on(channel, listener) {
      const channelListeners = listeners.get(channel) ?? new Set()
      channelListeners.add(listener)
      listeners.set(channel, channelListeners)
      return () => channelListeners.delete(listener)
    },
  }
  events.on('@nothingrotf/subagent/register-agents', (value) => registrations.push(value))
  events.on('@nothingrotf/subagent/register-capability-profiles', (value) =>
    capabilityRegistrations.push(value),
  )
  return {
    api: {
      events,
      registerTool() {},
      on(event, handler) {
        if (event === 'session_shutdown') shutdownHandlers.push(handler)
      },
    },
    capabilityRegistrations,
    registrations,
    async shutdown() {
      for (const handler of shutdownHandlers) await handler({}, {})
    },
  }
}

describe('pstack extension', () => {
  it('publishes bundled agents immediately and after discovery', async () => {
    const instance = harness()
    await pstack(instance.api)
    expect(instance.registrations).toHaveLength(1)
    expect(instance.capabilityRegistrations).toEqual([
      {
        profiles: [
          { id: 'pstack-leaf', registrations: ['pstack-planning'] },
          { id: 'pstack-nested', nested: { maxDepth: 3 }, registrations: ['pstack-planning'] },
        ],
        sourceId: '@nothingrotf/pstack',
      },
    ])
    expect(instance.registrations[0]).toMatchObject({
      definitions: [
        {
          description:
            'A deranged comment-hater that savors deletion and condemns workaround code.',
          name: 'Comment Sicko',
        },
        {
          description:
            'Scoped Poteto issue owner or reviewer. Preserves evidence and conversation across compatible corrections. Loads its worker contract and assigned workflow without the full coordinator catalog.',
          capabilityProfile: 'pstack-leaf',
          is_background: true,
          name: 'poteto-agent',
        },
      ],
      sourceId: '@nothingrotf/pstack',
    })
    instance.api.events.emit('@nothingrotf/subagent/discover-agents', { version: 1 })
    instance.api.events.emit('@nothingrotf/subagent/discover-capability-profiles', { version: 1 })
    expect(instance.registrations).toHaveLength(2)
    expect(instance.capabilityRegistrations).toHaveLength(2)
    await instance.shutdown()
    instance.api.events.emit('@nothingrotf/subagent/discover-agents', { version: 1 })
    instance.api.events.emit('@nothingrotf/subagent/discover-capability-profiles', { version: 1 })
    expect(instance.registrations).toHaveLength(2)
    expect(instance.capabilityRegistrations).toHaveLength(2)
  })
})
