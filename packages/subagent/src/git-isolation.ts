import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { DependencyMode, IsolationIntegration, IsolationPatchRef } from './schema.ts'
import {
  acquireLock,
  currentLockOwner,
  digest,
  errorMessage,
  joinEffectiveCwd,
  registerManifest,
  relativeCwdWithin,
  repositoryIdentity,
  withRepositoryLock,
  writeAtomicFile,
  writeManifest,
  type LockOwner,
  type RepositoryEntry,
  type WorkspaceContext,
  type WorkspaceManifest,
} from './workspace.ts'

export interface GitResult {
  stderr: string
  stdout: string
}

export interface RepositoryIsolation extends RepositoryEntry {
  dependencyMode: DependencyMode
  dependencyPaths: readonly string[]
  worktree: string
}

export interface WriterWorkspace {
  attemptId: string
  baseDir: string
  context: WorkspaceContext
  durableCommonDir: string
  integration: IsolationIntegration
  manifest: WorkspaceManifest
  manifestPath: string
  repositories: RepositoryIsolation[]
  rootWorktree: string
  storeRoot: string
  writerId: string
}

export function safeSegment(value: string): string {
  return digest(value).slice(0, 16)
}

async function run(cwd: string, command: readonly string[], input?: string): Promise<GitResult> {
  const executable = command[0]
  if (executable === undefined) throw new Error('The process command is empty.')
  return new Promise<GitResult>((resolveResult, reject) => {
    const child = spawn(executable, command.slice(1), { cwd, stdio: 'pipe' })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      const output = Buffer.concat(stdout).toString('utf8')
      const error = Buffer.concat(stderr).toString('utf8')
      if (exitCode !== 0) {
        const detail = error.trim().length > 0 ? error.trim() : output.trim()
        reject(new Error(`${command.join(' ')} failed${detail.length === 0 ? '' : `: ${detail}`}`))
        return
      }
      resolveResult({ stderr: error, stdout: output })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

export async function git(cwd: string, args: readonly string[], input?: string): Promise<string> {
  return (await run(cwd, ['git', ...args], input)).stdout
}

export async function gitWithIndex(
  cwd: string,
  indexPath: string,
  args: readonly string[],
): Promise<string> {
  return (await run(cwd, ['env', `GIT_INDEX_FILE=${indexPath}`, 'git', ...args])).stdout
}

export async function commitTree(
  cwd: string,
  tree: string,
  parent: string | undefined,
  message: string,
): Promise<string> {
  const args = [
    '-c',
    'user.name=Pi Subagent',
    '-c',
    'user.email=pi-subagent@localhost',
    'commit-tree',
    tree,
  ]
  if (parent !== undefined) args.push('-p', parent)
  return (await git(cwd, args, `${message}\n`)).trim()
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

export async function repositoryRoot(cwd: string): Promise<string | undefined> {
  try {
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
    return root.length === 0 ? undefined : await realpath(root)
  } catch {
    return undefined
  }
}

export async function commonDirectory(repoRoot: string): Promise<string> {
  const value = (
    await git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  ).trim()
  return realpath(resolve(repoRoot, value))
}

async function symbolicBranch(repoRoot: string): Promise<string | undefined> {
  try {
    const branch = (await git(repoRoot, ['symbolic-ref', '--short', 'HEAD'])).trim()
    return branch.length === 0 ? undefined : branch
  } catch {
    return undefined
  }
}

async function headCommit(repoRoot: string): Promise<string | undefined> {
  try {
    const commit = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
    return /^[0-9a-f]{40,64}$/.test(commit) ? commit : undefined
  } catch {
    return undefined
  }
}

export async function syntheticBaseline(
  repoRoot: string,
): Promise<{ baselineCommit: string; baselineTree: string; headState: 'committed' | 'unborn' }> {
  const head = await headCommit(repoRoot)
  const indexPath = join(await mkdtemp(join(tmpdir(), 'pi-subagent-index-')), 'index')
  try {
    if (head !== undefined) await gitWithIndex(repoRoot, indexPath, ['read-tree', 'HEAD'])
    await gitWithIndex(repoRoot, indexPath, ['add', '-A', '--', '.'])
    const baselineTree = (await gitWithIndex(repoRoot, indexPath, ['write-tree'])).trim()
    const baselineCommit = await commitTree(repoRoot, baselineTree, head, 'pi-subagent baseline')
    return { baselineCommit, baselineTree, headState: head === undefined ? 'unborn' : 'committed' }
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

export async function nestedRepositories(repoRoot: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (
    directory: string,
    ownerRoot: string,
    submodules: ReadonlySet<string>,
  ): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === '.git' || entry.name === 'node_modules') continue
      const path = join(directory, entry.name)
      const ownerRelativePath = relative(ownerRoot, path)
      if (submodules.has(ownerRelativePath)) continue
      if (await pathExists(join(path, '.git'))) {
        found.push(relative(repoRoot, path))
        const childSubmodules = await submodulePaths(path).catch(() => new Set<string>())
        await walk(path, path, childSubmodules)
        continue
      }
      await walk(path, ownerRoot, submodules)
    }
  }
  const rootSubmodules = await submodulePaths(repoRoot).catch(() => new Set<string>())
  await walk(repoRoot, repoRoot, rootSubmodules)
  return found.sort()
}

const INTERNAL_REF_PREFIX = 'refs/pi-subagent/v2'

export function baselineRef(attemptId: string, repositoryId: string): string {
  return `${INTERNAL_REF_PREFIX}/baseline/${attemptId}/${repositoryId}`
}

export function internalRef(
  rootWorkspaceId: string,
  writerId: string,
  attemptId: string,
  repositoryId: string,
): string {
  return `${INTERNAL_REF_PREFIX}/${rootWorkspaceId}/${safeSegment(writerId)}/${attemptId}/${repositoryId}`
}

async function objectExists(repoRoot: string, commit: string): Promise<boolean> {
  try {
    await git(repoRoot, ['cat-file', '-e', `${commit}^{commit}`])
    return true
  } catch {
    return false
  }
}

export async function promoteCommit(options: {
  commit: string
  durableCommonDir: string
  owner: LockOwner
  ref: string
  sourceRepoRoot: string
}): Promise<void> {
  const { commit, durableCommonDir, owner, ref, sourceRepoRoot } = options
  await withRepositoryLock(durableCommonDir, 'refs', owner, async () => {
    if (await objectExists(durableCommonDir, commit)) {
      await git(durableCommonDir, ['update-ref', ref, commit])
      return
    }
    const sourceRef = `refs/pi-subagent/promote-${randomUUID()}`
    await git(sourceRepoRoot, ['update-ref', sourceRef, commit])
    try {
      await git(durableCommonDir, ['fetch', '--no-tags', sourceRepoRoot, `${sourceRef}:${ref}`])
    } finally {
      await git(sourceRepoRoot, ['update-ref', '-d', sourceRef]).catch(() => '')
    }
    if (!(await objectExists(durableCommonDir, commit))) {
      throw new Error(`The durable repository cannot resolve promoted commit ${commit}.`)
    }
  })
}

export async function deleteRef(
  durableCommonDir: string,
  owner: LockOwner,
  ref: string,
): Promise<void> {
  await withRepositoryLock(durableCommonDir, 'refs', owner, async () => {
    await git(durableCommonDir, ['update-ref', '-d', ref]).catch(() => '')
  })
}

async function copyDirectory(source: string, target: string): Promise<'copy' | 'copy-on-write'> {
  await mkdir(dirname(target), { recursive: true })
  const command =
    process.platform === 'darwin'
      ? ['cp', '-cR', source, target]
      : ['cp', '-a', '--reflink=always', source, target]
  try {
    await run(dirname(source), command)
    return 'copy-on-write'
  } catch {
    await run(dirname(source), ['cp', '-aR', source, target])
    return 'copy'
  }
}

async function materializeDependencyDirectories(
  sourceRoot: string,
  targetRoot: string,
): Promise<{ dependencyMode: DependencyMode; paths: string[] }> {
  const copied: string[] = []
  let dependencyMode: DependencyMode = 'omitted'
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
        if (await pathExists(targetPath)) continue
        try {
          const mode = await copyDirectory(sourcePath, targetPath)
          copied.push(relative(targetRoot, targetPath))
          dependencyMode = dependencyMode === 'copy' || mode === 'copy' ? 'copy' : 'copy-on-write'
        } catch {}
        continue
      }
      if (await pathExists(join(sourcePath, '.git'))) continue
      if (await pathExists(targetPath)) await walk(sourcePath, targetPath)
    }
  }
  await walk(sourceRoot, targetRoot)
  return { dependencyMode, paths: copied }
}

