import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ProviderStreamEvent } from '@earendil-works/pi-coding-agent'
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

const ResponseEventSchema = Type.Object({
  type: Type.Union([
    Type.Literal('response.completed'),
    Type.Literal('response.done'),
    Type.Literal('response.incomplete'),
  ]),
  response: Type.Object({ service_tier: Type.String() }),
})

const fastTransports = new Set(['openai:openai-responses', 'openai-codex:openai-codex-responses'])

export type AcceleratedSpeed = 'fast' | 'ultrafast'
export type Speed = 'standard' | AcceleratedSpeed
export type ServiceTier = 'priority' | 'fast' | 'ultrafast'

interface SpeedProfile {
  defaultTier: ServiceTier
  knownModels: ReadonlySet<string>
  label: string
}

const speedProfiles: { fast: SpeedProfile; ultrafast: SpeedProfile } = {
  fast: {
    defaultTier: 'priority',
    knownModels: new Set([
      'gpt-5.4',
      'gpt-5.5',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-6-astra',
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-6.1-sol',
      'gpt-6.1-terra',
      'gpt-6.2-astra',
      'gpt-6.2-sol',
    ]),
    label: 'Fast',
  },
  ultrafast: {
    defaultTier: 'ultrafast',
    knownModels: new Set(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.2-astra', 'gpt-6.2-sol']),
    label: 'Ultrafast',
  },
}

export interface FastModel {
  api: string
  id: string
  provider: string
}

export type FastSupport =
  | { supported: true; tier: ServiceTier; source: 'catalog' | 'builtin' }
  | { supported: false; reason: string }

export function speedLabel(speed: AcceleratedSpeed): string {
  return speedProfiles[speed].label
}

export function codexCatalogPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'models_cache.json')
}

function catalogTier(speed: AcceleratedSpeed, ids: readonly string[]): ServiceTier | undefined {
  if (speed === 'ultrafast') return ids.includes('ultrafast') ? 'ultrafast' : undefined
  return ids.find((id): id is 'priority' | 'fast' => id === 'priority' || id === 'fast')
}

export function getSpeedSupport(
  model: FastModel | undefined,
  speed: AcceleratedSpeed,
  catalogPath = codexCatalogPath(),
): FastSupport {
  const label = speedLabel(speed)
  if (model === undefined || !fastTransports.has(`${model.provider}:${model.api}`)) {
    return {
      supported: false,
      reason: `${label} Mode requires the OpenAI or OpenAI Codex Responses provider.`,
    }
  }
  const denied: FastSupport = {
    supported: false,
    reason: `The Codex catalog does not advertise the ${label} tier.`,
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(catalogPath, 'utf8'))
    if (Value.Check(CatalogSchema, parsed)) {
      const entry = parsed.models.find((candidate) => candidate.slug === model.id)
      if (entry?.service_tiers !== undefined) {
        const tier = catalogTier(
          speed,
          entry.service_tiers.map((candidate) => candidate.id),
        )
        return tier === undefined ? denied : { supported: true, tier, source: 'catalog' }
      }
      if (entry?.additional_speed_tiers !== undefined) {
        return entry.additional_speed_tiers.includes(speed)
          ? {
              supported: true,
              tier: speedProfiles[speed].defaultTier,
              source: 'catalog',
            }
          : denied
      }
    }
  } catch {
    return knownSupport(model, speed)
  }
  return knownSupport(model, speed)
}

function knownSupport(model: FastModel, speed: AcceleratedSpeed): FastSupport {
  return speedProfiles[speed].knownModels.has(model.id)
    ? { supported: true, tier: speedProfiles[speed].defaultTier, source: 'builtin' }
    : { supported: false, reason: `${speedLabel(speed)} Mode support is unknown for this model.` }
}

export function reportedServiceTier(event: ProviderStreamEvent): string | undefined {
  if (event.api !== 'openai-responses' || !Value.Check(ResponseEventSchema, event.data)) {
    return undefined
  }
  return event.data.response.service_tier
}

export function isSpeedTier(speed: AcceleratedSpeed, tier: string): boolean {
  return speed === 'ultrafast' ? tier === 'ultrafast' : tier === 'priority' || tier === 'fast'
}

export function applyServiceTier<Input>(payload: Input, tier: ServiceTier): Input | object {
  if (!Value.Check(PayloadSchema, payload)) {
    throw new Error('The provider request payload is not an object.')
  }
  return { ...payload, service_tier: tier }
}
