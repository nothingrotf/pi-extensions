import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { applyFastTier, getFastSupport, reportedServiceTier } from '../src/policy.ts'
import { loadFastMode, saveFastMode } from '../src/state.ts'

const directories: string[] = []

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pi-fast-policy-'))
  directories.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const astra = { api: 'openai-codex-responses', id: 'gpt-6-astra', provider: 'openai-codex' }

describe('Fast Mode capability policy', () => {
  it('supports verified Codex models without a catalog and rejects other transports', () => {
    for (const id of ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6.1-sol']) {
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
        { api: 'openai-responses', id: 'gpt-6.1-sol', provider: 'openai' },
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

  it('preserves request fields without mutating the input', () => {
    const payload = {
      text: { verbosity: 'high' },
      reasoning: { effort: 'max' },
      input: [],
      service_tier: 'default',
    }
    expect(applyFastTier(payload, 'priority')).toEqual({ ...payload, service_tier: 'priority' })
    expect(payload.service_tier).toBe('default')
    expect(() => applyFastTier(null, 'priority')).toThrow(
      'The provider request payload is not an object.',
    )
  })
})

describe('Fast Mode preference', () => {
  it('defaults to off and stores changes atomically in the selected profile', async () => {
    const path = join(await fixture(), 'state', 'fast-mode.json')
    expect(await loadFastMode(path)).toBe(false)
    await saveFastMode(path, true)
    expect(await loadFastMode(path)).toBe(true)
    await saveFastMode(path, false)
    expect(await loadFastMode(path)).toBe(false)
  })

  it('rejects malformed preferences instead of silently enabling Fast Mode', async () => {
    const path = join(await fixture(), 'fast-mode.json')
    await writeFile(path, JSON.stringify({ enabled: 'true' }))
    await expect(loadFastMode(path)).rejects.toThrow('The Fast Mode state is invalid.')
  })
})
