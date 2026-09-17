import { randomUUID } from 'node:crypto'
import { readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  artifactDirectory,
  baselineRef,
  captureResultTree,
  commonDirectory,
  commitTree,
  createWriterWorkspace,
  deleteRef,
  errorMessage,
  git,
  internalRef,
  nestedRepositories,
  promoteCommit,
  repositoryRoot,
  writePatchArtifact,
  type RepositoryIsolation,
  type WriterWorkspace,
} from './git-isolation.ts'
import {
  integrateRepositories,
  recoverIntegrationTransactions,
  type RepositoryIntegrationSpec,
} from './integration.ts'
import type {
  IsolationChangedFile,
  IsolationIntegration,
  IsolationPatchRef,
  IsolationReceipt,
  IsolationRepositoryReceipt,
  WorkspaceIdentity,
  WorkspaceLifecycle,
} from './schema.ts'
import {
  currentLockOwner,
  digest,
  listManifests,
  ownerStatus,
  readManifest,
  removeFromRegistry,
  writeManifest,
  withRepositoryLock,
  type LockOwner,
  type WorkspaceContext,
  type WorkspaceManifest,
} from './workspace.ts'

export type { RepositoryIsolation, WriterWorkspace } from './git-isolation.ts'

export interface IsolationDestination {
  destinationWorkspaceId: string
  destinationPhysicalRoot: string
  durableCommonDir: string
}

export interface IsolationRecovery {
  attemptId: string | undefined
  manifestPath: string
  ownerStatus: 'ambiguous' | 'dead'
  receipt: IsolationReceipt | undefined
  workspaceId: string
  writerId: string | undefined
}

const UNCAPTURED_STATES: ReadonlySet<WorkspaceLifecycle> = new Set<WorkspaceLifecycle>([
  'active',
  'closing',
])

const RECOVERABLE_CLEANUP_STATES: ReadonlySet<WorkspaceLifecycle> = new Set<WorkspaceLifecycle>([
  'captured',
  'staged',
  'integrating',
  'integrated',
  'cleanup-pending',
  'cleanup-debt',
])

export function needsRecoveryCapture(manifest: {
  repositories: ArrayLike<unknown>
  state: WorkspaceLifecycle
}): boolean {
  return manifest.repositories.length > 0 && UNCAPTURED_STATES.has(manifest.state)
}

function needsRecoveryCleanup(manifest: WorkspaceManifest): boolean {
  return manifest.repositories.length > 0 && RECOVERABLE_CLEANUP_STATES.has(manifest.state)
}

async function hasDurableCapture(manifest: WorkspaceManifest): Promise<boolean> {
  for (const repository of manifest.repositories) {
    const ref = internalRef(
      manifest.rootWorkspaceId,
      manifest.writerId,
      manifest.attemptId,
      repository.repositoryId,
    )
    try {
      const commit = (
        await git(repository.durableCommonDir, ['rev-parse', '--verify', `${ref}^{commit}`])
      ).trim()
      if (commit.length === 0) return false
    } catch {
      return false
    }
  }
  return true
}

export async function createIsolation(options: {
  destination: IsolationDestination
  integration: IsolationIntegration
  parent: WorkspaceContext
  relativeCwd: string
  spawnOrdinal: number
  writerId: string
}): Promise<WriterWorkspace> {
  return createWriterWorkspace({
    durableCommonDir: options.destination.durableCommonDir,
    integration: options.integration,
    parent: options.parent,
    parentPhysicalRoot: options.destination.destinationPhysicalRoot,
    relativeCwd: options.relativeCwd,
    spawnOrdinal: options.spawnOrdinal,
    writerId: options.writerId,
  })
}

function artifactPath(patch: IsolationPatchRef): string {
  if (patch.path !== undefined) return patch.path
  try {
    return fileURLToPath(patch.uri)
  } catch {
    throw new Error('The captured patch artifact URI is invalid.')
  }
}

