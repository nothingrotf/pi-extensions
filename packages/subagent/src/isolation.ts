import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type {
  IsolationChangedFile,
  IsolationIntegration,
  IsolationPatchRef,
  IsolationReceipt,
  IsolationRepositoryReceipt,
} from './schema.ts'

interface GitResult {
  stderr: string
  stdout: string
}

interface RepositoryBaseline {
  baselineCommit: string
  baselineTree: string
  commonDir: string
  relativePath: string
  repoRoot: string
  sourceHead: string
}

interface RepositoryIsolation extends RepositoryBaseline {
  dependencyPaths: readonly string[]
  worktree: string
}

export interface WriterIsolation {
  attemptId: string
  baseDir: string
  integration: IsolationIntegration
  leasePath: string
  leaseToken: string
  repositories: readonly RepositoryIsolation[]
  rootWorktree: string
  writerId: string
}

interface LeaseOwner {
  attemptId: string
  pid: number
  startedAt: number
  startToken?: string
  token: string
  writerId: string
}

interface DirectoryLease {
  path: string
  token: string
}

export interface IsolationRecovery {
  attemptId: string | undefined
  ownerStatus: 'ambiguous' | 'dead'
  path: string
  receipt?: IsolationReceipt
  writerId: string | undefined
}

const ISOLATION_FILE = 'isolation.json'
const OWNER_FILE = 'owner.json'
const RECOVERY_DIR = 'recovery'
const WORKTREE_DIR = 'worktrees'
const RepositoryIsolationSchema = Type.Object({
  baselineCommit: Type.String({ minLength: 1 }),
  baselineTree: Type.String({ minLength: 1 }),
  commonDir: Type.String({ minLength: 1 }),
  dependencyPaths: Type.Array(Type.String({ minLength: 1 })),
  relativePath: Type.String(),
  repoRoot: Type.String({ minLength: 1 }),
  sourceHead: Type.String({ minLength: 1 }),
  worktree: Type.String({ minLength: 1 }),
})
const WriterIsolationSchema = Type.Object({
  attemptId: Type.String({ minLength: 1 }),
  baseDir: Type.String({ minLength: 1 }),
  integration: Type.Union([Type.Literal('apply'), Type.Literal('branch'), Type.Literal('manual')]),
  leasePath: Type.String({ minLength: 1 }),
  leaseToken: Type.String({ minLength: 1 }),
  repositories: Type.Array(RepositoryIsolationSchema, { minItems: 1 }),
  rootWorktree: Type.String({ minLength: 1 }),
  writerId: Type.String({ minLength: 1 }),
})
const LeaseOwnerSchema = Type.Object(
  {
    attemptId: Type.String({ minLength: 1 }),
    pid: Type.Number({ minimum: 1 }),
    startedAt: Type.Number({ minimum: 0 }),
    startToken: Type.Optional(Type.String({ minLength: 1 })),
    token: Type.String({ minLength: 1 }),
    writerId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

function errorMessage<Input>(error: Input): string {
  return error instanceof Error ? error.message : String(error)
}

async function run(cwd: string, command: readonly string[], input?: string): Promise<GitResult> {
  const executable = command[0]
  if (executable === undefined) throw new Error('The process command is empty.')
  return new Promise<GitResult>((resolveResult, reject) => {
    const process = spawn(executable, command.slice(1), { cwd, stdio: 'pipe' })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    process.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    process.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    process.on('error', reject)
    process.on('close', (exitCode) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const error = Buffer.concat(stderr).toString('utf8')
      if (exitCode !== 0) {
        const detail = error.trim().length > 0 ? error.trim() : output.trim()
        reject(new Error(`${command.join(' ')} failed${detail.length === 0 ? '' : `: ${detail}`}`))
        return
      }
      resolveResult({ stderr: error, stdout: output })
    })
    if (input !== undefined) process.stdin.end(input)
    else process.stdin.end()
  })
}

async function git(cwd: string, args: readonly string[], input?: string): Promise<string> {
  return (await run(cwd, ['git', ...args], input)).stdout
}

async function gitWithIndex(
  cwd: string,
  indexPath: string,
  args: readonly string[],
): Promise<string> {
  return (await run(cwd, ['env', `GIT_INDEX_FILE=${indexPath}`, 'git', ...args])).stdout
}

async function commitTree(
  cwd: string,
  tree: string,
  parent: string,
  message: string,
): Promise<string> {
  return (
    await git(
      cwd,
      [
        '-c',
        'user.name=Pi Subagent',
        '-c',
        'user.email=pi-subagent@localhost',
        'commit-tree',
        tree,
        '-p',
        parent,
      ],
      `${message}\n`,
    )
  ).trim()
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeSegment(value: string): string {
  return digest(value).slice(0, 16)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function repositoryRoot(cwd: string): Promise<string> {
  const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  if (root.length === 0) throw new Error(`Git repository not found from ${cwd}.`)
  return realpath(root)
}

async function commonDirectory(repoRoot: string): Promise<string> {
  const value = (
    await git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  return realpath(resolve(repoRoot, value))
}

async function syntheticBaseline(
  repoRoot: string,
  relativePath: string,
): Promise<RepositoryBaseline> {
  const sourceHead = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
  const indexPath = join(await mkdtemp(join(tmpdir(), 'pi-subagent-index-')), 'index')
  try {
    await gitWithIndex(repoRoot, indexPath, ['read-tree', 'HEAD'])
    await gitWithIndex(repoRoot, indexPath, ['add', '-A', '--', '.'])
    const baselineTree = (await gitWithIndex(repoRoot, indexPath, ['write-tree'])).trim()
    const baselineCommit = await commitTree(
      repoRoot,
      baselineTree,
      sourceHead,
      'pi-subagent baseline',
    )
    return {
      baselineCommit,
      baselineTree,
      commonDir: await commonDirectory(repoRoot),
      relativePath,
      repoRoot,
      sourceHead,
    }
  } finally {
    await rm(dirname(indexPath), { force: true, recursive: true })
  }
}

async function submodulePaths(repoRoot: string): Promise<Set<string>> {
  const output = await git(repoRoot, ['submodule', 'status', '--recursive']).catch(() => '')
  const paths = new Set<string>()
  for (const line of output.split('\n')) {
    const match = line.trim().match(/^[+\- U]?[0-9a-f]+\s+(.+?)(?:\s+\(|$)/)
    if (match?.[1] !== undefined) paths.add(match[1])
  }
  return paths
}

async function nestedRepositories(repoRoot: string): Promise<string[]> {
  const submodules = await submodulePaths(repoRoot)
  const found: string[] = []
  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      const relativePath = relative(repoRoot, path)
      if (submodules.has(relativePath)) continue
      if (await pathExists(join(path, '.git'))) {
        found.push(relativePath)
        continue
      }
      await walk(path)
    }
  }
  await walk(repoRoot)
  return found.sort()
}

async function writeAtomicJson<Value>(path: string, value: Value): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

async function writeOwner(baseDir: string, owner: LeaseOwner): Promise<void> {
  await writeAtomicJson(join(baseDir, OWNER_FILE), owner)
}

function decodeLeaseOwner<Input>(value: Input): LeaseOwner | undefined {
  try {
    return Value.Decode(LeaseOwnerSchema, value)
  } catch {
    return undefined
  }
}

function decodeWriterIsolation<Input>(value: Input): WriterIsolation | undefined {
  try {
    return Value.Decode(WriterIsolationSchema, value)
  } catch {
    return undefined
  }
}

async function readWriterIsolation(baseDir: string): Promise<WriterIsolation | undefined> {
  try {
    return decodeWriterIsolation(JSON.parse(await readFile(join(baseDir, ISOLATION_FILE), 'utf8')))
  } catch {
    return undefined
  }
}

async function readOwner(baseDir: string): Promise<LeaseOwner | undefined> {
  try {
    return decodeLeaseOwner(JSON.parse(await readFile(join(baseDir, OWNER_FILE), 'utf8')))
  } catch {
    return undefined
  }
}

async function processStartToken(pid: number): Promise<string | undefined> {
  try {
    const result = await run(process.cwd(), ['ps', '-o', 'lstart=', '-p', String(pid)])
    const token = result.stdout.trim()
    return token.length === 0 ? undefined : token
  } catch {
    return undefined
  }
}

async function currentLeaseOwner(writerId: string, attemptId: string): Promise<LeaseOwner> {
  const owner: LeaseOwner = {
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

async function processLives(owner: LeaseOwner): Promise<boolean> {
  try {
    process.kill(owner.pid, 0)
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
  if (owner.startToken === undefined) return true
  const token = await processStartToken(owner.pid)
  return token === undefined || token === owner.startToken
}

async function quarantine(path: string, recoveryRoot: string): Promise<string> {
  await mkdir(recoveryRoot, { recursive: true })
  const target = join(recoveryRoot, `${Date.now()}-${randomUUID()}`)
  await rename(path, target)
  return target
}

async function readLease(path: string): Promise<LeaseOwner | undefined> {
  try {
    return decodeLeaseOwner(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return undefined
  }
}

async function releaseDirectoryLease(lease: DirectoryLease): Promise<void> {
  const owner = await readLease(lease.path)
  if (owner?.token === lease.token) await rm(lease.path, { force: true })
}

async function acquireDirectoryLease(
  path: string,
  owner: LeaseOwner,
  recoveryRoot: string,
): Promise<DirectoryLease> {
  const leasePath = `${path}.lease`
  await mkdir(dirname(path), { recursive: true })
  for (;;) {
    let handle
    try {
      handle = await open(leasePath, 'wx')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      const existing = await readLease(leasePath)
      if (existing === undefined) {
        throw new Error(`Isolation lease ${leasePath} has ambiguous ownership.`)
      }
      if (await processLives(existing)) {
        throw new Error(`Isolation lease ${path} belongs to live process ${existing.pid}.`)
      }
      await quarantine(leasePath, recoveryRoot)
      continue
    }
    try {
      await handle.writeFile(JSON.stringify(owner), 'utf8')
    } catch (error) {
      await rm(leasePath, { force: true })
      throw error
    } finally {
      await handle.close()
    }
    break
  }
  const lease = { path: leasePath, token: owner.token }
  try {
    if (await pathExists(path)) {
      const existing = await readOwner(path)
      if (existing !== undefined && (await processLives(existing))) {
        throw new Error(`Isolation lease ${path} belongs to live process ${existing.pid}.`)
      }
      await quarantine(path, recoveryRoot)
    }
    await mkdir(path)
    await writeOwner(path, owner)
    return lease
  } catch (error) {
    await releaseDirectoryLease(lease)
    throw error
  }
}

export async function recoverWriterIsolations(cwd: string): Promise<IsolationRecovery[]> {
  const root = await repositoryRoot(cwd)
  const worktrees = join(await commonDirectory(root), 'pi-subagent', WORKTREE_DIR)
  let entries
  try {
    entries = await readdir(worktrees, { withFileTypes: true })
  } catch {
    return []
  }
  const recoveries: IsolationRecovery[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(worktrees, entry.name)
    const directoryOwner = await readOwner(path)
    const leaseOwner = await readLease(`${path}.lease`)
    const owner = leaseOwner ?? directoryOwner
    if (owner !== undefined && (await processLives(owner))) continue
    const recovery: IsolationRecovery = {
      attemptId: owner?.attemptId,
      ownerStatus: owner === undefined ? 'ambiguous' : 'dead',
      path,
      writerId: owner?.writerId,
    }
    const isolation = await readWriterIsolation(path)
    if (isolation !== undefined) recovery.receipt = await captureWriterIsolation(isolation, false)
    else
      await writeFile(join(path, 'recovery.json'), JSON.stringify(recovery), 'utf8').catch(() => {})
    recoveries.push(recovery)
  }
  return recoveries
}

async function linkDependencyDirectories(
  sourceRoot: string,
  targetRoot: string,
): Promise<string[]> {
  const linked: string[] = []
  const walk = async (source: string, target: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(source, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git') continue
      const sourcePath = join(source, entry.name)
      const targetPath = join(target, entry.name)
      if (entry.name === 'node_modules') {
        if (!(await pathExists(targetPath))) {
          await symlink(sourcePath, targetPath, 'junction')
          linked.push(relative(targetRoot, targetPath))
        }
        continue
      }
      if (await pathExists(join(sourcePath, '.git'))) continue
      if (await pathExists(targetPath)) await walk(sourcePath, targetPath)
    }
  }
  await walk(sourceRoot, targetRoot)
  return linked
}

async function addWorktree(baseline: RepositoryBaseline, target: string): Promise<string[]> {
  await mkdir(dirname(target), { recursive: true })
  await git(baseline.repoRoot, ['worktree', 'add', '--detach', target, baseline.baselineCommit])
  return linkDependencyDirectories(baseline.repoRoot, target)
}

export async function createWriterIsolation(options: {
  cwd: string
  integration: IsolationIntegration
  writerId: string
}): Promise<WriterIsolation> {
  const root = await repositoryRoot(options.cwd)
  const nested = await nestedRepositories(root)
  const baselines = await Promise.all([
    syntheticBaseline(root, ''),
    ...nested.map(async (path) => syntheticBaseline(join(root, path), path)),
  ])
  const attemptId = randomUUID()
  const commonDir = baselines[0]?.commonDir
  if (commonDir === undefined) throw new Error('The root repository baseline is unavailable.')
  const storageRoot = join(commonDir, 'pi-subagent')
  const baseDir = join(storageRoot, WORKTREE_DIR, `${safeSegment(options.writerId)}-${attemptId}`)
  await mkdir(dirname(baseDir), { recursive: true })
  await recoverWriterIsolations(root)
  const lease = await acquireDirectoryLease(
    baseDir,
    await currentLeaseOwner(options.writerId, attemptId),
    join(storageRoot, RECOVERY_DIR),
  )
  const rootWorktree = join(baseDir, 'root')
  const repositories: RepositoryIsolation[] = []
  try {
    const rootBaseline = baselines[0]
    if (rootBaseline === undefined) throw new Error('The root repository baseline is unavailable.')
    const rootDependencies = await addWorktree(rootBaseline, rootWorktree)
    repositories.push({
      ...rootBaseline,
      dependencyPaths: rootDependencies,
      worktree: rootWorktree,
    })
    for (const baseline of baselines.slice(1)) {
      const target = join(rootWorktree, baseline.relativePath)
      await rm(target, { force: true, recursive: true })
      const dependencyPaths = await addWorktree(baseline, target)
      repositories.push({ ...baseline, dependencyPaths, worktree: target })
    }
    const isolation: WriterIsolation = {
      attemptId,
      baseDir,
      integration: options.integration,
      leasePath: lease.path,
      leaseToken: lease.token,
      repositories,
      rootWorktree,
      writerId: options.writerId,
    }
    await writeAtomicJson(join(baseDir, ISOLATION_FILE), isolation)
    return isolation
  } catch (error) {
    for (const repository of [...repositories].reverse()) {
      await git(repository.repoRoot, ['worktree', 'remove', '--force', repository.worktree]).catch(
        () => '',
      )
    }
    await quarantine(baseDir, join(storageRoot, RECOVERY_DIR)).catch(() => '')
    await releaseDirectoryLease(lease)
    throw error
  }
}

async function captureTree(
  repository: RepositoryIsolation,
  nestedRepositories: readonly RepositoryIsolation[],
): Promise<string> {
  const indexPath = join(await mkdtemp(join(tmpdir(), 'pi-subagent-index-')), 'index')
  try {
    await gitWithIndex(repository.worktree, indexPath, ['read-tree', repository.baselineCommit])
    await gitWithIndex(repository.worktree, indexPath, ['add', '-A', '--', '.'])
    for (const path of repository.dependencyPaths) {
      await gitWithIndex(repository.worktree, indexPath, [
        'update-index',
        '--force-remove',
        '--',
        path,
      ])
    }
    if (repository.relativePath.length === 0) {
      for (const nested of nestedRepositories) {
        await gitWithIndex(repository.worktree, indexPath, [
          'update-index',
          '--add',
          '--cacheinfo',
          `160000,${nested.sourceHead},${nested.relativePath}`,
        ])
      }
    }
    return (await gitWithIndex(repository.worktree, indexPath, ['write-tree'])).trim()
  } finally {
    await rm(dirname(indexPath), { force: true, recursive: true })
  }
}

function parseChangedFiles(output: string): IsolationChangedFile[] {
  const fields = output.split('\0').filter((field) => field.length > 0)
  const files: IsolationChangedFile[] = []
  let index = 0
  while (index < fields.length) {
    const status = fields[index]
    const firstPath = fields[index + 1]
    if (status === undefined || firstPath === undefined) break
    if (status.startsWith('R') || status.startsWith('C')) {
      const secondPath = fields[index + 2]
      if (secondPath === undefined) break
      files.push({ path: `${firstPath} -> ${secondPath}`, status })
      index += 3
    } else {
      files.push({ path: firstPath, status })
      index += 2
    }
  }
  return files
}

async function writePatch(
  isolation: WriterIsolation,
  repository: RepositoryIsolation,
  patch: string,
): Promise<IsolationPatchRef> {
  const artifactDir = join(dirname(dirname(isolation.baseDir)), 'artifacts', isolation.attemptId)
  await mkdir(artifactDir, { recursive: true })
  const name = repository.relativePath.length === 0 ? 'root' : safeSegment(repository.relativePath)
  const target = join(artifactDir, `${name}.patch`)
  const temporary = `${target}.${randomUUID()}.tmp`
  await writeFile(temporary, patch, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, target)
  return {
    byteLength: Buffer.byteLength(patch, 'utf8'),
    sha256: digest(patch),
    uri: pathToFileURL(target).href,
  }
}

async function updateArtifactRef(
  repository: RepositoryIsolation,
  ref: string,
  commit: string,
): Promise<void> {
  await git(repository.repoRoot, ['update-ref', ref, commit])
}

function artifactRef(isolation: WriterIsolation, repository: RepositoryIsolation): string {
  const repo = repository.relativePath.length === 0 ? 'root' : safeSegment(repository.relativePath)
  return `refs/pi-subagent/${safeSegment(isolation.writerId)}/${isolation.attemptId}/${repo}`
}

function branchName(isolation: WriterIsolation, repository: RepositoryIsolation): string {
  const repo = repository.relativePath.length === 0 ? 'root' : safeSegment(repository.relativePath)
  return `pi-subagent/${safeSegment(isolation.writerId)}/${isolation.attemptId.slice(0, 8)}/${repo}`
}

async function captureRepository(
  isolation: WriterIsolation,
  repository: RepositoryIsolation,
): Promise<IsolationRepositoryReceipt> {
  const resultTree = await captureTree(
    repository,
    isolation.repositories.filter((candidate) => candidate.relativePath.length > 0),
  )
  const patch = await git(repository.worktree, [
    'diff',
    '--binary',
    '--full-index',
    repository.baselineTree,
    resultTree,
  ])
  const resultCommit = await commitTree(
    repository.worktree,
    resultTree,
    repository.baselineCommit,
    `pi-subagent result ${isolation.attemptId}`,
  )
  const internalRef = artifactRef(isolation, repository)
  await updateArtifactRef(repository, internalRef, resultCommit)
  const branch = branchName(isolation, repository)
  if (isolation.integration === 'branch') {
    await git(repository.repoRoot, ['branch', '-f', branch, resultCommit])
  }
  const changedFiles = parseChangedFiles(
    await git(repository.worktree, [
      'diff',
      '--name-status',
      '-z',
      repository.baselineTree,
      resultTree,
    ]),
  )
  const diffstat = (
    await git(repository.worktree, ['diff', '--stat', repository.baselineTree, resultTree])
  ).trim()
  const receipt: IsolationRepositoryReceipt = {
    baselineCommit: repository.baselineCommit,
    baselineTree: repository.baselineTree,
    changedFiles,
    destinationHeadBefore: repository.sourceHead,
    diffstat,
    patch: await writePatch(isolation, repository, patch),
    relativePath: repository.relativePath,
    repoRoot: repository.repoRoot,
    resultCommit,
    resultTree,
    status: 'captured',
  }
  if (isolation.integration === 'branch') receipt.branch = branch
  return receipt
}

async function sourceTree(repository: IsolationRepositoryReceipt): Promise<string> {
  const baseline = await syntheticBaseline(repository.repoRoot, repository.relativePath)
  return baseline.baselineTree
}

async function integrationLockRoot(repoRoot: string): Promise<string> {
  return join(await commonDirectory(repoRoot), 'pi-subagent')
}

async function withIntegrationLock<Result>(
  repoRoot: string,
  owner: LeaseOwner,
  operation: () => Promise<Result>,
): Promise<Result> {
  const root = await integrationLockRoot(repoRoot)
  const lock = join(root, 'integration.lock')
  await mkdir(root, { recursive: true })
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    try {
      const lease = await acquireDirectoryLease(lock, owner, join(root, RECOVERY_DIR))
      try {
        return await operation()
      } finally {
        await rm(lock, { force: true, recursive: true })
        await releaseDirectoryLease(lease)
      }
    } catch (error) {
      if (!errorMessage(error).includes('belongs to live process')) throw error
      await delay(50)
    }
  }
  throw new Error(`Timed out while waiting for the integration lock at ${lock}.`)
}

async function applyRepository(
  isolation: Pick<IsolationReceipt, 'attemptId' | 'writerId'>,
  repository: IsolationRepositoryReceipt,
): Promise<IsolationRepositoryReceipt> {
  if (repository.changedFiles.length === 0) {
    return {
      ...repository,
      destinationHeadAfter: repository.destinationHeadBefore,
      status: 'integrated',
    }
  }
  const owner = await currentLeaseOwner(isolation.writerId, isolation.attemptId)
  try {
    return await withIntegrationLock(repository.repoRoot, owner, async () => {
      const currentHead = (await git(repository.repoRoot, ['rev-parse', 'HEAD'])).trim()
      if (currentHead !== repository.destinationHeadBefore) {
        throw new Error(
          `The destination HEAD changed from ${repository.destinationHeadBefore} to ${currentHead}.`,
        )
      }
      const currentTree = await sourceTree(repository)
      if (currentTree !== repository.baselineTree) {
        throw new Error(
          `The destination tree changed from ${repository.baselineTree} to ${currentTree}.`,
        )
      }
      const patchPath = fileURLToPath(repository.patch.uri)
      await git(repository.repoRoot, ['apply', '--binary', patchPath])
      const destinationHeadAfter = (await git(repository.repoRoot, ['rev-parse', 'HEAD'])).trim()
      if (destinationHeadAfter !== repository.destinationHeadBefore) {
        throw new Error('The destination HEAD changed during patch integration.')
      }
      const integratedTree = await sourceTree(repository)
      if (integratedTree !== repository.resultTree) {
        throw new Error(
          `Patch integration produced tree ${integratedTree} instead of ${repository.resultTree}.`,
        )
      }
      return { ...repository, destinationHeadAfter, status: 'integrated' }
    })
  } catch (error) {
    return { ...repository, error: errorMessage(error), status: 'conflict' }
  }
}

async function cleanupWorktrees(isolation: WriterIsolation): Promise<boolean> {
  let debt = false
  for (const repository of [...isolation.repositories].reverse()) {
    try {
      await git(repository.repoRoot, ['worktree', 'remove', '--force', repository.worktree])
    } catch {
      debt = true
    }
  }
  if (!debt) await rm(isolation.baseDir, { force: true, recursive: true })
  await releaseDirectoryLease({ path: isolation.leasePath, token: isolation.leaseToken })
  return debt
}

function isolationStatus(
  repositories: readonly IsolationRepositoryReceipt[],
): IsolationReceipt['status'] {
  const integrated = repositories.filter((repository) => repository.status === 'integrated').length
  const conflicts = repositories.filter((repository) => repository.status === 'conflict').length
  if (conflicts === 0) {
    return integrated === repositories.length && repositories.length > 0 ? 'integrated' : 'captured'
  }
  return integrated > 0 ? 'partial' : 'conflict'
}

export async function integrateWriterIsolation(
  receipt: IsolationReceipt,
): Promise<IsolationReceipt> {
  if (receipt.integration !== 'apply') return receipt
  const repositories: IsolationRepositoryReceipt[] = []
  for (const repository of receipt.repositories) {
    if (repositories.some((candidate) => candidate.status === 'conflict')) {
      repositories.push(repository)
    } else {
      repositories.push(await applyRepository(receipt, repository))
    }
  }
  return { ...receipt, repositories, status: isolationStatus(repositories) }
}

export async function captureWriterIsolation(
  isolation: WriterIsolation,
  allowIntegration: boolean,
): Promise<IsolationReceipt> {
  const captured: IsolationRepositoryReceipt[] = []
  let retainedPath: string | undefined
  try {
    const expectedNested = isolation.repositories
      .filter((repository) => repository.relativePath.length > 0)
      .map((repository) => repository.relativePath)
    const actualNested = await nestedRepositories(isolation.rootWorktree)
    if (
      expectedNested.length !== actualNested.length ||
      expectedNested.some((path, index) => path !== actualNested[index])
    ) {
      throw new Error('The isolated task changed a nested repository boundary.')
    }
    for (const repository of isolation.repositories) {
      captured.push(await captureRepository(isolation, repository))
    }
    const cleanupDebt = await cleanupWorktrees(isolation)
    if (cleanupDebt) retainedPath = isolation.baseDir
    const receipt: IsolationReceipt = {
      attemptId: isolation.attemptId,
      cleanupDebt,
      integration: isolation.integration,
      repositories: captured,
      status: 'captured',
      writerId: isolation.writerId,
    }
    if (retainedPath !== undefined) receipt.retainedPath = retainedPath
    return allowIntegration ? integrateWriterIsolation(receipt) : receipt
  } catch (error) {
    retainedPath = isolation.baseDir
    return {
      attemptId: isolation.attemptId,
      cleanupDebt: true,
      error: errorMessage(error),
      integration: isolation.integration,
      repositories: captured,
      retainedPath,
      status: 'conflict',
      writerId: isolation.writerId,
    }
  }
}