async function sparseCheckoutState(
  repoRoot: string,
): Promise<{ enabled: boolean; patterns?: string }> {
  try {
    const enabled =
      (await git(repoRoot, ['config', '--bool', 'core.sparseCheckout'])).trim() === 'true'
    if (!enabled) return { enabled: false }
    const gitDir = (
      await git(repoRoot, ['rev-parse', '--path-format=absolute', '--git-dir'])
    ).trim()
    const patternsPath = join(gitDir, 'info', 'sparse-checkout')
    if (!(await pathExists(patternsPath))) return { enabled: false }
    return { enabled: true, patterns: await readFile(patternsPath, 'utf8') }
  } catch {
    return { enabled: false }
  }
}

async function checkoutTreeWithoutHead(target: string, tree: string): Promise<void> {
  const indexPath = join(await mkdtemp(join(tmpdir(), 'pi-subagent-index-')), 'index')
  try {
    await gitWithIndex(target, indexPath, ['read-tree', tree])
    await gitWithIndex(target, indexPath, ['checkout-index', '-a', '-f'])
  } finally {
    await rm(dirname(indexPath), { force: true, recursive: true })
  }
}

async function materializeRepository(baseline: RepositoryEntry, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  if (baseline.headState === 'unborn') {
    await git(target, ['init', '-b', baseline.symbolicHead ?? 'main'])
  } else {
    await git(target, ['init'])
  }
  const alternatesPath = join(target, '.git', 'objects', 'info', 'alternates')
  await mkdir(dirname(alternatesPath), { recursive: true })
  await writeFile(alternatesPath, `${join(baseline.durableCommonDir, 'objects')}\n`, 'utf8')
  if (baseline.headState === 'unborn') {
    await checkoutTreeWithoutHead(target, baseline.baselineTree)
    return
  }
  await git(target, ['update-ref', 'HEAD', baseline.baselineCommit])
  const sparse = await sparseCheckoutState(baseline.physicalRepoRoot)
  if (sparse.enabled && sparse.patterns !== undefined) {
    const targetGitDir = (
      await git(target, ['rev-parse', '--path-format=absolute', '--git-dir'])
    ).trim()
    await mkdir(join(targetGitDir, 'info'), { recursive: true })
    await writeFile(join(targetGitDir, 'info', 'sparse-checkout'), sparse.patterns, 'utf8')
    await git(target, ['config', 'core.sparseCheckout', 'true'])
  }
  await git(target, ['reset', '--hard', '--quiet'])
}

