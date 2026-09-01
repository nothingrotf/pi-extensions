import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'

import { getAgentDir, parseFrontmatter } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { EffortSchema, type Effort } from './schema.ts'

const MAX_AGENT_FILE_BYTES = 256 * 1024
const AGENT_NAME_PATTERN = '^[A-Za-z0-9_-]+$'

const AgentMetadataSchema = Type.Object(
  {
    description: Type.String({ maxLength: 512, minLength: 1 }),
    effort: Type.Optional(EffortSchema),
    model: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ maxLength: 64, minLength: 1, pattern: AGENT_NAME_PATTERN })),
    readonly: Type.Optional(Type.Boolean()),
    tools: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 64, uniqueItems: true }),
    ),
  },
  { additionalProperties: false },
)

const RegisteredAgentSchema = Type.Object(
  {
    description: Type.String({ maxLength: 512, minLength: 1 }),
    effort: Type.Optional(EffortSchema),
    model: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.String({ maxLength: 64, minLength: 1, pattern: AGENT_NAME_PATTERN }),
    readonly: Type.Optional(Type.Boolean()),
    systemPrompt: Type.String({ maxLength: MAX_AGENT_FILE_BYTES, minLength: 1 }),
    tools: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 64, uniqueItems: true }),
    ),
  },
  { additionalProperties: false },
)

export type AgentSource =
  | { kind: 'bundled' }
  | { id: string; kind: 'extension' }
  | { kind: 'project'; path: string }
  | { kind: 'user'; path: string }

export interface SubagentDefinition {
  description: string
  effort?: Effort
  model?: string
  name: string
  readonly?: boolean
  systemPrompt: string
  tools?: readonly string[]
}

export interface ResolvedSubagentDefinition extends SubagentDefinition {
  source: AgentSource
}

function decodeRegisteredAgent(definition: SubagentDefinition): SubagentDefinition {
  try {
    if (!Value.Check(RegisteredAgentSchema, definition)) throw new Error('Validation failed.')
    return Value.Decode(RegisteredAgentSchema, definition)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent "${definition.name}" is invalid: ${detail}`)
  }
}

function parseAgentFile(
  path: string,
  defaultName: string,
  content: string,
  source: AgentSource,
): ResolvedSubagentDefinition {
  if (Buffer.byteLength(content, 'utf8') > MAX_AGENT_FILE_BYTES) {
    throw new Error(`Agent file exceeds ${MAX_AGENT_FILE_BYTES} bytes: ${path}`)
  }
  let parsed: ReturnType<typeof parseFrontmatter>
  try {
    parsed = parseFrontmatter(content)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent frontmatter is invalid in ${path}: ${detail}`)
  }
  let metadata: ReturnType<typeof Value.Decode<typeof AgentMetadataSchema>>
  try {
    if (!Value.Check(AgentMetadataSchema, parsed.frontmatter)) throw new Error('Validation failed.')
    metadata = Value.Decode(AgentMetadataSchema, parsed.frontmatter)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent frontmatter is invalid in ${path}: ${detail}`)
  }
  const name = metadata.name ?? defaultName
  const systemPrompt = parsed.body.trim()
  if (systemPrompt.length === 0) throw new Error(`Agent file has no prompt body: ${path}`)
  const input: SubagentDefinition = { description: metadata.description, name, systemPrompt }
  if (metadata.effort !== undefined) input.effort = metadata.effort
  if (metadata.model !== undefined) input.model = metadata.model
  if (metadata.readonly !== undefined) input.readonly = metadata.readonly
  if (metadata.tools !== undefined) input.tools = metadata.tools
  const definition = decodeRegisteredAgent(input)
  return { ...definition, source }
}

async function candidateInDirectory(
  directory: string,
  name: string,
  sourceKind: 'project' | 'user',
): Promise<ResolvedSubagentDefinition | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Agent directory is unreadable: ${directory}: ${detail}`)
  })
  const matches = entries.filter(
    (entry) =>
      (entry.isFile() || entry.isSymbolicLink()) &&
      entry.name.endsWith('.md') &&
      basename(entry.name, '.md') === name,
  )
  if (matches.length === 0) return undefined
  if (matches.length > 1) throw new Error(`Agent "${name}" has duplicate files in ${directory}.`)
  const file = join(directory, matches[0]?.name ?? '')
  const canonical = await realpath(file)
  const metadata = await stat(canonical)
  if (!metadata.isFile()) throw new Error(`Agent path is not a file: ${file}`)
  if (metadata.size > MAX_AGENT_FILE_BYTES) {
    throw new Error(`Agent file exceeds ${MAX_AGENT_FILE_BYTES} bytes: ${canonical}`)
  }
  const source: AgentSource = { kind: sourceKind, path: canonical }
  const definition = parseAgentFile(canonical, name, await readFile(canonical, 'utf8'), source)
  if (definition.name !== name) {
    throw new Error(
      `Agent file ${canonical} declares name "${definition.name}" instead of "${name}".`,
    )
  }
  return definition
}

