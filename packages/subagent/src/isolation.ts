import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

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
} from './schema.ts'
import {
  currentLockOwner,
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
  const owner = await currentLockOwner(workspace.writerId, workspace.attemptId)
  const expectedNested = workspace.repositories
    .filter((repository) => repository.relativePath.length > 0)
    .map((repository) => repository.relativePath)
  const actualNested = await nestedRepositories(workspace.rootWorktree)
  if (
    expectedNested.length !== actualNested.length ||
    expectedNested.some((path, index) => path !== actualNested[index])
  ) {
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
    retainedPath: workspace.baseDir,
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

export async function cleanupWorkspaceArtifacts(workspace: WriterWorkspace): Promise<boolean> {
  try {
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
  try {
    await rm(
      join(manifest.storeRoot, 'worktrees', `${manifest.workspaceId}-${manifest.attemptId}`),
      { force: true, recursive: true },
    )
    await removeFromRegistry(manifest.storeRoot, receipt.manifestUri, manifest.owner)
    return false
  } catch {
    return true
  }
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
    if (classification === 'dead' && manifest.repositories.length > 0) {
      const workspace = workspaceFromManifest(manifest, path)
      receipt = await captureIsolation(workspace).catch(() => undefined)
      const durableCapture =
        receipt?.captureStatus === 'captured' &&
        receipt.repositories.length === manifest.repositories.length &&
        receipt.repositories.every((repository) => repository.durableRef !== undefined)
      if (durableCapture) {
        await rm(
          join(manifest.storeRoot, 'worktrees', `${manifest.workspaceId}-${manifest.attemptId}`),
          { force: true, recursive: true },
        ).catch(() => {})
        await removeFromRegistry(manifest.storeRoot, path, manifest.owner).catch(() => {})
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
