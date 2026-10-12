import { afterEach, describe, expect, test } from 'vite-plus/test'

import { setIconMode } from '../src/icons.ts'
import { builtInRailToolNames } from '../src/rail-channel.ts'
import { registerRailRenderers } from '../src/rail-tools.ts'
import { RailStore } from '../src/rail.ts'

afterEach(() => setIconMode('auto'))

function resolverFor(store, enabled) {
  const resolvers = []
  registerRailRenderers(
    { registerToolRenderer: (resolver) => resolvers.push(resolver) },
    () => store,
    () => enabled.value,
  )
  expect(resolvers).toHaveLength(1)
  return resolvers[0]
}

function renderContext(overrides = {}) {
  return {
    args: { path: 'src/types.ts' },
    cwd: process.cwd(),
    durationMs: undefined,
    invalidate: () => undefined,
    isError: false,
    lastComponent: undefined,
    state: {},
    toolCallId: 'call-1',
    ...overrides,
  }
}

describe('rail tool renderers', () => {
  test('draws built-in tools without registering them', () => {
    const native = { renderShell: 'default' }
    const enabled = { value: true }
    const resolve = resolverFor(new RailStore(), enabled)
    for (const name of builtInRailToolNames) {
      expect(resolve(name, () => native)?.renderShell).toBe('self')
    }
    for (const name of ['grep', 'read', 'patch', 'mcp__docs__search']) {
      expect(resolve(name, () => native)).toBe(native)
      expect(builtInRailToolNames).not.toContain(name)
    }
    enabled.value = false
    expect(resolve('bash', () => native)).toBe(native)
  })

  test('reports call details relative to the tool cwd and the measured duration', () => {
    setIconMode('nerd')
    const store = new RailStore()
    const renderers = resolverFor(store, { value: true })('write', () => undefined)
    const context = renderContext()
    renderers.renderCall(context.args, {}, context)
    expect(store.values()[0]).toMatchObject({
      argGlyphs: ['\uE628'],
      detail: 'src/types.ts',
      status: 'pending',
    })
    renderers.renderResult(
      { content: [{ text: 'Wrote 2 lines', type: 'text' }] },
      { expanded: false, isPartial: false },
      {},
      renderContext({ durationMs: 37 }),
    )
    expect(store.values()[0]).toMatchObject({ durationMs: 37, status: 'ok' })
  })
})
