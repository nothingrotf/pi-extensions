import { describe, expect, test } from 'vite-plus/test'

import hud from '../src/index.ts'

function harness() {
  const handlers = new Map()
  let footerFactory
  let footerComponent
  let renders = 0
  let cleared = false
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    getThinkingLevel() {
      return 'medium'
    },
  }
  const ctx = {
    hasUI: true,
    mode: 'tui',
    cwd: process.cwd(),
    model: undefined,
    getContextUsage() {
      return { tokens: 0, contextWindow: 272_000, percent: 0 }
    },
    ui: {
      setFooter(value) {
        if (value === undefined) {
          cleared = true
          footerComponent?.dispose()
          footerComponent = undefined
          return
        }
        footerFactory = value
      },
    },
  }
  hud(api)
  const emit = async (name) => {
    const handler = handlers.get(name)
    if (handler === undefined) {
      throw new Error(`Missing ${name} handler`)
    }
    await handler({}, ctx)
  }
  const mount = () => {
    if (footerFactory === undefined) {
      throw new Error('Footer factory was not installed')
    }
    footerComponent = footerFactory(
      {
        requestRender: () => {
          renders += 1
        },
      },
      { fg: (_color, text) => text },
      {
        getExtensionStatuses: () => new Map(),
        onBranchChange: () => () => undefined,
      },
    )
    return footerComponent
  }
  return {
    emit,
    mount,
    renderCount: () => renders,
    wasCleared: () => cleared,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

describe('HUD lifecycle', () => {
  test('stops background updates when another footer replaces it', async () => {
    const instance = harness()
    await instance.emit('session_start')
    const component = instance.mount()
    component.dispose()
    await settle()
    const count = instance.renderCount()
    await instance.emit('agent_end')
    await settle()
    expect(instance.renderCount()).toBe(count)
    await instance.emit('session_shutdown')
    expect(instance.wasCleared()).toBe(false)
  })

  test('clears its footer during session shutdown while it still owns the slot', async () => {
    const instance = harness()
    await instance.emit('session_start')
    instance.mount()
    await instance.emit('session_shutdown')
    expect(instance.wasCleared()).toBe(true)
  })
})
