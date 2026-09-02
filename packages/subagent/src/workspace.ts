import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, realpath, rename, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type {
  HeadState,
  IsolationIntegration,
  WorkspaceLifecycle,
  WorkspaceRecord,
} from './schema.ts'
import { IsolationIntegrationSchema, WorkspaceLifecycleSchema } from './schema.ts'

export interface WorkspaceContext {
  logicalCwd: string
  ownerSessionId: string
  parentWorkspaceId: string
  physicalRoot: string
  relativeCwd: string
  rootWorkspaceId: string
  scopeId: string
  spawnOrdinal: number
  workspaceId: string
}

export interface LockOwner {
  attemptId: string
  pid: number
  startToken?: string
  startedAt: number
  token: string
  writerId: string
}

export interface RepositoryEntry {
  baselineCommit: string
  baselineTree: string
  destinationRepoRoot: string
  durableCommonDir: string
  headState: HeadState
  physicalRepoRoot: string
  relativePath: string
  repositoryId: string
  sourceHead?: string
  symbolicHead?: string
}

export interface WorkspaceManifest {
  attemptId: string
  createdAt: number
  integration?: IsolationIntegration
  journals: string[]
  logicalCwd: string
  owner: LockOwner
  ownerSessionId: string
  parentWorkspaceId: string
  physicalRoot: string
  relativeCwd: string
  repositories: ManifestRepositoryEntry[]
  rootWorkspaceId: string
  scopeId: string
  state: WorkspaceLifecycle
  storeRoot: string
  updatedAt: number
  workspaceId: string
  writerId: string
}

export interface ManifestRepositoryEntry extends RepositoryEntry {
  dependencyMode: 'copy' | 'copy-on-write' | 'none' | 'omitted'
  dependencyPaths: readonly string[]
  worktree: string
}

const ManifestOwnerSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  pid: Type.Number({ minimum: 1 }),
  startToken: Type.Optional(Type.String({ minLength: 1 })),
  startedAt: Type.Number({ minimum: 0 }),
  token: Type.String({ minLength: 1 }),
  writerId: Type.String({ minLength: 1 }),
})

const RepositoryEntrySchema = Type.Object({
  baselineCommit: Type.String({ minLength: 1 }),
  baselineTree: Type.String({ minLength: 1 }),
  dependencyMode: Type.Union([
    Type.Literal('copy-on-write'),
    Type.Literal('copy'),
    Type.Literal('omitted'),
    Type.Literal('none'),
  ]),
  dependencyPaths: Type.Array(Type.String()),
  destinationRepoRoot: Type.String({ minLength: 1 }),
  durableCommonDir: Type.String({ minLength: 1 }),
  headState: Type.Union([Type.Literal('committed'), Type.Literal('unborn')]),
  physicalRepoRoot: Type.String({ minLength: 1 }),
  relativePath: Type.String(),
  repositoryId: Type.String({ minLength: 1 }),
  sourceHead: Type.Optional(Type.String({ minLength: 1 })),
  symbolicHead: Type.Optional(Type.String({ minLength: 1 })),
  worktree: Type.String({ minLength: 1 }),
})

export const ManifestSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  createdAt: Type.Number({ minimum: 0 }),
  integration: Type.Optional(IsolationIntegrationSchema),
  journals: Type.Array(Type.String({ minLength: 1 })),
  logicalCwd: Type.String({ minLength: 1 }),
  owner: ManifestOwnerSchema,
  ownerSessionId: Type.String({ minLength: 1 }),
  parentWorkspaceId: Type.String({ minLength: 1 }),
  physicalRoot: Type.String(),
  relativeCwd: Type.String(),
  repositories: Type.Array(RepositoryEntrySchema),
  rootWorkspaceId: Type.String({ minLength: 1 }),
  scopeId: Type.String({ minLength: 1 }),
  state: WorkspaceLifecycleSchema,
  storeRoot: Type.String({ minLength: 1 }),
  updatedAt: Type.Number({ minimum: 0 }),
  workspaceId: Type.String({ minLength: 1 }),
  writerId: Type.String({ minLength: 1 }),
})

export const RegistrySchema = Type.Object({
  manifests: Type.Array(Type.String({ minLength: 1 })),
  version: Type.Literal(1),
})

const LOCK_RETRY_LIMIT = 2_400
const LOCK_RETRY_DELAY_MS = 50

