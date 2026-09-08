import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import {
  CapabilityRegistry,
  decodeCapabilityPublication,
  selectCapabilityModel,
} from '../../subagent/src/capabilities.ts'
import {
  loadPstackModelPolicy,
  parsePstackModelPolicy,
  pstackRoles,
  renderPstackModelPolicy,
} from '../src/model-policy.ts'

const scalar = 'pstack-test/configured:high'

describe('pstack model policy parser', () => {
  it('parses the documented setup file and configures every registered role', async () => {
    const setup = await readFile(
      new URL('../skills/setup-pstack/SKILL.md', import.meta.url),
      'utf8',
    )
    const example = setup.match(/```\n([\s\S]*?)\n```/)?.[1]
    expect(example).toBeDefined()
    const parsed = parsePstackModelPolicy(example ?? '')
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') throw new Error(parsed.error)
    expect(parsed.roles).toHaveLength(pstackRoles.length)
    expect(parsed.roles.every((entry) => entry.selectors.length > 0)).toBe(true)
    expect(parsed.roles.find((entry) => entry.role === 'reflect divergent')?.selectors).toEqual([
      'inherit-parent',
    ])
  })

  it('accepts legacy how critics configuration without publishing the obsolete role', () => {
    const parsed = parsePstackModelPolicy(
      'how critics: inherit-parent, provider/model:high\nhow explorer: inherit-parent',
    )
    expect(parsed.status).toBe('valid')
    if (parsed.status !== 'valid') throw new Error(parsed.error)
    expect(parsed.roles).toHaveLength(pstackRoles.length)
    expect(parsed.roles.some((entry) => entry.role === 'how critics')).toBe(false)
    expect(parsed.roles.find((entry) => entry.role === 'how explorer')?.selectors).toEqual([
      'inherit-parent',
    ])
  })

  it.each([
    'how explorer: ',
    'how explorer: auto, inherit-parent',
    'arena runners: auto,',
    'arena runners: ,auto',
    'feature, feature: auto',
    'reflect divergent: auto\ndivergent: auto',
    'reflect judgment, divergent, synthesizer: auto\nreflect synthesizer: auto',
    'missing role: auto',
    'how explorer: auto [fast]',
    'how explorer: provider/model:ultra',
    'how explorer: provider/model:off [fast] trailing',
    'how explorer: provider/<instructions>:off',
    `how explorer: provider/${'a'.repeat(1024)}:off`,
    'x'.repeat(65537),
  ])('rejects malformed or duplicate configuration (%s)', (content) => {
    expect(parsePstackModelPolicy(content).status).toBe('invalid')
  })

  it('distinguishes unconfigured fallback from explicit parent selection', () => {
    const rendered = renderPstackModelPolicy(parsePstackModelPolicy('feature: inherit-parent'))
    expect(rendered).toContain('feature: inherit-parent')
    expect(rendered).toContain(
      'how explorer: unconfigured; agent default then parent; skill owns count',
    )
    expect(rendered).not.toContain('inherit-parent (unconfigured')
  })

  it('ignores metadata and comments rather than injecting raw policy text', () => {
    const parsed = parsePstackModelPolicy(
      `---\ndescription: RAW_METADATA_SENTINEL\nalwaysApply: true\n---\n# RAW_COMMENT_SENTINEL\nhow explorer: ${scalar}\n`,
    )
    expect(parsed.status).toBe('valid')
    const rendered = renderPstackModelPolicy(parsed)
    expect(rendered).toContain(`how explorer: ${scalar}`)
    expect(rendered).not.toContain('RAW_METADATA_SENTINEL')
    expect(rendered).not.toContain('RAW_COMMENT_SENTINEL')
    const invalid = renderPstackModelPolicy(parsePstackModelPolicy('RAW_INVALID_SENTINEL'))
    expect(invalid).not.toContain('RAW_INVALID_SENTINEL')
  })

  it('loads only the supplied local path and distinguishes missing from unreadable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pstack-policy-'))
    const path = join(dir, 'policy.md')
    try {
      expect(await loadPstackModelPolicy({ modelPolicyPath: path })).toEqual(
        parsePstackModelPolicy(''),
      )
      await mkdir(path)
      expect((await loadPstackModelPolicy({ modelPolicyPath: path })).status).toBe('invalid')
      await rm(path, { recursive: true })
      await writeFile(path, `how explorer: ${scalar}`)
      expect(await loadPstackModelPolicy({ modelPolicyPath: path })).toEqual(
        parsePstackModelPolicy(`how explorer: ${scalar}`),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('generic capability model policy boundary', () => {
  it('decodes, snapshots and resolves policy through the existing registration', () => {
    const policy = parsePstackModelPolicy(`how explorer: ${scalar}`)
    const publication = decodeCapabilityPublication({
      sourceId: 'fixture',
      registrations: [
        { id: 'policy', version: '1', extensions: [], tools: [], modelPolicy: policy },
      ],
    })
    expect(publication).toBeDefined()
    if (publication === undefined) throw new Error('Publication missing')
    const registry = new CapabilityRegistry()
    registry.registerProfiles([{ id: 'fixture', registrations: ['policy'] }])
    registry.registerCapabilities(publication.registrations)
    if (policy.status === 'valid') {
      const entry = policy.roles.find((role) => role.role === 'how explorer')
      if (entry !== undefined) entry.selectors = ['auto']
    }
    const resolved = registry.resolve('fixture')
    expect(selectCapabilityModel(resolved.modelPolicies, 'how explorer', undefined)).toBe(scalar)
    expect(registry.resolve(undefined).modelPolicies).toEqual([])
  })

  it('rejects invalid publication shapes and duplicate exact roles', () => {
    expect(
      decodeCapabilityPublication({
        sourceId: 'fixture',
        registrations: [
          {
            id: 'policy',
            version: '1',
            extensions: [],
            tools: [],
            modelPolicy: { roles: { feature: 'auto' } },
          },
        ],
      }),
    ).toBeUndefined()
    const registry = new CapabilityRegistry()
    expect(() =>
      registry.registerCapability({
        id: 'policy',
        version: '1',
        extensions: [],
        tools: [],
        modelPolicy: {
          status: 'valid',
          roles: [
            { role: 'feature', selectors: ['auto'] },
            { role: 'feature', selectors: ['auto'] },
          ],
        },
      }),
    ).toThrow('duplicate model policy roles')
  })

  it('matches roles across capabilities and fails conflicting omitted choices', () => {
    const policies = [
      parsePstackModelPolicy(`feature: ${scalar}`),
      parsePstackModelPolicy('feature: inherit-parent'),
    ]
    expect(() => selectCapabilityModel(policies, 'feature', undefined)).toThrow('distinct choices')
    expect(() => selectCapabilityModel(policies, 'feature', 'auto')).toThrow('configured')
    expect(
      selectCapabilityModel(
        [
          { status: 'valid', roles: [{ role: 'other', selectors: ['auto'] }] },
          { status: 'valid', roles: [{ role: 'feature', selectors: [scalar] }] },
        ],
        'feature',
        undefined,
      ),
    ).toBe(scalar)
  })
})
