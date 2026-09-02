import { describe, expect, it } from 'vite-plus/test'

import { CapabilityRegistry } from '../src/capabilities.ts'

describe('capability profiles', () => {
  it('registers a publication atomically', () => {
    const registry = new CapabilityRegistry()
    registry.registerProfile({ id: 'existing', registrations: [] })

    expect(() =>
      registry.registerProfiles([
        { id: 'new-profile', registrations: [] },
        { id: 'existing', registrations: [] },
      ]),
    ).toThrow('already exists')
    expect(() => registry.resolve('new-profile')).toThrow('does not exist')
  })

  it('bounds nested depth', () => {
    const registry = new CapabilityRegistry()

    expect(() =>
      registry.registerProfile({ id: 'too-deep', nested: { maxDepth: 17 }, registrations: [] }),
    ).toThrow('from 1 through 16')
  })
})
