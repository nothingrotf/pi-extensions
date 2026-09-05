import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const CatalogSchema = Type.Object({
  models: Type.Array(
    Type.Object({
      slug: Type.String(),
      service_tiers: Type.Optional(
        Type.Array(Type.Object({ id: Type.String(), name: Type.Optional(Type.String()) })),
      ),
      additional_speed_tiers: Type.Optional(Type.Array(Type.String())),
    }),
  ),
})

const PayloadSchema = Type.Object({}, { additionalProperties: true })

const knownFastModels = new Set([
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
])

export interface FastModel {
  api: string
  id: string
  provider: string
}

export type FastSupport =
  | { supported: true; tier: 'priority' | 'fast'; source: 'catalog' | 'builtin' }
  | { supported: false; reason: string }

export function codexCatalogPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'models_cache.json')
}

export function getFastSupport(
  model: FastModel | undefined,
  catalogPath = codexCatalogPath(),
): FastSupport {
  if (model?.provider !== 'openai-codex' || model.api !== 'openai-codex-responses') {
    return { supported: false, reason: 'Fast Mode requires the OpenAI Codex Responses provider.' }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'))
    if (Value.Check(CatalogSchema, parsed)) {
      const entry = parsed.models.find((candidate) => candidate.slug === model.id)
      if (entry?.service_tiers !== undefined) {
        const tier = entry.service_tiers.find(
          (candidate) => candidate.id === 'priority' || candidate.id === 'fast',
        )?.id
        if (tier === 'priority' || tier === 'fast') {
          return { supported: true, tier, source: 'catalog' }
        }
        return { supported: false, reason: 'The Codex catalog does not advertise a Fast tier.' }
      }
      if (entry?.additional_speed_tiers !== undefined) {
        return entry.additional_speed_tiers.includes('fast')
          ? { supported: true, tier: 'priority', source: 'catalog' }
          : { supported: false, reason: 'The Codex catalog does not advertise a Fast tier.' }
      }
    }
  } catch {
    return knownFastSupport(model)
  }
  return knownFastSupport(model)
}

function knownFastSupport(model: FastModel): FastSupport {
  return knownFastModels.has(model.id)
    ? { supported: true, tier: 'priority', source: 'builtin' }
    : { supported: false, reason: 'Fast Mode support is unknown for this model.' }
}

export function applyFastTier<Input>(payload: Input, tier: 'priority' | 'fast'): Input | object {
  if (!Value.Check(PayloadSchema, payload)) {
    throw new Error('The provider request payload is not an object.')
  }
  return { ...payload, service_tier: tier }
}
