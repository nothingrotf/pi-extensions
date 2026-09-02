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
        profiles: [{ id: 'pstack-nested', nested: { maxDepth: 3 }, registrations: [] }],
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
            "Routing target for `/poteto-mode` and any request for poteto's style. Resume an existing `poteto-agent` for the conversation rather than spawning a sibling. Reads the `poteto-mode` skill's `SKILL.md` in full before any work, including its inline Principles index. Substituting `generalPurpose` skips that read and drifts.",
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
