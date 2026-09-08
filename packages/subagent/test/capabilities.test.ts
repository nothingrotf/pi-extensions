import { DefaultResourceLoader, defineTool } from '@earendil-works/pi-coding-agent'
import { Type, type TSchema } from 'typebox'
import { describe, expect, it } from 'vite-plus/test'

import {
  CapabilityRegistry,
  type CapabilityModelPolicy,
  decodeCapabilityPublication,
  isCapabilitySubset,
  selectCapabilityModel,
} from '../src/capabilities.ts'
import type { CapabilityContract } from '../src/schema.ts'

function tool(name = 'planning', parameters: TSchema = Type.Object({ item: Type.String() })) {
  return defineTool({
    name,
    label: name,
    description: 'Session planning',
    parameters,
    async execute() {
      return { content: [{ type: 'text', text: 'OK' }], details: {} }
    },
  })
}

describe('capability attenuation', () => {
  const approved: CapabilityContract = {
    extensions: [
      { id: 'hooks', version: '1' },
      { id: 'plan', version: '2' },
    ],
    nested: { enabled: true, maxDepth: 3 },
    profileId: 'owner',
    registrations: [
      { id: 'plan', version: '2' },
      { id: 'hooks', version: '1' },
    ],
    tools: ['planning', 'inspect'],
  }

  it('allows independently ordered identity subsets and less delegation', () => {
    expect(
      isCapabilitySubset(
        {
          extensions: [{ id: 'plan', version: '2' }],
          nested: { enabled: false },
          profileId: 'leaf',
          registrations: [{ id: 'plan', version: '2' }],
          tools: ['planning'],
        },
        approved,
      ),
    ).toBe(true)
    expect(
      isCapabilitySubset({ ...approved, nested: { enabled: true, maxDepth: 2 } }, approved),
    ).toBe(true)
    expect(isCapabilitySubset(approved, approved)).toBe(true)
  })

  const expansions: Partial<CapabilityContract>[] = [
    { registrations: [{ id: 'other-provider', version: '2' }] },
    { registrations: [{ id: 'plan', version: '3' }] },
    { extensions: [{ id: 'other-provider', version: '1' }] },
    { extensions: [{ id: 'hooks', version: '2' }] },
    { tools: ['planning', 'unapproved'] },
    { nested: { enabled: true, maxDepth: 4 } },
  ]
  it.each(expansions)('rejects an expanded contract %j', (expansion) => {
    expect(isCapabilitySubset({ ...approved, ...expansion }, approved)).toBe(false)
  })

  it('cannot re-enable delegation after it has been removed', () => {
    expect(isCapabilitySubset(approved, { ...approved, nested: { enabled: false } })).toBe(false)
  })
})

describe('capability profiles', () => {
  it.each([
    'Task',
    'TaskControl',
    'ask_parent',
    'request_parent',
    'notify_parent',
    'update_progress',
    'send_peer',
    'receive_peers',
    'subagent_status',
  ])('reserves private dispatcher %s', (name) => {
    const registry = new CapabilityRegistry()
    expect(() =>
      registry.registerCapability({
        extensions: [],
        id: 'shadow',
        tools: [tool(name)],
        version: '1',
      }),
    ).toThrow('reserved name')
  })

  it('validates executable publications without serializing their factories', () => {
    const createTools = () => [tool()]
    const registration = {
      createTools,
      extensions: [],
      id: 'plan',
      tools: createTools(),
      version: '1',
    }
    const publication = decodeCapabilityPublication({
      sourceId: 'test',
      registrations: [registration],
    })
    expect(publication?.registrations[0]?.createTools).toBe(createTools)
    expect(
      decodeCapabilityPublication({
        sourceId: 'test',
        registrations: [{ ...registration, createTools: 'not executable' }],
      }),
    ).toBeUndefined()
    expect(
      decodeCapabilityPublication({
        sourceId: 'test',
        registrations: [{ ...registration, tools: [{ name: 'fake' }] }],
      }),
    ).toBeUndefined()
  })

  it('rolls back a whole executable publication and allows a corrected retry', () => {
    const registry = new CapabilityRegistry()
    const first = { extensions: [], id: 'first', tools: [tool()], version: '1' }
    const invalid = {
      extensions: [],
      id: 'invalid',
      readonlyTools: ['write'],
      tools: [tool('write')],
      version: '1',
    }
    registry.registerProfile({ id: 'profile', registrations: ['first'] })
    expect(() => registry.registerCapabilities([first, invalid])).toThrow(
      'cannot be marked read-only',
    )
    expect(() => registry.resolve('profile')).toThrow('does not exist')
    registry.registerCapabilities([first, { ...invalid, readonlyTools: [] }])
    expect(registry.resolve('profile').tools).toEqual(['planning'])
  })

  it('rejects factory drift at registration and before activating child tools', async () => {
    const registry = new CapabilityRegistry()
    expect(() =>
      registry.registerCapability({
        createTools: () => [tool('unexpected')],
        extensions: [],
        id: 'drift',
        tools: [tool()],
        version: '1',
      }),
    ).toThrow('changed its tool names or schemas')
    let changed = false
    registry.registerCapability({
      createTools: () => [
        tool('planning', Type.Object({ item: changed ? Type.Number() : Type.String() })),
      ],
      extensions: [],
      id: 'stable',
      tools: [tool()],
      version: '1',
    })
    registry.registerProfile({ id: 'profile', registrations: ['stable'] })
    changed = true
    const extension = registry.resolve('profile').extensions[0]
    if (extension === undefined) throw new Error('Expected capability extension')
    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.cwd(),
      noExtensions: true,
      noSkills: true,
      noThemes: true,
      noPromptTemplates: true,
      extensionFactories: [extension],
    })
    await loader.reload()
    expect(loader.getExtensions().errors[0]?.error).toContain('changed its tool names or schemas')
  })
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

  it('keeps resumed profiles pinned to persisted registrations, extensions, tools and depth', () => {
    const registry = new CapabilityRegistry()
    registry.registerCapability({
      extensions: [],
      id: 'plan',
      readonlyTools: ['planning'],
      tools: [tool()],
      version: '2',
    })
    registry.registerProfile({ id: 'owner', nested: { maxDepth: 3 }, registrations: ['plan'] })
    const contract = registry.resolve('owner', true).contract
    expect(registry.resolveContract(contract, true).contract).toEqual(contract)
    const changes: Partial<CapabilityContract>[] = [
      { registrations: [{ id: 'plan', version: '1' }] },
      { extensions: [] },
      { tools: [] },
      { nested: { enabled: false } },
    ]
    for (const change of changes) {
      expect(() => registry.resolveContract({ ...contract, ...change }, true)).toThrow(
        'persisted capability contract is unavailable or changed',
      )
    }
  })

  it('does not accept a new provider on resume merely because its tool names match', () => {
    const original = new CapabilityRegistry()
    original.registerCapability({ extensions: [], id: 'plan', tools: [tool()], version: '1' })
    original.registerProfile({ id: 'owner', registrations: ['plan'] })
    const contract = original.resolve('owner').contract
    const replacement = new CapabilityRegistry()
    replacement.registerCapability({
      extensions: [],
      id: 'replacement',
      tools: [tool()],
      version: '1',
    })
    replacement.registerProfile({ id: 'owner', registrations: ['replacement'] })
    expect(replacement.resolve('owner').tools).toEqual(contract.tools)
    expect(() => replacement.resolveContract(contract, false)).toThrow(
      'persisted capability contract is unavailable or changed',
    )
  })

  it('bounds nested depth', () => {
    const registry = new CapabilityRegistry()

    expect(() =>
      registry.registerProfile({ id: 'too-deep', nested: { maxDepth: 17 }, registrations: [] }),
    ).toThrow('from 1 through 16')
  })
})

