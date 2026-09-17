import { describe, expect, it } from 'vite-plus/test'

import filetools from '../src/index.ts'

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
      on(event, handler) {
        if (event === 'session_shutdown') shutdownHandlers.push(handler)
      },
      registerTool(tool) {
        registeredTools.push(tool.name)
      },
    },
    publications,
    registeredTools,
    shutdown() {
      for (const handler of shutdownHandlers) handler()
    },
  }
}

describe('filetools extension', () => {
  it('registers both tools and republishes its capability on discovery', () => {
    const instance = harness()

    filetools(instance.api)

    expect(instance.registeredTools).toEqual(['read', 'patch'])
    expect(instance.publications).toHaveLength(1)

    instance.api.events.emit('@nothingrotf/subagent/discover-capabilities', { version: 1 })

    expect(instance.publications).toHaveLength(2)
    const publication = instance.publications.at(-1)
    expect(publication.sourceId).toBe('@nothingrotf/filetools')
    expect(publication.registrations[0]).toMatchObject({
      id: 'filetools',
      overrides: ['read'],
      readonlyTools: ['read'],
      version: '1',
    })
    expect(publication.registrations[0].tools.map((tool) => tool.name)).toEqual(['read', 'patch'])
    expect(publication.registrations[0].createTools().map((tool) => tool.name)).toEqual([
      'read',
      'patch',
    ])
  })

  it('stops publishing after session shutdown', () => {
    const instance = harness()
    filetools(instance.api)

    instance.shutdown()
    instance.api.events.emit('@nothingrotf/subagent/discover-capabilities', { version: 1 })

    expect(instance.publications).toHaveLength(1)
  })
})
