import type { InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { type StaticDecode, Type, type TSchema } from 'typebox'
import { Value } from 'typebox/value'

import { TaskRoleSchema, type CapabilityContract } from './schema.ts'

export type CapabilityToolDefinition = ToolDefinition<TSchema, unknown, unknown>

export interface RoleModelPolicyEntry {
  role: string
  selectors: readonly string[]
}

export type CapabilityModelPolicy =
  | { status: 'valid'; enforcement?: 'configured'; roles: readonly RoleModelPolicyEntry[] }
  | { status: 'invalid'; error: string }

export interface CapabilityRegistration {
  modelPolicy?: CapabilityModelPolicy
  createTools?: () => readonly CapabilityToolDefinition[]
  extensions: readonly InlineExtension[]
  id: string
  readonlyTools?: readonly string[]
  systemPrompt?: string
  tools: readonly CapabilityToolDefinition[]
  version: string
}

export interface CapabilityProfile {
  id: string
  nested?: { maxDepth: number }
  registrations: readonly string[]
}

export interface ResolvedCapabilities {
  modelPolicies: readonly CapabilityModelPolicy[]
  contract: CapabilityContract
  extensions: readonly InlineExtension[]
  tools: readonly string[]
}

export function isCapabilitySubset(
  requested: CapabilityContract,
  approved: CapabilityContract,
): boolean {
  const identitiesMatch = (
    registrations: CapabilityContract['registrations'],
    allowed: CapabilityContract['registrations'],
  ): boolean =>
    registrations.every((registration) =>
      allowed.some(
        (entry) => entry.id === registration.id && entry.version === registration.version,
      ),
    )
  return (
    identitiesMatch(requested.registrations, approved.registrations) &&
    identitiesMatch(requested.extensions, approved.extensions) &&
    requested.tools.every((tool) => approved.tools.includes(tool)) &&
    (!requested.nested.enabled ||
      (approved.nested.enabled && requested.nested.maxDepth <= approved.nested.maxDepth))
  )
}

const MAX_NESTED_DEPTH = 16

const CapabilityProfileSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    nested: Type.Optional(
      Type.Object(
        { maxDepth: Type.Integer({ maximum: MAX_NESTED_DEPTH, minimum: 1 }) },
        { additionalProperties: false },
      ),
    ),
    registrations: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  { additionalProperties: false },
)

const CapabilityProfileRegistrationSchema = Type.Object(
  {
    profiles: Type.Array(CapabilityProfileSchema, { maxItems: 32, minItems: 1 }),
    sourceId: Type.String({ maxLength: 128, minLength: 1 }),
  },
  { additionalProperties: false },
)

export interface CapabilityProfileRegistration {
  profiles: readonly CapabilityProfile[]
  sourceId: string
}

export function decodeCapabilityProfileRegistration<Input>(
  value: Input,
): CapabilityProfileRegistration | undefined {
  if (!Value.Check(CapabilityProfileRegistrationSchema, value)) return undefined
  const decoded: StaticDecode<typeof CapabilityProfileRegistrationSchema> = Value.Decode(
    CapabilityProfileRegistrationSchema,
    value,
  )
  return { profiles: decoded.profiles, sourceId: decoded.sourceId }
}

const CapabilityToolSchema = Type.Object({
  description: Type.String(),
  execute: Type.Function([], Type.Unknown()),
  label: Type.String(),
  name: Type.String({ minLength: 1 }),
  parameters: Type.Object({ type: Type.Optional(Type.String()) }),
})

const InlineExtensionSchema = Type.Object({
  factory: Type.Function([], Type.Unknown()),
  hidden: Type.Optional(Type.Boolean()),
  name: Type.String(),
})

const CapabilityModelPolicySchema = Type.Union([
  Type.Object(
    {
      status: Type.Literal('valid'),
      enforcement: Type.Optional(Type.Literal('configured')),
      roles: Type.Array(
        Type.Object(
          {
            role: TaskRoleSchema,
            selectors: Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 64 }),
          },
          { additionalProperties: false },
        ),
        { maxItems: 128 },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal('invalid'),
      error: Type.String({ minLength: 1, maxLength: 4096 }),
    },
    { additionalProperties: false },
  ),
])

function normalizeSelector(selector: string): string {
  return ['auto', 'inherit', 'default', 'inherit-parent'].includes(selector)
    ? 'inherit-parent'
    : selector
}

export function preservesMandatoryModelPolicies(
  required: readonly CapabilityModelPolicy[],
  requested: readonly CapabilityModelPolicy[],
): boolean {
  return required.every(
    (policy) =>
      (policy.status === 'valid' && policy.enforcement !== 'configured') ||
      requested.some((candidate) => JSON.stringify(candidate) === JSON.stringify(policy)),
  )
}

