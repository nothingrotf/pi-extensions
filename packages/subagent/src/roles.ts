import { readFile } from 'node:fs/promises'

import type { Effort, SubagentType } from './schema.ts'

export type RoleName = string

export interface RoleDefinition {
  effort: Effort | undefined
  model?: string
  name: RoleName
  promptFile?: string
  tools: readonly string[] | undefined
}

const GENERAL_PURPOSE: RoleDefinition = {
  effort: 'high',
  name: 'generalPurpose',
  promptFile: 'general-purpose.md',
  tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
}

const EXPLORE: RoleDefinition = {
  effort: 'medium',
  name: 'explore',
  promptFile: 'explore.md',
  tools: ['read', 'grep', 'find', 'ls'],
}

const SHELL: RoleDefinition = {
  effort: 'low',
  name: 'shell',
  promptFile: 'shell.md',
  tools: ['read', 'grep', 'find', 'ls', 'bash'],
}

const DEBUG: RoleDefinition = {
  effort: 'high',
  name: 'debug',
  promptFile: 'debug.md',
  tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'],
}

const READONLY: RoleDefinition = {
  effort: 'medium',
  name: 'readonly',
  promptFile: 'readonly.md',
  tools: ['read', 'grep', 'find', 'ls'],
}

const promptCache = new Map<string, string>()

function canonicalRole(name: string): string {
  if (name === 'general-purpose' || name === 'general_purpose' || name === 'unspecified')
    return 'generalPurpose'
  if (name === 'bash') return 'shell'
  return name
}

export const BUILT_IN_ROLE_NAMES: readonly string[] = [
  'generalPurpose',
  'explore',
  'shell',
  'debug',
]

export function isBuiltInRole(name: string): boolean {
  return BUILT_IN_ROLE_NAMES.includes(canonicalRole(name))
}

export function isReadonlyByDefault(name: string): boolean {
  return canonicalRole(name) === 'explore'
}

export function resolveRole(subagentType: SubagentType, readonly: boolean): RoleDefinition {
  const role = canonicalRole(subagentType)
  if (role === 'explore') return EXPLORE
  if (readonly) return READONLY
  if (role === 'shell') return SHELL
  if (role === 'debug') return DEBUG
  if (role === 'generalPurpose') return GENERAL_PURPOSE
  throw new Error(`Subagent type "${subagentType}" does not exist.`)
}

export async function loadRolePrompt(role: RoleDefinition): Promise<string> {
  if (role.promptFile === undefined) throw new Error(`Agent "${role.name}" has no bundled prompt.`)
  const cached = promptCache.get(role.promptFile)
  if (cached !== undefined) return cached

  const promptUrl = new URL(`../agents/${role.promptFile}`, import.meta.url)
  const prompt = (await readFile(promptUrl, 'utf8')).trim()
  promptCache.set(role.promptFile, prompt)
  return prompt
}