describe('configured model enforcement', () => {
  it('rejects explicit models outside each enforced policy', () => {
    expect(() =>
      selectCapabilityModel(
        [
          {
            status: 'valid',
            enforcement: 'configured',
            roles: [{ role: 'feature', selectors: ['allowed'] }],
          },
        ],
        'feature',
        'outside',
      ),
    ).toThrow('configured')
  })
})

describe('model policy selection compatibility', () => {
  const policy: CapabilityModelPolicy = {
    status: 'valid',
    enforcement: 'configured',
    roles: [
      { role: 'scalar', selectors: ['chosen'] },
      { role: 'panel', selectors: ['chosen', 'auto'] },
      { role: 'unconfigured', selectors: [] },
    ],
  }
  it('preserves scalar, panel, aliases and unconfigured roles', () => {
    expect(selectCapabilityModel([policy], 'scalar', undefined)).toBe('chosen')
    expect(() => selectCapabilityModel([policy], 'panel', undefined)).toThrow('distinct choices')
    for (const alias of ['auto', 'inherit', 'default', 'inherit-parent'])
      expect(selectCapabilityModel([policy], 'panel', alias)).toBe(alias)
    expect(selectCapabilityModel([policy], 'unconfigured', 'outside')).toBe('outside')
    expect(
      selectCapabilityModel([{ status: 'valid', roles: policy.roles }], 'scalar', 'outside'),
    ).toBe('outside')
    expect(() => selectCapabilityModel([policy], undefined, 'chosen')).toThrow('exact Task.role')
    expect(() => selectCapabilityModel([policy], 'unknown', 'chosen')).toThrow('Unknown')
    expect(() =>
      selectCapabilityModel(
        [
          policy,
          {
            status: 'valid',
            enforcement: 'configured',
            roles: [{ role: 'scalar', selectors: ['other'] }],
          },
        ],
        'scalar',
        'chosen',
      ),
    ).toThrow('configured')
  })

  it('updates same-source policies atomically without transferring ownership or changing contracts', () => {
    const registry = new CapabilityRegistry()
    const registration = {
      id: 'policy',
      version: '1',
      extensions: [],
      tools: [],
      modelPolicy: policy,
    }
    registry.publishCapabilities({ sourceId: 'owner', registrations: [registration] })
    registry.registerProfile({ id: 'profile', registrations: ['policy'] })
    const invalid: CapabilityModelPolicy = { status: 'invalid', error: 'bad file' }
    registry.publishCapabilities({
      sourceId: 'owner',
      registrations: [{ ...registration, modelPolicy: invalid, systemPrompt: 'Updated selectors' }],
    })
    expect(() =>
      selectCapabilityModel(registry.resolve('profile').modelPolicies, 'scalar', 'chosen'),
    ).toThrow('bad file')
    expect(() =>
      registry.publishCapabilities({ sourceId: 'stranger', registrations: [registration] }),
    ).toThrow('another source')
    expect(() =>
      registry.publishCapabilities({
        sourceId: 'owner',
        registrations: [registration, { ...registration, id: 'bad id' }],
      }),
    ).toThrow('invalid')
    expect(registry.resolve('profile').modelPolicies).toEqual([invalid])
    expect(() =>
      registry.publishCapabilities({
        sourceId: 'owner',
        registrations: [{ ...registration, tools: [tool()] }],
      }),
    ).toThrow('changed its contract')
    registry.publishCapabilities({ sourceId: 'owner', registrations: [registration] })
    expect(registry.resolve('profile').modelPolicies).toEqual([policy])
  })
})
