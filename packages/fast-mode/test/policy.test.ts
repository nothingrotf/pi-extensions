import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  applyServiceTier,
  getSpeedSupport,
  isSpeedTier,
  reportedServiceTier,
  type FastModel,
} from '../src/policy.ts'
import { loadSpeed, saveSpeed } from '../src/state.ts'

const directories: string[] = []

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-fast-policy-'))
  directories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const getFastSupport = (model: FastModel | undefined, catalogPath?: string) =>
  getSpeedSupport(model, 'fast', catalogPath)

const astra = { api: 'openai-codex-responses', id: 'gpt-6-astra', provider: 'openai-codex' }

describe('Fast Mode capability policy', () => {
  it('supports verified Codex models without a catalog and rejects other transports', () => {
    for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol', 'gpt-6.1-terra']) {
      expect(getFastSupport({ ...astra, id }, '/missing/catalog.json')).toEqual({
        supported: true,
        tier: 'priority',
        source: 'builtin',
      })
    }
    expect(
      getFastSupport({ ...astra, id: 'future-model' }, '/missing/catalog.json').supported,
    ).toBe(false)
    expect(getFastSupport({ ...astra, api: 'openai-completions' }).supported).toBe(false)
    expect(getFastSupport({ ...astra, provider: 'openai' }).supported).toBe(false)
    expect(getFastSupport({ ...astra, api: 'openai-responses' }).supported).toBe(false)
    expect(
      getFastSupport(
        { api: 'openai-responses', id: 'gpt-6.1-terra', provider: 'openai' },
        '/missing/catalog.json',
      ),
    ).toEqual({ supported: true, tier: 'priority', source: 'builtin' })
    expect(getFastSupport(undefined).supported).toBe(false)
  })

  it('reads the processed tier only from public Responses API completion events', () => {
    const event = {
      type: 'provider_stream_event' as const,
      provider: 'openai',
      api: 'openai-responses',
      model: 'gpt-6.1-sol',
      data: { type: 'response.completed', response: { service_tier: 'default' } },
    }
    expect(reportedServiceTier(event)).toBe('default')
    expect(reportedServiceTier({ ...event, api: 'openai-codex-responses' })).toBeUndefined()
    expect(
      reportedServiceTier({ ...event, data: { type: 'response.output_text.delta' } }),
    ).toBeUndefined()
    expect(
      reportedServiceTier({ ...event, data: { type: 'response.completed', response: {} } }),
    ).toBeUndefined()
  })

  it('uses explicit catalog capabilities instead of model-name guesses', async () => {
    const path = join(await fixture(), 'catalog.json')
    await writeFile(
      path,
      JSON.stringify({
        models: [
          { slug: 'future-model', service_tiers: [{ id: 'fast' }] },
          { slug: 'gpt-6-astra', service_tiers: [], additional_speed_tiers: ['fast'] },
          { slug: 'gpt-6-sol', service_tiers: [] },
          { slug: 'gpt-6.1-sol', service_tiers: [] },
          { slug: 'gpt-6.1-terra', service_tiers: [] },
          { slug: 'gpt-6-luna', service_tiers: [{ id: 'fast' }] },
          { slug: 'legacy-catalog-model', additional_speed_tiers: ['fast'] },
        ],
      }),
    )
    expect(getFastSupport({ ...astra, id: 'future-model' }, path)).toEqual({
      supported: true,
      tier: 'fast',
      source: 'catalog',
    })
    expect(getFastSupport(astra, path).supported).toBe(false)
    expect(getFastSupport({ ...astra, id: 'gpt-6-sol' }, path).supported).toBe(false)
    expect(getFastSupport({ ...astra, id: 'gpt-6.1-sol' }, path).supported).toBe(false)
    expect(getFastSupport({ ...astra, id: 'gpt-6.1-terra' }, path).supported).toBe(false)
    expect(getFastSupport({ ...astra, id: 'gpt-6-luna' }, path)).toEqual({
      supported: true,
      tier: 'fast',
      source: 'catalog',
    })
    expect(getFastSupport({ ...astra, id: 'legacy-catalog-model' }, path)).toEqual({
      supported: true,
      tier: 'priority',
      source: 'catalog',
    })
  })

  it('gates Ultrafast on its own catalog tier and documented models', async () => {
    const sol = { ...astra, id: 'gpt-6.2-sol' }
    for (const id of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-6.2-sol']) {
      expect(getSpeedSupport({ ...astra, id }, 'ultrafast', '/missing/catalog.json')).toEqual({
        supported: true,
        tier: 'ultrafast',
        source: 'builtin',
      })
    }
    expect(
      getSpeedSupport({ ...astra, id: 'gpt-6.1-terra' }, 'ultrafast', '/missing/catalog.json')
        .supported,
    ).toBe(false)
    const path = join(await fixture(), 'catalog.json')
    await writeFile(
      path,
      JSON.stringify({
        models: [
          { slug: 'gpt-6.2-sol', service_tiers: [{ id: 'priority' }, { id: 'ultrafast' }] },
          { slug: 'gpt-6.2-astra', service_tiers: [{ id: 'priority' }] },
          { slug: 'gpt-6.1-sol', additional_speed_tiers: ['fast', 'ultrafast'] },
        ],
      }),
    )
    expect(getSpeedSupport(sol, 'ultrafast', path)).toEqual({
      supported: true,
      tier: 'ultrafast',
      source: 'catalog',
    })
    expect(getSpeedSupport(sol, 'fast', path)).toEqual({
      supported: true,
      tier: 'priority',
      source: 'catalog',
    })
    expect(getSpeedSupport({ ...astra, id: 'gpt-6.2-astra' }, 'ultrafast', path)).toEqual({
      supported: false,
      reason: 'The Codex catalog does not advertise the Ultrafast tier.',
    })
    expect(getSpeedSupport({ ...astra, id: 'gpt-6.1-sol' }, 'ultrafast', path)).toEqual({
      supported: true,
      tier: 'ultrafast',
      source: 'catalog',
    })
    expect(isSpeedTier('ultrafast', 'ultrafast')).toBe(true)
    expect(isSpeedTier('ultrafast', 'priority')).toBe(false)
    expect(isSpeedTier('fast', 'priority')).toBe(true)
  })

  it('preserves request fields without mutating the input', () => {
    const payload = {
      text: { verbosity: 'high' },
      reasoning: { effort: 'max' },
      input: [],
      service_tier: 'default',
    }
    expect(applyServiceTier(payload, 'priority')).toEqual({ ...payload, service_tier: 'priority' })
    expect(payload.service_tier).toBe('default')
    expect(() => applyServiceTier(null, 'priority')).toThrow(
      'The provider request payload is not an object.',
    )
  })
})

describe('Fast Mode preference', () => {
  it('defaults to off and stores changes atomically in the selected profile', async () => {
    const path = join(await fixture(), 'state', 'fast-mode.json')
    expect(await loadSpeed(path)).toBe('standard')
    for (const speed of ['fast', 'ultrafast', 'standard'] as const) {
      await saveSpeed(path, speed)
      expect(await loadSpeed(path)).toBe(speed)
    }
  })

  it('reads the legacy enabled preference', async () => {
    const path = join(await fixture(), 'fast-mode.json')
    await writeFile(path, JSON.stringify({ enabled: true }))
    expect(await loadSpeed(path)).toBe('fast')
    await writeFile(path, JSON.stringify({ enabled: false }))
    expect(await loadSpeed(path)).toBe('standard')
  })

  it('rejects malformed preferences instead of silently enabling Fast Mode', async () => {
    const path = join(await fixture(), 'fast-mode.json')
    await writeFile(path, JSON.stringify({ enabled: 'true' }))
    await expect(loadSpeed(path)).rejects.toThrow('The Fast Mode state is invalid.')
  })
})