async function verifiedPatch(patch: IsolationPatchRef): Promise<string> {
  let contents: string
  try {
    contents = await readFile(artifactPath(patch), 'utf8')
  } catch {
    throw new Error('The captured patch artifact is missing.')
  }
  if (
    Buffer.byteLength(contents, 'utf8') !== patch.byteLength ||
    digest(contents) !== patch.sha256
  ) {
    throw new Error('The captured patch artifact digest does not match its receipt.')
  }
  return contents
}

function descendantPaths(
  repositories: readonly { relativePath: string }[],
  repositoryRelativePath: string,
): string[] {
  return repositories
    .filter((candidate) => {
      if (candidate.relativePath.length === 0) return false
      if (repositoryRelativePath.length === 0) return true
      return candidate.relativePath.startsWith(`${repositoryRelativePath}/`)
    })
    .map((candidate) =>
      repositoryRelativePath.length === 0
        ? candidate.relativePath
        : candidate.relativePath.slice(repositoryRelativePath.length + 1),
    )
}

function assertMatchingRepositoryPaths(
  workspace: WriterWorkspace,
  receipt: IsolationReceipt,
  identity: WorkspaceIdentity,
): 'baseline' | 'adopted' {
  const snapshots = identity.snapshot.repositories
  const adopted = workspace.repositories.every(
    (repository, index) => repository.baselineTree === receipt.repositories[index]?.resultTree,
  )
  if (
    workspace.repositories.length !== receipt.repositories.length ||
    workspace.repositories.length !== snapshots.length
  ) {
    throw new Error('The resumed workspace repository boundary changed.')
  }
  for (let index = 0; index < workspace.repositories.length; index += 1) {
    const current = workspace.repositories[index]
    const captured = receipt.repositories[index]
    const snapshot = snapshots[index]
    if (current === undefined || captured === undefined || snapshot === undefined) {
      throw new Error('The captured workspace repository evidence is incomplete.')
    }
    if (
      current.relativePath !== captured.relativePath ||
      current.relativePath !== snapshot.relativePath ||
      (!adopted && current.baselineTree !== captured.baselineTree) ||
      captured.baselineTree !== snapshot.tree ||
      snapshot.base !== snapshot.tree
    ) {
      throw new Error('The resumed workspace does not match the captured baseline.')
    }
  }
  const root = workspace.repositories[0]
  const capturedRoot = receipt.repositories[0]
  if (
    root === undefined ||
    capturedRoot === undefined ||
    capturedRoot.baselineTree !== identity.baselineTree ||
    capturedRoot.baselineTree !== identity.expectedTree ||
    (!adopted && root.sourceHead !== identity.productHead)
  ) {
    throw new Error('The resumed workspace does not match the captured product identity.')
  }
  return adopted ? 'adopted' : 'baseline'
}

