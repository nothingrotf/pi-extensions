import type { InlineExtension, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'

import type { CapabilityContract } from './schema.ts'

export type CapabilityToolDefinition = ToolDefinition<TSchema, unknown, unknown>

export interface CapabilityRegistration {
  extensions: readonly InlineExtension[]
  id: string
  readonlyTools?: readonly string[]
  tools: readonly CapabilityToolDefinition[]
  version: string
}

export interface CapabilityProfile {
  id: string
  nested?: { maxDepth: number }
  registrations: readonly string[]
}

export interface ResolvedCapabilities {
  contract: CapabilityContract
  extensions: readonly InlineExtension[]
  tools: readonly string[]
}

const KNOWN_MUTABLE_TOOLS = new Set(['bash', 'powershell', 'edit', 'write'])

function validateIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error(`${label} "${value}" is invalid.`)
}

export class CapabilityRegistry {
  private readonly profiles = new Map<string, CapabilityProfile>()
  private readonly registrations = new Map<string, CapabilityRegistration>()

  registerCapability(registration: CapabilityRegistration): void {
    validateIdentifier(registration.id, 'Capability registration ID')
    if (registration.version.length === 0) throw new Error('A capability version cannot be empty.')
    if (this.registrations.has(registration.id)) {
      throw new Error(`Capability registration "${registration.id}" already exists.`)
    }
    const names = new Set<string>()
    for (const tool of registration.tools) {
      if (tool.name === 'Task' || tool.name.startsWith('subagent_')) {
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
    this.registrations.set(registration.id, {
      extensions: [...registration.extensions],
      id: registration.id,
      readonlyTools: [...readonlyTools],
      tools: [...registration.tools],
      version: registration.version,
    })
  }

  registerProfile(profile: CapabilityProfile): void {
    validateIdentifier(profile.id, 'Capability profile ID')
    if (this.profiles.has(profile.id))
      throw new Error(`Capability profile "${profile.id}" already exists.`)
    if (
      profile.nested !== undefined &&
      (!Number.isInteger(profile.nested.maxDepth) || profile.nested.maxDepth < 1)
    ) {
      throw new Error('A nested capability profile requires a positive finite maxDepth.')
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
    this.profiles.set(profile.id, stored)
  }

  resolve(profileId: string | undefined, readonly = false): ResolvedCapabilities {
    if (profileId === undefined) {
      return {
        contract: { extensions: [], nested: { enabled: false }, registrations: [], tools: [] },
        extensions: [],
        tools: [],
      }
    }
    const profile = this.profiles.get(profileId)
    if (profile === undefined) throw new Error(`Capability profile "${profileId}" does not exist.`)
    const extensions: InlineExtension[] = []
    const tools: string[] = []
    const registrations: { id: string; version: string }[] = []
    const names = new Set<string>()
    for (const registrationId of profile.registrations) {
      const registration = this.registrations.get(registrationId)
      if (registration === undefined) {
        throw new Error(`Capability registration "${registrationId}" does not exist.`)
      }
      registrations.push({ id: registration.id, version: registration.version })
      extensions.push(...registration.extensions)
      if (registration.tools.length > 0) {
        extensions.push({
          factory: (pi) => {
            for (const tool of registration.tools) pi.registerTool(tool)
          },
          hidden: true,
          name: `subagent-capability-${registration.id}-${registration.version}`,
        })
      }
      for (const tool of registration.tools) {
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