async function headEntry(
  repoRoot: string,
  headState: 'committed' | 'unborn',
): Promise<{ sourceHead?: string; symbolicHead?: string }> {
  if (headState === 'unborn') {
    const symbolicHead = await symbolicBranch(repoRoot)
    return symbolicHead === undefined ? {} : { symbolicHead }
  }
  const head = await headCommit(repoRoot)
  return head === undefined ? {} : { sourceHead: head }
}

export async function createWriterWorkspace(options: {
  durableCommonDir?: string
  integration: IsolationIntegration
  parent: WorkspaceContext
  parentPhysicalRoot: string
  relativeCwd: string
  spawnOrdinal: number
  writerId: string
}): Promise<WriterWorkspace> {
  const attemptId = randomUUID()
  const workspaceId = `ws-${digest(attemptId).slice(0, 16)}`
  const owner = await currentLockOwner(options.writerId, attemptId)
  const rootRepoRoot = await repositoryRoot(options.parentPhysicalRoot)
  if (rootRepoRoot === undefined) {
    throw new Error(`Git repository not found from ${options.parentPhysicalRoot}.`)
  }
  const rootCommonDir = await commonDirectory(rootRepoRoot)
  const durableCommonDir = options.durableCommonDir ?? rootCommonDir
  const storeRoot = join(durableCommonDir, 'pi-subagent')
  const baseDir = join(storeRoot, 'worktrees', `${workspaceId}-${attemptId}`)
  await mkdir(baseDir, { recursive: true })

  const manifest: WorkspaceManifest = {
    attemptId,
    createdAt: Date.now(),
    integration: options.integration,
    journals: [],
    logicalCwd: options.parent.logicalCwd,
    owner,
    ownerSessionId: options.parent.ownerSessionId,
    parentWorkspaceId: options.parent.workspaceId,
    physicalRoot: '',
    relativeCwd: options.relativeCwd,
    repositories: [],
    rootWorkspaceId: options.parent.rootWorkspaceId,
    scopeId: options.parent.scopeId,
    state: 'allocating',
    storeRoot,
    updatedAt: Date.now(),
    workspaceId,
    writerId: options.writerId,
  }
  const manifestPath = await writeManifest(manifest)
  await registerManifest(storeRoot, manifestPath, owner)
  const allocationLock = await acquireLock(
    join(storeRoot, 'locks', 'meta-allocation'),
    owner,
    join(storeRoot, 'locks', 'recovery'),
  )

  try {
    const nested = await nestedRepositories(rootRepoRoot)
    const rootBaseline = await syntheticBaseline(rootRepoRoot)
    const rootEntry: RepositoryEntry = {
      baselineCommit: rootBaseline.baselineCommit,
      baselineTree: rootBaseline.baselineTree,
      destinationRepoRoot: rootRepoRoot,
      durableCommonDir,
      headState: rootBaseline.headState,
      physicalRepoRoot: rootRepoRoot,
      relativePath: '',
      repositoryId: repositoryIdentity(durableCommonDir, ''),
      ...(await headEntry(rootRepoRoot, rootBaseline.headState)),
    }
    const entries: RepositoryEntry[] = [rootEntry]
    await promoteCommit({
      commit: rootBaseline.baselineCommit,
      durableCommonDir,
      owner,
      ref: baselineRef(attemptId, rootEntry.repositoryId),
      sourceRepoRoot: rootRepoRoot,
    })
    for (const nestedPath of nested) {
      const nestedRepoRoot = join(rootRepoRoot, nestedPath)
      const nestedBaseline = await syntheticBaseline(nestedRepoRoot)
      const entry: RepositoryEntry = {
        baselineCommit: nestedBaseline.baselineCommit,
        baselineTree: nestedBaseline.baselineTree,
        destinationRepoRoot: nestedRepoRoot,
        durableCommonDir,
        headState: nestedBaseline.headState,
        physicalRepoRoot: nestedRepoRoot,
        relativePath: nestedPath,
        repositoryId: repositoryIdentity(durableCommonDir, nestedPath),
        ...(await headEntry(nestedRepoRoot, nestedBaseline.headState)),
      }
      entries.push(entry)
      await promoteCommit({
        commit: nestedBaseline.baselineCommit,
        durableCommonDir,
        owner,
        ref: baselineRef(attemptId, entry.repositoryId),
        sourceRepoRoot: nestedRepoRoot,
      })
    }

    const rootWorktree = join(baseDir, 'root')
    manifest.physicalRoot = rootWorktree
    await writeManifest(manifest)
    const repositories: RepositoryIsolation[] = []
    for (const entry of entries) {
      const target =
        entry.relativePath.length === 0 ? rootWorktree : join(rootWorktree, entry.relativePath)
      if (entry.relativePath.length > 0) {
        await rm(target, { force: true, recursive: true })
      }
      await materializeRepository(entry, target)
      const dependencies = await materializeDependencyDirectories(entry.physicalRepoRoot, target)
      repositories.push({
        ...entry,
        dependencyMode: dependencies.dependencyMode,
        dependencyPaths: dependencies.paths,
        worktree: target,
      })
      manifest.repositories = repositories.map((repository) => ({ ...repository }))
      await writeManifest(manifest)
    }

    manifest.state = 'active'
    const updatedPath = await writeManifest(manifest)

    const context: WorkspaceContext = {
      logicalCwd: options.parent.logicalCwd,
      ownerSessionId: options.parent.ownerSessionId,
      parentWorkspaceId: options.parent.workspaceId,
      physicalRoot: rootWorktree,
      relativeCwd: options.relativeCwd,
      rootWorkspaceId: options.parent.rootWorkspaceId,
      scopeId: options.parent.scopeId,
      spawnOrdinal: options.spawnOrdinal,
      workspaceId,
    }
    return {
      attemptId,
      baseDir,
      context,
      durableCommonDir,
      integration: options.integration,
      manifest,
      manifestPath: updatedPath,
      repositories,
      rootWorktree,
      storeRoot,
      writerId: options.writerId,
    }
  } catch (error) {
    await rm(baseDir, { force: true, recursive: true }).catch(() => '')
    throw error
  } finally {
    await allocationLock.release()
  }
}