async function verifyCapturedRepository(
  workspace: WriterWorkspace,
  captured: IsolationRepositoryReceipt,
): Promise<string> {
  const current = workspace.repositories.find(
    (repository) => repository.relativePath === captured.relativePath,
  )
  if (current === undefined)
    throw new Error('The captured repository is unavailable in the new isolation.')
  if (captured.durableRef === undefined) {
    throw new Error('The captured durable artifact reference is missing.')
  }
  const durableCommit = (
    await git(current.durableCommonDir, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${captured.durableRef}^{commit}`,
    ]).catch(() => '')
  ).trim()
  if (durableCommit !== captured.resultCommit) {
    throw new Error('The captured durable artifact no longer matches its receipt.')
  }
  const durableTree = (
    await git(current.durableCommonDir, ['rev-parse', `${captured.resultCommit}^{tree}`]).catch(
      () => '',
    )
  ).trim()
  if (durableTree !== captured.resultTree) {
    throw new Error('The captured durable artifact result tree is stale.')
  }
  const patch = await verifiedPatch(captured.patch)
  const expected =
    captured.resultTree === captured.baselineTree
      ? ''
      : await git(current.worktree, [
          'diff',
          '--binary',
          '--full-index',
          captured.baselineTree,
          captured.resultTree,
        ])
  if (patch !== expected) {
    throw new Error('The captured patch artifact does not match its durable result.')
  }
  return patch
}

export async function reconstructCapturedIsolation(options: {
  identity: WorkspaceIdentity
  receipt: IsolationReceipt
  workspace: WriterWorkspace
}): Promise<void> {
  const { identity, receipt, workspace } = options
  if (receipt.integrationStatus === 'integrated' || receipt.status === 'integrated') return
  if (receipt.captureStatus !== 'captured' || receipt.status !== 'captured') {
    throw new Error('Only an unintegrated captured isolation can be reconstructed.')
  }
  const source = assertMatchingRepositoryPaths(workspace, receipt, identity)
  for (const snapshot of identity.snapshot.repositories) await verifiedPatch(snapshot.patch)
  const patches = await Promise.all(
    receipt.repositories.map((repository) => verifyCapturedRepository(workspace, repository)),
  )
  if (source === 'adopted') return
  for (let index = 0; index < receipt.repositories.length; index += 1) {
    const repository = receipt.repositories[index]
    const patch = patches[index]
    const current = workspace.repositories[index]
    if (repository === undefined || patch === undefined || current === undefined) {
      throw new Error('The captured reconstruction evidence is incomplete.')
    }
    if (patch.length === 0) continue
    try {
      await git(
        current.worktree,
        ['apply', '--check', '--binary', '--whitespace=nowarn', '-'],
        patch,
      )
      await git(current.worktree, ['apply', '--binary', '--whitespace=nowarn', '-'], patch)
    } catch {
      throw new Error('The captured work-in-progress conflicts with the new isolated workspace.')
    }
    const reconstructedTree = await captureResultTree(
      current,
      descendantPaths(workspace.repositories, current.relativePath),
    )
    if (reconstructedTree !== repository.resultTree) {
      throw new Error('The reconstructed isolated workspace does not match the captured result.')
    }
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

export async function captureIsolation(workspace: WriterWorkspace): Promise<IsolationReceipt> {
  await workspace.dependencies
  const owner = await currentLockOwner(workspace.writerId, workspace.attemptId)
  const expectedNested = workspace.repositories
    .filter((repository) => repository.relativePath.length > 0)
    .map((repository) => repository.relativePath)
  const actualNested = await nestedRepositories(workspace.rootWorktree)
  if (!(await matchesRepositoryBoundaries(workspace, expectedNested, actualNested))) {
    return failureReceipt(workspace, 'The isolated task changed a nested repository boundary.')
  }

  const repositories: IsolationRepositoryReceipt[] = []
  try {
    for (const repository of workspace.repositories) {
      repositories.push(await captureRepository(workspace, repository, owner))
    }
    await deleteBaselineRefs(workspace, owner)
    return {
      attemptId: workspace.attemptId,
      captureStatus: 'captured',
      cleanupDebt: false,
      dependencyMode: workspace.repositories[0]?.dependencyMode ?? 'none',
      integration: workspace.integration,
      integrationStatus: 'not-requested',
      manifestUri: workspace.manifestPath,
      parentWorkspaceId: workspace.context.parentWorkspaceId,
      repositories,
      rootWorkspaceId: workspace.context.rootWorkspaceId,
      rootVisibility: 'pending',
      status: 'captured',
      workspaceId: workspace.context.workspaceId,
      writerId: workspace.writerId,
    }
  } catch (error) {
    const receipt = failureReceipt(workspace, errorMessage(error))
    receipt.repositories = repositories
    return receipt
  }
}

async function matchesRepositoryBoundaries(
  workspace: WriterWorkspace,
  expected: readonly string[],
  actual: readonly string[],
): Promise<boolean> {
  if (expected.some((path) => !actual.includes(path))) return false
  const references: string[] = []
  for (const path of actual) {
    if (expected.includes(path) || references.some((parent) => path.startsWith(`${parent}/`)))
      continue
    const owner = workspace.repositories
      .filter(
        (repository) =>
          repository.relativePath === '' || path.startsWith(`${repository.relativePath}/`),
      )
      .sort((left, right) => right.relativePath.length - left.relativePath.length)[0]
    if (owner === undefined) return false
    const relativePath =
      owner.relativePath === '' ? path : path.slice(owner.relativePath.length + 1)
    if (!(await isBaselineReference(owner, relativePath))) return false
    references.push(path)
  }
  return true
}

async function isBaselineReference(
  repository: RepositoryIsolation,
  path: string,
): Promise<boolean> {
  try {
    if (
      (await git(repository.worktree, ['ls-tree', repository.baselineTree, '--', path])).trim() !==
      ''
    )
      return false
    const rules: string[] = []
    let directory = dirname(path)
    for (;;) {
      const rule = directory === '.' ? '.gitignore' : `${directory}/.gitignore`
      const baseline = await git(repository.worktree, [
        'show',
        `${repository.baselineTree}:${rule}`,
      ]).catch(() => undefined)
      const current = await readFile(join(repository.worktree, rule), 'utf8').catch(() => undefined)
      if (baseline !== current) return false
      if (baseline !== undefined) rules.push(rule)
      if (directory === '.') break
      directory = dirname(directory)
    }
    const ignored = await git(
      repository.worktree,
      ['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '--verbose', '-z', '--stdin'],
      `${path}\0`,
    )
    const [source, , pattern] = ignored.split('\0')
    return (
      source !== undefined &&
      rules.includes(source) &&
      pattern !== undefined &&
      !pattern.startsWith('!')
    )
  } catch {
    return false
  }
}

function failureReceipt(workspace: WriterWorkspace, error: string): IsolationReceipt {
  return {
    attemptId: workspace.attemptId,
    captureStatus: 'failed',
    cleanupDebt: true,
    dependencyMode: workspace.repositories[0]?.dependencyMode ?? 'none',
    error,
    integration: workspace.integration,
    integrationStatus: 'not-requested',
    manifestUri: workspace.manifestPath,
    parentWorkspaceId: workspace.context.parentWorkspaceId,
    repositories: [],
    retainedPath: workspace.rootWorktree,
    rootWorkspaceId: workspace.context.rootWorkspaceId,
    rootVisibility: 'pending',
    status: 'conflict',
    workspaceId: workspace.context.workspaceId,
    writerId: workspace.writerId,
  }
}

function descendantRepositoryPaths(
  repositories: readonly { relativePath: string }[],
  repositoryRelativePath: string,
): string[] {
  return repositories
    .filter((candidate) => {
      if (candidate.relativePath.length === 0) return false
      if (repositoryRelativePath.length === 0) return true
      return candidate.relativePath.startsWith(`${repositoryRelativePath}/`)
    })
    .map((candidate) =>
      repositoryRelativePath.length === 0
        ? candidate.relativePath
        : candidate.relativePath.slice(repositoryRelativePath.length + 1),
    )
}

async function captureRepository(
  workspace: WriterWorkspace,
  repository: RepositoryIsolation,
  owner: LockOwner,
): Promise<IsolationRepositoryReceipt> {
  const relevantNestedPaths = descendantRepositoryPaths(
    workspace.repositories,
    repository.relativePath,
  )
  const resultTree = await captureResultTree(repository, relevantNestedPaths)
  const patch =
    resultTree === repository.baselineTree
      ? ''
      : await git(repository.worktree, [
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
    `pi-subagent result ${workspace.attemptId}`,
  )
  const ref = internalRef(
    workspace.context.rootWorkspaceId,
    workspace.writerId,
    workspace.attemptId,
    repository.repositoryId,
  )
  await promoteCommit({
    commit: resultCommit,
    durableCommonDir: repository.durableCommonDir,
    owner,
    ref,
    sourceRepoRoot: repository.worktree,
  })
  let branch: string | undefined
  if (workspace.integration === 'branch') {
    const branchName = `pi-subagent/${workspace.writerId}/${workspace.attemptId.slice(0, 8)}/${repository.repositoryId}`
    branch = branchName
    await withRepositoryLock(repository.durableCommonDir, 'refs', owner, async () => {
      await git(repository.durableCommonDir, ['branch', '-f', branchName, resultCommit])
    })
  }
  const changedFiles = parseChangedFiles(
    resultTree === repository.baselineTree
      ? ''
      : await git(repository.worktree, [
          'diff',
          '--name-status',
          '-z',
          repository.baselineTree,
          resultTree,
        ]),
  )
  const diffstat =
    resultTree === repository.baselineTree
      ? ''
      : (
          await git(repository.worktree, ['diff', '--stat', repository.baselineTree, resultTree])
        ).trim()
  const patchRef: IsolationPatchRef = await writePatchArtifact({
    artifactRoot: artifactDirectory(workspace.storeRoot, workspace.attemptId),
    name: repository.relativePath.length === 0 ? 'root' : repository.repositoryId,
    patch,
  })
  const captured: IsolationRepositoryReceipt = {
    baselineCommit: repository.baselineCommit,
    baselineTree: repository.baselineTree,
    changedFiles,
    destinationHeadBefore: repository.sourceHead ?? '',
    diffstat,
    durableRef: ref,
    headState: repository.headState,
    patch: patchRef,
    relativePath: repository.relativePath,
    repoRoot: repository.worktree,
    repositoryId: repository.repositoryId,
    resultCommit,
    resultTree,
    status: 'captured',
    transactionPhase: 'planned',
  }
  if (branch !== undefined) captured.branch = branch
  return captured
}

async function deleteBaselineRefs(workspace: WriterWorkspace, owner: LockOwner): Promise<void> {
  for (const repository of workspace.repositories) {
    await deleteRef(
      repository.durableCommonDir,
      owner,
      baselineRef(workspace.attemptId, repository.repositoryId),
    ).catch(() => {})
  }
}

export async function integrateStagedReceipt(
  receipt: IsolationReceipt,
  destination: IsolationDestination,
  writerId: string,
  beforeApply?: () => void,
): Promise<IsolationReceipt> {
  if (receipt.integration !== 'apply') return receipt
  if (receipt.repositories.length === 0) {
    beforeApply?.()
    return receipt.captureStatus === 'captured'
      ? { ...receipt, integrationStatus: 'integrated', status: 'integrated' }
      : receipt
  }
  const owner = await currentLockOwner(writerId, receipt.attemptId)
  const specs: RepositoryIntegrationSpec[] = receipt.repositories.map((repository) => ({
    baselineCommit: repository.baselineCommit,
    baselineTree: repository.baselineTree,
    destinationPhysicalRoot: destination.destinationPhysicalRoot,
    durableCommonDir: destination.durableCommonDir,
    nestedPaths: descendantRepositoryPaths(receipt.repositories, repository.relativePath),
    patch: repository.patch,
    relativePath: repository.relativePath,
    repositoryId: repository.repositoryId ?? '',
    resultCommit: repository.resultCommit,
    resultTree: repository.resultTree,
  }))
  const outcomes = await integrateRepositories({
    artifactRoot: receiptArtifactDirectory(receipt),
    beforeApply,
    destinationWorkspaceId: destination.destinationWorkspaceId,
    owner,
    repositories: specs,
  })
  const repositories = receipt.repositories.map((repository) => {
    const outcome = outcomes.find((candidate) => candidate.repositoryId === repository.repositoryId)
    if (outcome === undefined) return repository
    const updated: IsolationRepositoryReceipt = {
      ...repository,
      status:
        outcome.status === 'integrated'
          ? 'integrated'
          : outcome.status === 'conflict'
            ? 'conflict'
            : 'recovery-required',
      transactionPhase: outcome.transactionPhase,
    }
    if (outcome.currentTree !== undefined) updated.currentTree = outcome.currentTree
    if (outcome.destinationHeadAfter !== undefined) {
      updated.destinationHeadAfter = outcome.destinationHeadAfter
    }
    if (outcome.mergedTree !== undefined) updated.mergedTree = outcome.mergedTree
    if (outcome.mergeArtifacts !== undefined) updated.mergeArtifacts = outcome.mergeArtifacts
    if (outcome.error !== undefined) updated.error = outcome.error
    return updated
  })
  if (receipt.manifestUri !== undefined && outcomes[0] !== undefined) {
    const manifest = await readManifest(receipt.manifestUri)
    if (manifest !== undefined && !manifest.journals.includes(outcomes[0].journalUri)) {
      manifest.journals.push(outcomes[0].journalUri)
      await writeManifest(manifest)
    }
  }
  const status = isolationStatus(repositories)
  const integrated: IsolationReceipt = {
    ...receipt,
    destinationWorkspaceId: destination.destinationWorkspaceId,
    integrationStatus:
      status === 'integrated' ? 'integrated' : status === 'conflict' ? 'conflict' : 'blocked',
    repositories,
    rootVisibility:
      status !== 'integrated'
        ? 'blocked'
        : destination.destinationWorkspaceId === receipt.rootWorkspaceId
          ? 'visible'
          : 'pending',
    status,
  }
  if (outcomes[0] !== undefined) integrated.journalUri = outcomes[0].journalUri
  return integrated
}

function receiptArtifactDirectory(receipt: IsolationReceipt): string {
  if (receipt.manifestUri !== undefined && receipt.manifestUri.length > 0) {
    return join(dirname(dirname(dirname(receipt.manifestUri))), 'artifacts', receipt.attemptId)
  }
  return join('.pi-subagent-artifacts', receipt.attemptId)
}

function isolationStatus(
  repositories: readonly IsolationRepositoryReceipt[],
): IsolationReceipt['status'] {
  const integrated = repositories.filter((repository) => repository.status === 'integrated').length
  const conflicts = repositories.filter((repository) => repository.status === 'conflict').length
  const failures = repositories.filter(
    (repository) => repository.status === 'recovery-required',
  ).length
  if (failures > 0) return 'partial'
  if (conflicts === 0) {
    return integrated === repositories.length && repositories.length > 0 ? 'integrated' : 'captured'
  }
  return integrated > 0 ? 'partial' : 'conflict'
}

async function hasValidWorkspaceLocation(workspace: WriterWorkspace): Promise<boolean> {
  const { workspaceId } = workspace.context
  if (!/^ws-[a-f0-9]{16}$/.test(workspaceId) || !/^[a-f0-9-]{36}$/.test(workspace.attemptId)) {
    return false
  }
  const expectedBase = join(
    workspace.storeRoot,
    'worktrees',
    `${workspaceId}-${workspace.attemptId}`,
  )
  if (
    workspace.baseDir !== expectedBase ||
    workspace.manifestPath !== join(expectedBase, 'manifest.json')
  ) {
    return false
  }
  const prefix = `pi-subagent-${workspaceId}-${workspace.attemptId}-`
  const external =
    dirname(workspace.rootWorktree) === (await realpath(tmpdir())) &&
    basename(workspace.rootWorktree).startsWith(prefix) &&
    /^[A-Za-z0-9]{6}$/.test(basename(workspace.rootWorktree).slice(prefix.length))
  return workspace.rootWorktree === join(expectedBase, 'root') || external
}

export async function recaptureRetainedIsolation(options: {
  receipt: IsolationReceipt
  identity: WorkspaceIdentity
  ownerSessionId: string
  writerId: string
  durableCommonDir: string
}): Promise<IsolationReceipt> {
  const { receipt, identity } = options
  const manifest =
    receipt.manifestUri === undefined ? undefined : await readManifest(receipt.manifestUri)
  if (manifest === undefined || receipt.manifestUri === undefined)
    throw new Error('The retained workspace manifest is unavailable.')
  const workspace = workspaceFromManifest(manifest, receipt.manifestUri)
  if (
    receipt.captureStatus !== 'failed' ||
    receipt.integrationStatus !== 'not-requested' ||
    manifest.ownerSessionId !== options.ownerSessionId ||
    manifest.writerId !== options.writerId ||
    receipt.writerId !== options.writerId ||
    manifest.attemptId !== receipt.attemptId ||
    manifest.workspaceId !== receipt.workspaceId ||
    manifest.parentWorkspaceId !== receipt.parentWorkspaceId ||
    manifest.rootWorkspaceId !== receipt.rootWorkspaceId ||
    manifest.physicalRoot !== receipt.retainedPath ||
    manifest.integration !== receipt.integration ||
    manifest.storeRoot !== join(options.durableCommonDir, 'pi-subagent') ||
    !(await hasValidWorkspaceLocation(workspace))
  )
    throw new Error('The retained workspace does not match its execution ownership and location.')
  if (workspace.repositories.length !== identity.snapshot.repositories.length)
    throw new Error('The retained workspace repository boundary changed.')
  for (const [index, repository] of workspace.repositories.entries()) {
    const snapshot = identity.snapshot.repositories[index]
    if (
      snapshot === undefined ||
      repository.relativePath !== snapshot.relativePath ||
      repository.baselineTree !== snapshot.tree ||
      snapshot.tree !== snapshot.base ||
      repository.physicalRepoRoot !== snapshot.root ||
      repository.durableCommonDir !== options.durableCommonDir ||
      repository.worktree !== join(workspace.rootWorktree, repository.relativePath) ||
      (await realpath(repository.worktree)) !== repository.worktree ||
      (await commonDirectory(repository.worktree)) !== join(repository.worktree, '.git') ||
      (
        await git(repository.worktree, ['rev-parse', `${repository.baselineCommit}^{tree}`])
      ).trim() !== repository.baselineTree
    )
      throw new Error('The retained workspace does not match its recorded baseline.')
    await verifiedPatch(snapshot.patch)
  }
  const root = workspace.repositories[0]
  if (
    root?.baselineTree !== identity.baselineTree ||
    identity.expectedTree !== identity.baselineTree ||
    root.sourceHead !== identity.productHead
  )
    throw new Error('The retained workspace product identity changed.')
  return captureIsolation(workspace)
}

export async function cleanupWorkspaceArtifacts(workspace: WriterWorkspace): Promise<boolean> {
  try {
    await workspace.dependencies
    if (!(await hasValidWorkspaceLocation(workspace))) return true
    await rm(workspace.rootWorktree, { force: true, recursive: true })
    await rm(workspace.baseDir, { force: true, recursive: true })
    await removeFromRegistry(workspace.storeRoot, workspace.manifestPath, workspace.manifest.owner)
    return false
  } catch {
    return true
  }
}

export async function cleanupCapturedReceipt(receipt: IsolationReceipt): Promise<boolean> {
  if (receipt.manifestUri === undefined) return receipt.cleanupDebt
  const manifest = await readManifest(receipt.manifestUri)
  if (manifest === undefined) return receipt.cleanupDebt
  return cleanupWorkspaceArtifacts(workspaceFromManifest(manifest, receipt.manifestUri))
}

export async function recoverIsolations(cwd: string): Promise<IsolationRecovery[]> {
  const root = await repositoryRoot(cwd)
  if (root === undefined) return []
  return recoverIsolationStore(join(await commonDirectory(root), 'pi-subagent'))
}

export async function recoverIsolationStore(storeRoot: string): Promise<IsolationRecovery[]> {
  await recoverIntegrationTransactions(storeRoot)
  const manifestPaths = await listManifests(storeRoot)
  const manifests: { manifest: WorkspaceManifest; path: string }[] = []
  for (const path of manifestPaths) {
    const manifest = await readManifest(path)
    if (manifest !== undefined) manifests.push({ manifest, path })
  }

  const classifications = new Map<string, 'ambiguous' | 'dead' | 'live'>()
  for (const { manifest } of manifests) {
    classifications.set(manifest.workspaceId, await ownerStatus(manifest.owner))
  }

  const remaining = new Map(manifests.map((entry) => [entry.manifest.workspaceId, entry]))
  const ordered: typeof manifests = []
  while (remaining.size > 0) {
    const leaves = [...remaining.values()].filter(
      (entry) =>
        ![...remaining.values()].some(
          (candidate) =>
            candidate.manifest.workspaceId !== entry.manifest.workspaceId &&
            candidate.manifest.parentWorkspaceId === entry.manifest.workspaceId,
        ),
    )
    if (leaves.length === 0) {
      for (const workspaceId of remaining.keys()) classifications.set(workspaceId, 'ambiguous')
      ordered.push(...remaining.values())
      break
    }
    leaves.sort((left, right) =>
      left.manifest.workspaceId.localeCompare(right.manifest.workspaceId),
    )
    for (const leaf of leaves) {
      ordered.push(leaf)
      remaining.delete(leaf.manifest.workspaceId)
    }
  }

  const recoveries: IsolationRecovery[] = []
  for (const { manifest, path } of ordered) {
    const classification = classifications.get(manifest.workspaceId) ?? 'ambiguous'
    if (classification === 'live' || manifest.state === 'cleaned') continue
    let receipt: IsolationReceipt | undefined
    if (classification === 'dead') {
      const workspace = workspaceFromManifest(manifest, path)
      if (needsRecoveryCapture(manifest)) {
        receipt = await captureIsolation(workspace).catch(() => undefined)
        const durableCapture =
          receipt?.captureStatus === 'captured' &&
          receipt.repositories.length === manifest.repositories.length &&
          receipt.repositories.every((repository) => repository.durableRef !== undefined)
        if (durableCapture && receipt !== undefined) {
          receipt.cleanupDebt = await cleanupWorkspaceArtifacts(workspace)
        }
      } else if (needsRecoveryCleanup(manifest) && (await hasDurableCapture(manifest))) {
        await cleanupWorkspaceArtifacts(workspace)
      }
    }
    recoveries.push({
      attemptId: manifest.attemptId,
      manifestPath: path,
      ownerStatus: classification,
      receipt,
      workspaceId: manifest.workspaceId,
      writerId: manifest.writerId,
    })
  }
  return recoveries
}

function workspaceFromManifest(manifest: WorkspaceManifest, path: string): WriterWorkspace {
  const repositories: RepositoryIsolation[] = manifest.repositories.map((entry) => ({
    ...entry,
    worktree:
      entry.worktree.length > 0
        ? entry.worktree
        : entry.relativePath.length === 0
          ? manifest.physicalRoot
          : join(manifest.physicalRoot, entry.relativePath),
  }))
  return {
    attemptId: manifest.attemptId,
    baseDir: join(manifest.storeRoot, 'worktrees', `${manifest.workspaceId}-${manifest.attemptId}`),
    context: {
      logicalCwd: manifest.logicalCwd,
      ownerSessionId: manifest.ownerSessionId,
      parentWorkspaceId: manifest.parentWorkspaceId,
      physicalRoot: manifest.physicalRoot,
      relativeCwd: manifest.relativeCwd,
      rootWorkspaceId: manifest.rootWorkspaceId,
      scopeId: manifest.scopeId,
      spawnOrdinal: 0,
      workspaceId: manifest.workspaceId,
    },
    dependencies: Promise.resolve(),
    durableCommonDir: manifest.repositories[0]?.durableCommonDir ?? manifest.storeRoot,
    integration: manifest.integration ?? 'manual',
    manifest,
    manifestPath: path,
    repositories,
    rootWorktree: manifest.physicalRoot,
    storeRoot: manifest.storeRoot,
    writerId: manifest.writerId,
  }
}

export { randomUUID as isolationAttemptId }