export function selectCapabilityModel(
  policies: readonly CapabilityModelPolicy[],
  role: string | undefined,
  explicit: string | undefined,
): string | undefined {
  const matches: RoleModelPolicyEntry[] = []
  for (const policy of policies) {
    if (policy.status === 'invalid') throw new Error(`Model policy is invalid. ${policy.error}`)
    if (role === undefined)
      throw new Error('This capability requires an exact Task.role for model selection.')
    const entry = policy.roles.find((candidate) => candidate.role === role)
    if (
      explicit !== undefined &&
      policy.enforcement === 'configured' &&
      entry !== undefined &&
      entry.selectors.length > 0 &&
      !entry.selectors.some(
        (selector) => normalizeSelector(selector) === normalizeSelector(explicit),
      )
    )
      throw new Error(
        `Task.model "${explicit}" is outside configured selectors for role "${role}".`,
      )
    if (entry !== undefined) matches.push(entry)
  }
  if (policies.length > 0 && matches.length === 0)
    throw new Error(`Unknown model policy role "${role}".`)
  if (explicit !== undefined) return explicit
  const distinct = new Set(matches.flatMap((entry) => entry.selectors).map(normalizeSelector))
  if (distinct.size > 1)
    throw new Error(
      `Model policy role "${role}" has distinct choices. Pass an explicit Task.model for this panel or pool entry, including inherit-parent for an inherited entry.`,
    )
  return distinct.values().next().value
}

const CapabilityRegistrationSchema = Type.Object(
  {
    createTools: Type.Optional(Type.Function([], Type.Unknown())),
    extensions: Type.Array(InlineExtensionSchema, { maxItems: 64 }),
    id: Type.String({ maxLength: 128, minLength: 1 }),
    modelPolicy: Type.Optional(CapabilityModelPolicySchema),
    readonlyTools: Type.Optional(Type.Array(Type.String(), { maxItems: 64, uniqueItems: true })),
    systemPrompt: Type.Optional(Type.String({ maxLength: 256 * 1024 })),
    tools: Type.Array(CapabilityToolSchema, { maxItems: 64 }),
    version: Type.String({ maxLength: 128, minLength: 1 }),
  },
  { additionalProperties: false },
)

export interface CapabilityPublication {
  registrations: readonly CapabilityRegistration[]
  sourceId: string
}

const CapabilityPublicationSchema = Type.Object(
  {
    registrations: Type.Array(CapabilityRegistrationSchema, { maxItems: 64, minItems: 1 }),
    sourceId: Type.String({ maxLength: 128, minLength: 1 }),
  },
  { additionalProperties: false },
)

function isCapabilityPublication<Input>(value: Input): value is Input & CapabilityPublication {
  return Value.Check(CapabilityPublicationSchema, value)
}

export function decodeCapabilityPublication<Input>(
  value: Input,
): CapabilityPublication | undefined {
  return isCapabilityPublication(value) ? value : undefined
}

function instantiateTools(
  registration: CapabilityRegistration,
): readonly CapabilityToolDefinition[] {
  const tools = registration.createTools?.() ?? registration.tools
  const valid = Value.Check(Type.Array(CapabilityToolSchema, { maxItems: 64 }), tools)
  if (!valid) {
    throw new Error(`Capability registration "${registration.id}" has invalid tools.`)
  }
  return tools
}

function validateToolContract(
  registration: CapabilityRegistration,
  tools: readonly CapabilityToolDefinition[],
): void {
  if (
    tools.length !== registration.tools.length ||
    tools.some((tool, index) => {
      const declared = registration.tools[index]
      return (
        declared === undefined ||
        tool.name !== declared.name ||
        JSON.stringify(tool.parameters) !== JSON.stringify(declared.parameters)
      )
    })
  ) {
    throw new Error(
      `Capability registration "${registration.id}" changed its tool names or schemas.`,
    )
  }
}

const KNOWN_MUTABLE_TOOLS = new Set(['bash', 'powershell', 'edit', 'write'])
const PRIVATE_TOOLS = new Set([
  'Task',
  'TaskControl',
  'ask_parent',
  'request_parent',
  'notify_parent',
  'update_progress',
  'send_peer',
  'receive_peers',
])

function validateIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`${label} "${value}" is invalid.`)
}

export class CapabilityRegistry {
  private readonly owners = new Map<string, string>()
  private readonly profiles = new Map<string, CapabilityProfile>()
  private readonly registrations = new Map<string, CapabilityRegistration>()