function ancestors(cwd: string): string[] {
  const directories: string[] = []
  let current = resolve(cwd)
  const root = parse(current).root
  while (true) {
    directories.push(current)
    if (current === root) return directories
    current = dirname(current)
  }
}

function defaultUserDirectories(): string[] {
  const home = homedir()
  return [
    join(home, '.agents', 'agents'),
    join(getAgentDir(), 'agents'),
    join(home, '.claude', 'agents'),
  ]
}

export class SubagentResolver {
  private readonly extensions = new Map<string, Map<string, SubagentDefinition>>()
  private generation = 0
  private readonly cache = new Map<string, Promise<ResolvedSubagentDefinition | undefined>>()

  constructor(private readonly userDirectories: readonly string[] = defaultUserDirectories()) {}

  register(sourceId: string, definitions: readonly SubagentDefinition[]): () => void {
    const source = sourceId.trim()
    if (source.length === 0) throw new Error('The agent definition source ID is empty.')
    if (this.extensions.has(source))
      throw new Error(`Agent source "${source}" is already registered.`)
    const entries = new Map<string, SubagentDefinition>()
    for (const definition of definitions) {
      const validated = decodeRegisteredAgent(definition)
      if (entries.has(validated.name)) {
        throw new Error(`Agent "${validated.name}" is duplicated in source "${source}".`)
      }
      entries.set(validated.name, validated)
    }
    this.extensions.set(source, entries)
    this.invalidateCache()
    return () => {
      if (this.extensions.delete(source)) this.invalidateCache()
    }
  }

  async resolve(nameInput: string, cwd: string): Promise<ResolvedSubagentDefinition | undefined> {
    const name = nameInput.trim()
    if (!new RegExp(AGENT_NAME_PATTERN).test(name))
      throw new Error(`Agent name "${name}" is invalid.`)
    const key = `${resolve(cwd)}\0${this.generation}\0${name}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached
    const pending = this.discover(name, cwd)
    this.cache.set(key, pending)
    pending.catch(() => {
      if (this.cache.get(key) === pending) this.cache.delete(key)
    })
    return pending
  }

  private async discover(
    name: string,
    cwd: string,
  ): Promise<ResolvedSubagentDefinition | undefined> {
    for (const directory of ancestors(cwd)) {
      const candidates = await Promise.all([
        candidateInDirectory(join(directory, '.agents', 'agents'), name, 'project'),
        candidateInDirectory(join(directory, '.pi', 'agents'), name, 'project'),
        candidateInDirectory(join(directory, '.claude', 'agents'), name, 'project'),
      ])
      const found = candidates.filter((candidate) => candidate !== undefined)
      if (found.length > 1) {
        throw new Error(`Agent "${name}" has duplicate project definitions in ${directory}.`)
      }
      if (found[0] !== undefined) return found[0]
    }

    const userCandidates = await Promise.all(
      this.userDirectories.map(async (directory) => candidateInDirectory(directory, name, 'user')),
    )
    const userFound = userCandidates.filter((candidate) => candidate !== undefined)
    if (userFound.length > 1) throw new Error(`Agent "${name}" has duplicate user definitions.`)
    if (userFound[0] !== undefined) return userFound[0]

    const extensionFound: ResolvedSubagentDefinition[] = []
    for (const [sourceId, definitions] of this.extensions) {
      const definition = definitions.get(name)
      if (definition !== undefined) {
        extensionFound.push({ ...definition, source: { id: sourceId, kind: 'extension' } })
      }
    }
    if (extensionFound.length > 1) {
      throw new Error(`Agent "${name}" has duplicate extension definitions.`)
    }
    return extensionFound[0]
  }

  invalidateCache(): void {
    this.generation += 1
    this.cache.clear()
  }
}
