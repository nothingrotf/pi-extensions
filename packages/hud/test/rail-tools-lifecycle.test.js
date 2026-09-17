import { createReadToolDefinition } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { setIconMode } from '../src/icons.ts'
import { builtInRailToolNames } from '../src/rail-channel.ts'
import { applyRailTools, railTool } from '../src/rail-tools.ts'
import { RailStore } from '../src/rail.ts'

afterEach(() => setIconMode('auto'))

describe('rail tool lifecycle', () => {
  test('leaves search and file access ownership to their providers across rail toggles', () => {
    const registered = []
    const pi = { registerTool: (tool) => registered.push(tool.name) }
    const store = new RailStore()
    for (const enabled of [true, false, true]) {
      applyRailTools(pi, () => store, process.cwd(), enabled)
    }
    for (const name of ['grep', 'read', 'patch']) {
      expect(registered).not.toContain(name)
      expect(builtInRailToolNames).not.toContain(name)
    }
    expect(registered).toContain('write')
    expect(registered).toContain('edit')
  })

  test('adds argument glyphs during the call render', () => {
    setIconMode('nerd')
    const store = new RailStore()
    const base = createReadToolDefinition(process.cwd())
    const wrapped = railTool(base, () => store, {
      category: 'read',
      detail: (args) => args.path,
      doneLabel: 'Read',
      iconKey: 'read',
      runningLabel: 'Reading',
    })
    expect(wrapped.renderCall).toBeDefined()
    wrapped.renderCall(
      { path: 'types.ts' },
      {},
      {
        args: { path: 'types.ts' },
        cwd: process.cwd(),
        invalidate: () => undefined,
        lastComponent: undefined,
        state: {},
        toolCallId: 'call-1',
      },
    )
    expect(store.values()[0]?.argGlyphs).toEqual(['\uE628'])
  })
})
