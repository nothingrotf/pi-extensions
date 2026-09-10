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
    const example = setup.match(
      /```text\n(---\ndescription: pstack per-role model choices[\s\S]*?)\n```/,
    )?.[1]
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

  it('separates review pools and scalar publication from prose', () => {
    const policy = parsePstackModelPolicy(
      [
        `judgment and prose: ${scalar}`,
        'code review: provider/reviewer:medium, provider/alternate:low',
        'runtime verification: provider/runtime:high, provider/alternate:low',
        'publication: provider/publisher:low',
      ].join('\n'),
    )
    expect(policy.status).toBe('valid')
    expect(selectCapabilityModel([policy], 'code review', 'provider/reviewer:medium')).toBe(
      'provider/reviewer:medium',
    )
    expect(selectCapabilityModel([policy], 'runtime verification', 'provider/runtime:high')).toBe(
      'provider/runtime:high',
    )
    expect(selectCapabilityModel([policy], 'publication', undefined)).toBe('provider/publisher:low')
    expect(selectCapabilityModel([policy], 'judgment and prose', undefined)).toBe(scalar)
    expect(() => selectCapabilityModel([policy], 'code review', undefined)).toThrow(
      'distinct choices',
    )
    expect(() => selectCapabilityModel([policy], 'code review', 'provider/publisher:low')).toThrow(
      'configured selectors',
    )
    expect(parsePstackModelPolicy('publication: auto, inherit-parent').status).toBe('invalid')
  })

  it('derives new delivery roles from existing approved choices without editing legacy files', () => {
    const policy = parsePstackModelPolicy(
      [
        `judgment and prose: ${scalar}`,
        'arena cross-judge pool: provider/reviewer:medium, provider/alternate:low',
      ].join('\n'),
    )
    expect(policy.status).toBe('valid')
    if (policy.status !== 'valid') throw new Error(policy.error)
    for (const role of ['code review', 'runtime verification']) {
      expect(policy.roles.find((entry) => entry.role === role)?.selectors).toEqual([
        'provider/reviewer:medium',
        'provider/alternate:low',
      ])
      expect(selectCapabilityModel([policy], role, 'provider/alternate:low')).toBe(
        'provider/alternate:low',
      )
      expect(() => selectCapabilityModel([policy], role, undefined)).toThrow('distinct choices')
      expect(() => selectCapabilityModel([policy], role, scalar)).toThrow('configured selectors')
    }
    expect(selectCapabilityModel([policy], 'publication', undefined)).toBe(scalar)
    expect(selectCapabilityModel([policy], 'judgment and prose', undefined)).toBe(scalar)
    const review = policy.roles.find((entry) => entry.role === 'code review')
    expect(review?.selectors).not.toBe(
      policy.roles.find((entry) => entry.role === 'runtime verification')?.selectors,
    )
    expect(review?.selectors).not.toBe(
      policy.roles.find((entry) => entry.role === 'arena cross-judge pool')?.selectors,
    )
  })

  it.each([false, true])(
    'lets explicit delivery settings override legacy defaults regardless of order (%s)',
    (reverse) => {
      const lines = [
        `judgment and prose: ${scalar}`,
        'arena cross-judge pool: provider/reviewer:medium, provider/alternate:low',
        'code review: inherit-parent',
        'runtime verification: provider/runtime:low',
        'publication: provider/publisher:off',
      ]
      const policy = parsePstackModelPolicy((reverse ? lines.reverse() : lines).join('\n'))
      expect(selectCapabilityModel([policy], 'code review', undefined)).toBe('inherit-parent')
      expect(selectCapabilityModel([policy], 'runtime verification', undefined)).toBe(
        'provider/runtime:low',
      )
      expect(selectCapabilityModel([policy], 'publication', undefined)).toBe(
        'provider/publisher:off',
      )
    },
  )

  it('keeps delivery fallback bounded when only prose or no models are configured', () => {
    for (const role of ['code review', 'runtime verification', 'publication']) {
      expect(
        selectCapabilityModel(
          [parsePstackModelPolicy(`judgment and prose: ${scalar}`)],
          role,
          undefined,
        ),
      ).toBe(scalar)
      expect(selectCapabilityModel([parsePstackModelPolicy('')], role, undefined)).toBeUndefined()
    }
  })

  it('permits a different review family without relaxing scalar implementation policy', () => {
    const implementation = 'openai-codex/gpt-5.6-sol:medium [fast]'
    const reviewer = 'anthropic/claude-fable-5-1:medium'
    const alternate = 'openai-codex/gpt-6-astra:low'
    const policy = parsePstackModelPolicy(
      [
        `feature: ${implementation}`,
        `judgment and prose: ${implementation}`,
        `code review: ${reviewer}, ${alternate}`,
        `runtime verification: ${reviewer}, ${alternate}`,
      ].join('\n'),
    )
    for (const role of ['code review', 'runtime verification']) {
      expect(selectCapabilityModel([policy], role, reviewer)).toBe(reviewer)
      expect(selectCapabilityModel([policy], role, alternate)).toBe(alternate)
      expect(() => selectCapabilityModel([policy], role, 'unconfigured/reviewer:high')).toThrow(
        'configured selectors',
      )
    }
    expect(selectCapabilityModel([policy], 'feature', undefined)).toBe(implementation)
    expect(() => selectCapabilityModel([policy], 'judgment and prose', reviewer)).toThrow(
      'configured selectors',
    )
    expect(() => selectCapabilityModel([policy], 'feature', reviewer)).toThrow(
      'configured selectors',
    )
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
    expect(rendered).toContain(
      'code review and runtime verification inherit arena cross-judge pool, then judgment and prose',
    )
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
