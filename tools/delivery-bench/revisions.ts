import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const SettingsSchema = Type.Object(
  { packages: Type.Optional(Type.Array(Type.Unknown())) },
  { additionalProperties: true },
)
const PackageObjectSchema = Type.Object({ source: Type.String() }, { additionalProperties: true })

export function pinnedPackage(
  entry: string,
  agentDir: string,
  sourceRoot: string,
  revisionRoot: string,
): string {
  if (/^[a-z]+:/.test(entry)) return entry
  const absolute = resolve(agentDir, entry)
  const inside = relative(sourceRoot, absolute)
  if (inside.startsWith('..') || isAbsolute(inside)) return absolute
  return join(revisionRoot, inside)
}

export interface MirrorRequest {
  agentDir?: string
  revisionRoot: string
  sourceRoot: string
  target: string
}

function defaultAgentDirectory(): string {
  const configured = process.env['PI_CODING_AGENT_DIR']
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.pi', 'agent')
}

export async function mirrorAgentDirectory(request: MirrorRequest): Promise<string> {
  const { revisionRoot, sourceRoot, target } = request
  const source = request.agentDir ?? defaultAgentDirectory()
  await mkdir(target, { recursive: true })
  for (const name of await readdir(source)) {
    if (name === 'settings.json' || name === 'sessions') continue
    await symlink(join(source, name), join(target, name))
  }
  const settings: unknown = JSON.parse(await readFile(join(source, 'settings.json'), 'utf8'))
  if (!Value.Check(SettingsSchema, settings))
    throw new Error(`${join(source, 'settings.json')} has an invalid packages list.`)
  const packages = (settings.packages ?? []).map((entry) => {
    if (Value.Check(Type.String(), entry))
      return pinnedPackage(entry, source, sourceRoot, revisionRoot)
    if (Value.Check(PackageObjectSchema, entry))
      return { ...entry, source: pinnedPackage(entry.source, source, sourceRoot, revisionRoot) }
    return entry
  })
  await writeFile(
    join(target, 'settings.json'),
    `${JSON.stringify({ ...settings, packages }, null, 2)}\n`,
  )
  return target
}