export async function captureResultTree(
  repository: RepositoryIsolation,
  nestedPaths: readonly string[] = [],
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
    for (const nestedPath of nestedPaths) {
      await gitWithIndex(repository.worktree, indexPath, [
        'update-index',
        '--force-remove',
        '--',
        nestedPath,
      ])
      const baselineEntry = await git(repository.worktree, [
        'ls-tree',
        repository.baselineTree,
        '--',
        nestedPath,
      ]).catch(() => '')
      const gitlink = baselineEntry.trim().match(/^160000\s+commit\s+([0-9a-f]+)/)
      if (gitlink?.[1] !== undefined) {
        await gitWithIndex(repository.worktree, indexPath, [
          'update-index',
          '--add',
          '--cacheinfo',
          `160000,${gitlink[1]},${nestedPath}`,
        ])
      }
    }
    return (await gitWithIndex(repository.worktree, indexPath, ['write-tree'])).trim()
  } finally {
    await rm(indexPath, { force: true })
    await rm(dirname(indexPath), { force: true, recursive: true })
  }
}

export function artifactDirectory(storeRoot: string, attemptId: string): string {
  return join(storeRoot, 'artifacts', attemptId)
}

export async function writePatchArtifact(options: {
  artifactRoot: string
  name: string
  patch: string
}): Promise<IsolationPatchRef> {
  await mkdir(options.artifactRoot, { recursive: true })
  const target = join(options.artifactRoot, `${options.name}.patch`)
  await writeAtomicFile(target, options.patch)
  return {
    byteLength: Buffer.byteLength(options.patch, 'utf8'),
    sha256: digest(options.patch),
    uri: pathToFileURL(target).href,
  }
}

export async function effectiveCwdFor(context: WorkspaceContext): Promise<string> {
  return joinEffectiveCwd(context.physicalRoot, context.relativeCwd)
}

export function relativeCwdFor(logicalTarget: string, physicalRoot: string): string {
  return relativeCwdWithin(physicalRoot, logicalTarget)
}

export { errorMessage }
