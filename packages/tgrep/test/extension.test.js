import { describe, expect, it } from 'vite-plus/test'

import tgrep from '../src/index.ts'

function harness() {
  const listeners = new Map()
  const shutdownHandlers = []
  const publications = []
  const registeredTools = []
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
  events.on('@nothingrotf/subagent/register-capabilities', (value) => publications.push(value))
  return {
    api: {
      events,
      getFlag: () => false,
      on(event, handler) {
        if (event === 'session_shutdown') shutdownHandlers.push(handler)
      },
      registerFlag() {},
      registerTool(tool) {
        registeredTools.push(tool.name)
      },
    },
    publications,
    registeredTools,
  }
}

describe('tgrep extension', () => {
  it('publishes grep to subagents as a declared override', () => {
    const instance = harness()

    tgrep(instance.api)

    expect(instance.registeredTools).toEqual(['grep'])
    instance.api.events.emit('@nothingrotf/subagent/discover-capabilities', { version: 1 })
    const publication = instance.publications.at(-1)
    expect(publication.sourceId).toBe('@nothingrotf/tgrep')
    expect(publication.registrations[0]).toMatchObject({
      id: 'tgrep',
      overrides: ['grep'],
      readonlyTools: ['grep'],
      version: '1',
    })
    expect(publication.registrations[0].tools.map((tool) => tool.name)).toEqual(['grep'])
  })
})