  publishCapabilities(publication: CapabilityPublication): void {
    const staged = new CapabilityRegistry()
    for (const [id, registration] of this.registrations) staged.registrations.set(id, registration)
    const ids = new Set<string>()
    for (const registration of publication.registrations) {
      if (ids.has(registration.id)) throw new Error(`Duplicate capability "${registration.id}".`)
      ids.add(registration.id)
      const previous = this.registrations.get(registration.id)
      if (previous !== undefined) {
        if (this.owners.get(registration.id) !== publication.sourceId)
          throw new Error(`Capability "${registration.id}" belongs to another source.`)
        const contract = (entry: CapabilityRegistration) =>
          JSON.stringify({
            version: entry.version,
            tools: entry.tools.map((tool) => ({ name: tool.name, parameters: tool.parameters })),
            extensions: entry.extensions.map((extension) => ({
              name: extension.name,
            })),
            readonlyTools: entry.readonlyTools ?? [],
          })
        if (contract(previous) !== contract(registration))
          throw new Error(`Capability "${registration.id}" republication changed its contract.`)
        staged.registrations.delete(registration.id)
      }
      staged.stageCapability(registration)
    }
    for (const id of ids) {
      const registration = staged.registrations.get(id)
      if (registration !== undefined) this.registrations.set(id, registration)
      this.owners.set(id, publication.sourceId)
    }
  }

  registerCapability(registration: CapabilityRegistration): void {
    this.registerCapabilities([registration])
  }

  registerCapabilities(registrations: readonly CapabilityRegistration[]): void {
    const staged = new CapabilityRegistry()
    for (const [id, registration] of this.registrations) staged.registrations.set(id, registration)
    for (const registration of registrations) staged.stageCapability(registration)
    for (const [id, registration] of staged.registrations) this.registrations.set(id, registration)
  }

  private stageCapability(registration: CapabilityRegistration): void {
    const valid = Value.Check(CapabilityRegistrationSchema, registration)
    if (!valid) {
      throw new Error(`Capability registration "${registration.id}" is invalid.`)
    }
    validateIdentifier(registration.id, 'Capability registration ID')
    if (registration.version.length === 0) throw new Error('A capability version cannot be empty.')
    if (this.registrations.has(registration.id)) {
      throw new Error(`Capability registration "${registration.id}" already exists.`)
    }
    const names = new Set<string>()
    for (const tool of registration.tools) {
      if (tool.parameters.type !== 'object') {
        throw new Error(`Capability tool "${tool.name}" parameters must declare type "object".`)
      }
      if (PRIVATE_TOOLS.has(tool.name) || tool.name.startsWith('subagent_')) {
        throw new Error(`Capability tool "${tool.name}" uses a reserved name.`)
      }
      if (names.has(tool.name)) {
        throw new Error(`Capability tool "${tool.name}" occurs more than once.`)
      }
      names.add(tool.name)
    }
    const readonlyTools = new Set<string>()
    for (const name of registration.readonlyTools ?? []) {
      if (!names.has(name)) {
        throw new Error(`Read-only capability tool "${name}" is not registered.`)
      }
      if (KNOWN_MUTABLE_TOOLS.has(name)) {
        throw new Error(`Capability tool "${name}" cannot be marked read-only.`)
      }
      if (readonlyTools.has(name)) {
        throw new Error(`Read-only capability tool "${name}" occurs more than once.`)
      }
      readonlyTools.add(name)
    }
    const stored: CapabilityRegistration = {
      extensions: [...registration.extensions],
      id: registration.id,
      readonlyTools: [...readonlyTools],
      tools: registration.tools.map((tool) => ({
        ...tool,
        parameters: structuredClone(tool.parameters),
      })),
      version: registration.version,
    }
    if (registration.modelPolicy !== undefined) {
      const policy = registration.modelPolicy
      if (
        policy.status === 'valid' &&
        new Set(policy.roles.map((entry) => entry.role)).size !== policy.roles.length
      ) {
        throw new Error(
          `Capability registration "${registration.id}" has duplicate model policy roles.`,
        )
      }
      stored.modelPolicy = structuredClone(policy)
    }
    if (registration.createTools !== undefined) stored.createTools = registration.createTools
    if (registration.systemPrompt !== undefined) stored.systemPrompt = registration.systemPrompt
    validateToolContract(stored, instantiateTools(stored))
    this.registrations.set(registration.id, stored)
  }

  registerProfile(profile: CapabilityProfile): void {
    this.registerProfiles([profile])
  }

