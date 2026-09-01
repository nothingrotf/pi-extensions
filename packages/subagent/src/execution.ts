import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import type { RoleDefinition } from './roles.ts'

const PUBLIC_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'bash', 'powershell', 'edit', 'write'])
const PRIVATE_TOOLS = new Set(['ask_parent', 'notify_parent', 'update_progress'])
const MUTABLE_TOOLS = new Set(['bash', 'powershell', 'edit', 'write'])

export async function resolveInvocationCwd(parentCwd: string, requested: string | undefined) {
  const target = requested === undefined ? parentCwd : requested.trim()
  if (target.length === 0) throw new Error('The Task cwd is empty.')
  const absolute = isAbsolute(target) ? target : resolve(parentCwd, target)
  let canonical: string
  try {
    canonical = await realpath(absolute)
  } catch {
    throw new Error(`The Task cwd does not exist: ${absolute}`)
  }
  const metadata = await stat(canonical)
  if (!metadata.isDirectory()) throw new Error(`The Task cwd is not a directory: ${canonical}`)
  return canonical
}

export function resolveTools(
  role: Pick<RoleDefinition, 'name' | 'tools'>,
  requested: readonly string[] | undefined,
  readonly: boolean,
): string[] {
  const allowed = role.tools === undefined ? [...PUBLIC_TOOLS] : [...role.tools]
  const selected = requested === undefined ? allowed : [...requested]
  const seen = new Set<string>()
  for (const name of selected) {
    if (seen.has(name)) throw new Error(`Task tool "${name}" is duplicated.`)
    seen.add(name)
    if (PRIVATE_TOOLS.has(name)) {
      throw new Error(`Task tool "${name}" is private and cannot be requested.`)
    }
    if (!PUBLIC_TOOLS.has(name)) throw new Error(`Task tool "${name}" is unknown.`)
    if (!allowed.includes(name)) {
      throw new Error(`Task tool "${name}" is not permitted by agent "${role.name}".`)
    }
  }
  return selected.filter((name) => !readonly || !MUTABLE_TOOLS.has(name))
}