export function errorMessage<Input>(error: Input): string {
  return error instanceof Error ? error.message : String(error)
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function repositoryIdentity(durableCommonDir: string, relativePath: string): string {
  return digest(`${durableCommonDir}\0${relativePath}`).slice(0, 24)
}

export function joinEffectiveCwd(physicalRoot: string, relativeCwd: string): string {
  return relativeCwd.length === 0 ? physicalRoot : join(physicalRoot, relativeCwd)
}

export function workspaceRecord(options: {
  attemptId: string
  context: WorkspaceContext
  journalUri?: string
  lifecycleState: WorkspaceLifecycle
  manifestUri?: string
  repositoryIds: readonly string[]
  rootVisibility: WorkspaceRecord['rootVisibility']
  writerId: string
}): WorkspaceRecord {
  const now = Date.now()
  const record: WorkspaceRecord = {
    attemptId: options.attemptId,
    createdAt: now,
    lifecycleState: options.lifecycleState,
    logicalCwd: options.context.logicalCwd,
    parentWorkspaceId: options.context.parentWorkspaceId,
    relativeCwd: options.context.relativeCwd,
    repositoryIds: [...options.repositoryIds],
    rootVisibility: options.rootVisibility,
    rootWorkspaceId: options.context.rootWorkspaceId,
    scopeId: options.context.scopeId,
    spawnOrdinal: options.context.spawnOrdinal,
    updatedAt: now,
    version: 6,
    workspaceId: options.context.workspaceId,
    writerId: options.writerId,
  }
  if (options.journalUri !== undefined) record.journalUri = options.journalUri
  if (options.manifestUri !== undefined) record.manifestUri = options.manifestUri
  return record
}

export async function processStartToken(pid: number): Promise<string | undefined> {
  const child = spawn('ps', ['-o', 'lstart=', '-p', String(pid)], { stdio: 'pipe' })
  const output: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
  const code = await new Promise<number>((resolveResult, reject) => {
    child.on('error', reject)
    child.on('close', (exitCode) => resolveResult(exitCode ?? 1))
  })
  if (code !== 0) return undefined
  const token = Buffer.concat(output).toString('utf8').trim()
  return token.length === 0 ? undefined : token
}

export async function ownerStatus(owner: LockOwner): Promise<'ambiguous' | 'dead' | 'live'> {
  try {
    process.kill(owner.pid, 0)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return 'dead'
    return 'ambiguous'
  }
  if (owner.startToken === undefined) return 'ambiguous'
  try {
    const token = await processStartToken(owner.pid)
    if (token === undefined) return 'ambiguous'
    return token === owner.startToken ? 'live' : 'dead'
  } catch {
    return 'ambiguous'
  }
}

export async function processLives(owner: LockOwner): Promise<boolean> {
  return (await ownerStatus(owner)) !== 'dead'
}

export async function currentLockOwner(writerId: string, attemptId: string): Promise<LockOwner> {
  const owner: LockOwner = {
    attemptId,
    pid: process.pid,
    startedAt: Date.now(),
    token: randomUUID(),
    writerId,
  }
  const startToken = await processStartToken(process.pid)
  if (startToken !== undefined) owner.startToken = startToken
  return owner
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function lockGit(
  gitDir: string,
  args: readonly string[],
  input?: string,
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn('git', [`--git-dir=${gitDir}`, ...args], { stdio: 'pipe' })
    const stdout: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      resolveResult({ code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8') })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

function lockGitDirectory(path: string): string {
  const marker = `${sep}pi-subagent${sep}`
  const index = path.lastIndexOf(marker)
  if (index < 1) throw new Error(`The lock path is outside durable Git storage: ${path}.`)
  return path.slice(0, index)
}

async function lockOwnerFromObject(
  gitDir: string,
  objectId: string,
): Promise<LockOwner | undefined> {
  const result = await lockGit(gitDir, ['cat-file', 'blob', objectId])
  if (result.code !== 0) return undefined
  try {
    return Value.Decode(ManifestOwnerSchema, JSON.parse(result.stdout))
  } catch {
    return undefined
  }
}

export interface ProcessLock {
  path: string
  release: () => Promise<void>
  token: string
}

export async function acquireLock(
  path: string,
  owner: LockOwner,
  recoveryRoot: string,
): Promise<ProcessLock> {
  await mkdir(recoveryRoot, { recursive: true })
  const gitDir = lockGitDirectory(path)
  const ref = `refs/pi-subagent/v2/locks/${digest(path)}`
  const ownerText = JSON.stringify(owner)
  const objectResult = await lockGit(gitDir, ['hash-object', '-w', '--stdin'], ownerText)
  if (objectResult.code !== 0) throw new Error(`Cannot create the lock owner for ${path}.`)
  const ownerObject = objectResult.stdout.trim()
  for (let attempt = 0; attempt < LOCK_RETRY_LIMIT; attempt += 1) {
    const currentResult = await lockGit(gitDir, ['rev-parse', '--verify', '--quiet', ref])
    const currentObject = currentResult.code === 0 ? currentResult.stdout.trim() : undefined
    if (currentObject === undefined) {
      const acquired = await lockGit(gitDir, [
        'update-ref',
        ref,
        ownerObject,
        '0'.repeat(ownerObject.length),
      ])
      if (acquired.code !== 0) continue
    } else {
      const existing = await lockOwnerFromObject(gitDir, currentObject)
      if (existing !== undefined && (await processLives(existing))) {
        await delay(LOCK_RETRY_DELAY_MS)
        continue
      }
      const acquired = await lockGit(gitDir, ['update-ref', ref, ownerObject, currentObject])
      if (acquired.code !== 0) continue
      if (existing !== undefined) {
        await writeAtomicJson(join(recoveryRoot, `${Date.now()}-${randomUUID()}.json`), existing)
      }
    }
    return {
      path: ref,
      release: async () => {
        await lockGit(gitDir, ['update-ref', '-d', ref, ownerObject])
      },
      token: owner.token,
    }
  }
  throw new Error(`Timed out while waiting for the lock at ${path}.`)
}

export async function withRepositoryLock<Result>(
  durableCommonDir: string,
  repositoryId: string,
  owner: LockOwner,
  operation: () => Promise<Result>,
): Promise<Result> {
  const lockRoot = join(durableCommonDir, 'pi-subagent', 'locks')
  const lock = await acquireLock(
    join(lockRoot, `meta-${repositoryId}`),
    owner,
    join(lockRoot, 'recovery'),
  )
  try {
    return await operation()
  } finally {
    await lock.release()
  }
}

export async function withDestinationLock<Result>(
  durableCommonDir: string,
  workspaceId: string,
  repositoryId: string,
  owner: LockOwner,
  operation: () => Promise<Result>,
): Promise<Result> {
  const lockRoot = join(durableCommonDir, 'pi-subagent', 'locks')
  const lock = await acquireLock(
    join(lockRoot, `dest-${workspaceId}-${repositoryId}`),
    owner,
    join(lockRoot, 'recovery'),
  )
  try {
    return await operation()
  } finally {
    await lock.release()
  }
}

export function sortedRepositoryIds(entries: readonly { repositoryId: string }[]): string[] {
  return entries.map((entry) => entry.repositoryId).sort()
}

export async function writeAtomicFile(path: string, value: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try {
    await handle.writeFile(value)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(temporary, path)
  const directory = await open(dirname(path), 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}

export async function writeAtomicJson<Value>(path: string, value: Value): Promise<void> {
  await writeAtomicFile(path, JSON.stringify(value))
}

export async function writeManifest(manifest: WorkspaceManifest): Promise<string> {
  manifest.updatedAt = Date.now()
  const path = join(
    manifest.storeRoot,
    'worktrees',
    `${manifest.workspaceId}-${manifest.attemptId}`,
    'manifest.json',
  )
  await writeAtomicJson(path, manifest)
  return path
}

export function manifestPath(storeRoot: string, workspaceId: string, attemptId: string): string {
  return join(storeRoot, 'worktrees', `${workspaceId}-${attemptId}`, 'manifest.json')
}

export async function readManifest(path: string): Promise<WorkspaceManifest | undefined> {
  try {
    return Value.Decode(ManifestSchema, JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return undefined
  }
}

export async function registerManifest(
  storeRoot: string,
  path: string,
  owner: LockOwner,
): Promise<void> {
  const lock = await acquireLock(
    join(storeRoot, 'locks', 'registry'),
    owner,
    join(storeRoot, 'locks', 'recovery'),
  )
  try {
    const registryPath = join(storeRoot, 'registry.json')
    let registry: { manifests: string[]; version: 1 } = { manifests: [], version: 1 }
    try {
      registry = Value.Decode(RegistrySchema, JSON.parse(await readFile(registryPath, 'utf8')))
    } catch {}
    if (registry.manifests.includes(path)) return
    registry.manifests.push(path)
    await writeAtomicJson(registryPath, registry)
  } finally {
    await lock.release()
  }
}

export async function listManifests(storeRoot: string): Promise<string[]> {
  try {
    const registry = Value.Decode(
      RegistrySchema,
      JSON.parse(await readFile(join(storeRoot, 'registry.json'), 'utf8')),
    )
    const present: string[] = []
    for (const path of registry.manifests) {
      if (await pathExists(path)) present.push(path)
    }
    return present
  } catch {
    return []
  }
}

export async function removeFromRegistry(
  storeRoot: string,
  path: string,
  owner: LockOwner,
): Promise<void> {
  const lock = await acquireLock(
    join(storeRoot, 'locks', 'registry'),
    owner,
    join(storeRoot, 'locks', 'recovery'),
  )
  try {
    const registryPath = join(storeRoot, 'registry.json')
    let registry: { manifests: string[]; version: 1 }
    try {
      registry = Value.Decode(RegistrySchema, JSON.parse(await readFile(registryPath, 'utf8')))
    } catch {
      return
    }
    const filtered = registry.manifests.filter((entry) => entry !== path)
    if (filtered.length === registry.manifests.length) return
    await writeAtomicJson(registryPath, { manifests: filtered, version: 1 })
  } finally {
    await lock.release()
  }
}

export interface DescendantEntry {
  agentId: string
  completion: Promise<unknown>
  spawnOrdinal: number
}

export class DescendantScope {
  private readonly children = new Map<string, DescendantEntry>()
  private ordinalCounter = 0
  private state: 'closed' | 'closing' | 'open' = 'open'

  constructor(readonly scopeId: string) {}

  get closeStarted(): boolean {
    return this.state !== 'open'
  }

  get closed(): boolean {
    return this.state === 'closed'
  }

  nextOrdinal(): number {
    this.ordinalCounter += 1
    return this.ordinalCounter
  }

  assertCanSpawn(): void {
    if (this.state !== 'open') {
      throw new Error('A descendant Task cannot spawn after parent closure started.')
    }
  }

  register(agentId: string, completion: Promise<unknown>, spawnOrdinal?: number): number {
    this.assertCanSpawn()
    const ordinal = spawnOrdinal ?? this.nextOrdinal()
    this.children.set(agentId, { agentId, completion, spawnOrdinal: ordinal })
    return ordinal
  }

  entry(agentId: string): DescendantEntry | undefined {
    return this.children.get(agentId)
  }

  list(): DescendantEntry[] {
    return [...this.children.values()].sort((left, right) => left.spawnOrdinal - right.spawnOrdinal)
  }

  markClosing(): void {
    this.state = 'closing'
  }

  markClosed(): void {
    this.state = 'closed'
  }
}

export async function createRootWorkspaceContext(
  logicalCwd: string,
  scopeId: string,
  ownerSessionId = scopeId,
): Promise<WorkspaceContext> {
  let canonical = logicalCwd
  try {
    canonical = await realpath(logicalCwd)
  } catch {}
  const resolved = resolve(canonical)
  let physicalRoot = resolved
  try {
    const child = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd: resolved,
      stdio: 'pipe',
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    const code = await new Promise<number>((resolveResult, reject) => {
      child.on('error', reject)
      child.on('close', (exitCode) => resolveResult(exitCode ?? 1))
    })
    if (code === 0) physicalRoot = resolve(Buffer.concat(output).toString('utf8').trim())
  } catch {}
  const workspaceId = `root-${digest(physicalRoot).slice(0, 16)}`
  return {
    logicalCwd: physicalRoot,
    ownerSessionId,
    parentWorkspaceId: workspaceId,
    physicalRoot,
    relativeCwd: relative(physicalRoot, resolved),
    rootWorkspaceId: workspaceId,
    scopeId,
    spawnOrdinal: 0,
    workspaceId,
  }
}

export function childWorkspaceContext(options: {
  logicalCwd: string
  parent: WorkspaceContext
  physicalRoot: string
  relativeCwd: string
  spawnOrdinal: number
  workspaceId: string
}): WorkspaceContext {
  return {
    logicalCwd: options.logicalCwd,
    ownerSessionId: options.parent.ownerSessionId,
    parentWorkspaceId: options.parent.workspaceId,
    physicalRoot: options.physicalRoot,
    relativeCwd: options.relativeCwd,
    rootWorkspaceId: options.parent.rootWorkspaceId,
    scopeId: options.parent.scopeId,
    spawnOrdinal: options.spawnOrdinal,
    workspaceId: options.workspaceId,
  }
}

export function relativeCwdWithin(physicalRoot: string, target: string): string {
  const value = relative(physicalRoot, target)
  if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`)) {
    throw new Error(`The path ${target} escapes its workspace root.`)
  }
  return value
}

export function tempDirectory(): string {
  return tmpdir()
}