  registerProfiles(profiles: readonly CapabilityProfile[]): void {
    const staged = new Map<string, CapabilityProfile>()
    for (const profile of profiles) {
      validateIdentifier(profile.id, 'Capability profile ID')
      if (this.profiles.has(profile.id) || staged.has(profile.id)) {
        throw new Error(`Capability profile "${profile.id}" already exists.`)
      }
      if (
        profile.nested !== undefined &&
        (!Number.isInteger(profile.nested.maxDepth) ||
          profile.nested.maxDepth < 1 ||
          profile.nested.maxDepth > MAX_NESTED_DEPTH)
      ) {
        throw new Error(
          `A nested capability profile requires maxDepth from 1 through ${MAX_NESTED_DEPTH}.`,
        )
      }
      const registrations = new Set<string>()
      for (const registration of profile.registrations) {
        if (registrations.has(registration)) {
          throw new Error(
            `Capability registration "${registration}" occurs more than once in profile "${profile.id}".`,
          )
        }
        registrations.add(registration)
      }
      const stored: CapabilityProfile = {
        id: profile.id,
        registrations: [...profile.registrations],
      }
      if (profile.nested !== undefined) stored.nested = { maxDepth: profile.nested.maxDepth }
      staged.set(profile.id, stored)
    }
    for (const [id, profile] of staged) this.profiles.set(id, profile)
  }

  resolve(profileId: string | undefined, readonly = false): ResolvedCapabilities {
    if (profileId === undefined) {
      return {
        modelPolicies: [],
        contract: { extensions: [], nested: { enabled: false }, registrations: [], tools: [] },
        extensions: [],
        tools: [],
      }
    }
    const profile = this.profiles.get(profileId)
    if (profile === undefined) throw new Error(`Capability profile "${profileId}" does not exist.`)
    const modelPolicies: CapabilityModelPolicy[] = []
    const extensions: InlineExtension[] = []
    const tools: string[] = []
    const registrations: { id: string; version: string }[] = []
    const names = new Set<string>()
    for (const registrationId of profile.registrations) {
      const registration = this.registrations.get(registrationId)
      if (registration === undefined) {
        throw new Error(`Capability registration "${registrationId}" does not exist.`)
      }
      if (registration.modelPolicy !== undefined)
        modelPolicies.push(structuredClone(registration.modelPolicy))
      registrations.push({ id: registration.id, version: registration.version })
      if (!readonly) extensions.push(...registration.extensions)
      const definitions = registration.tools
      if (definitions.length > 0 || registration.systemPrompt !== undefined) {
        extensions.push({
          factory: (pi) => {
            const childTools = instantiateTools(registration)
            validateToolContract(registration, childTools)
            for (const tool of childTools) pi.registerTool(tool)
            if (registration.systemPrompt !== undefined) {
              pi.on('before_agent_start', (event) => ({
                systemPrompt: `${event.systemPrompt}\n\n${registration.systemPrompt}`,
              }))
            }
          },
          hidden: true,
          name: `subagent-capability-${registration.id}-${registration.version}`,
        })
      }
      for (const tool of definitions) {
        if (names.has(tool.name)) {
          throw new Error(`Capability tool "${tool.name}" has more than one provider.`)
        }
        names.add(tool.name)
        if (
          !readonly ||
          (registration.readonlyTools?.includes(tool.name) === true &&
            !KNOWN_MUTABLE_TOOLS.has(tool.name))
        ) {
          tools.push(tool.name)
        }
      }
    }
    return {
      modelPolicies,
      contract: {
        extensions: registrations,
        nested:
          profile.nested === undefined
            ? { enabled: false }
            : { enabled: true, maxDepth: profile.nested.maxDepth },
        profileId,
        registrations,
        tools,
      },
      extensions,
      tools,
    }
  }

  resolveContract(contract: CapabilityContract, readonly: boolean): ResolvedCapabilities {
    const resolved = this.resolve(contract.profileId, readonly)
    const registrationsMatch =
      resolved.contract.registrations.length === contract.registrations.length &&
      resolved.contract.registrations.every((registration, index) => {
        const persisted = contract.registrations[index]
        return persisted?.id === registration.id && persisted.version === registration.version
      })
    const extensionsMatch =
      resolved.contract.extensions.length === contract.extensions.length &&
      resolved.contract.extensions.every((registration, index) => {
        const persisted = contract.extensions[index]
        return persisted?.id === registration.id && persisted.version === registration.version
      })
    const toolsMatch =
      resolved.contract.tools.length === contract.tools.length &&
      resolved.contract.tools.every((tool, index) => contract.tools[index] === tool)
    const nestedMatches =
      resolved.contract.nested.enabled === contract.nested.enabled &&
      (resolved.contract.nested.enabled === false ||
        (contract.nested.enabled === true &&
          resolved.contract.nested.maxDepth === contract.nested.maxDepth))
    if (!registrationsMatch || !extensionsMatch || !toolsMatch || !nestedMatches) {
      throw new Error('The persisted capability contract is unavailable or changed.')
    }
    return resolved
  }
}
