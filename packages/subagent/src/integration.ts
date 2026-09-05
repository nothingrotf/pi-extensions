import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import {
  commitTree,
  errorMessage,
  git,
  gitWithIndex,
  promoteCommit,
  writePatchArtifact,
} from './git-isolation.ts'
import type { IsolationPatchRef, MergeArtifacts, TransactionPhase } from './schema.ts'
import {
  acquireLock,
  currentLockOwner,
  ownerStatus,
  sortedRepositoryIds,
  withRepositoryLock,
  writeAtomicJson,
  type LockOwner,
} from './workspace.ts'

export interface RepositoryIntegrationSpec {
  baselineCommit: string
  baselineTree: string
  destinationPhysicalRoot: string
  durableCommonDir: string
  nestedPaths: readonly string[]
  patch: IsolationPatchRef
  relativePath: string
  repositoryId: string
  resultCommit: string
  resultTree: string
}

export interface RepositoryIntegrationOutcome {
  currentTree: string | undefined
  destinationHeadAfter: string | undefined
  destinationHeadBefore: string
  error: string | undefined
  journalUri: string
  mergedTree: string | undefined
  mergeArtifacts: MergeArtifacts | undefined
  repositoryId: string
  status: 'integrated' | 'conflict' | 'recovery-required'
  transactionPhase: TransactionPhase
}

const TransactionRepositorySchema = Type.Object({
  baselineTree: Type.String({ minLength: 1 }),
  beforeTree: Type.String({ minLength: 1 }),
  durableCommonDir: Type.String({ minLength: 1 }),
  nestedPaths: Type.Array(Type.String()),
  patchDigest: Type.String({ minLength: 1 }),
  patchUri: Type.String({ minLength: 1 }),
  plannedTree: Type.String({ minLength: 1 }),
  relativePath: Type.String(),
  repoRoot: Type.String({ minLength: 1 }),
  repositoryId: Type.String({ minLength: 1 }),
  status: Type.Union([
    Type.Literal('planned'),
    Type.Literal('applying'),
    Type.Literal('applied'),
    Type.Literal('verified'),
    Type.Literal('rolled-back'),
    Type.Literal('recovery-required'),
  ]),
})

const TransactionJournalSchema = Type.Object({
  destinationWorkspaceId: Type.String({ minLength: 1 }),
  owner: Type.Object({
    attemptId: Type.String({ minLength: 1 }),
    pid: Type.Number({ minimum: 1 }),
    startToken: Type.Optional(Type.String({ minLength: 1 })),
    startedAt: Type.Number({ minimum: 0 }),
    token: Type.String({ minLength: 1 }),
    writerId: Type.String({ minLength: 1 }),
  }),
  phase: Type.Union([
    Type.Literal('planned'),
    Type.Literal('applied'),
    Type.Literal('verified'),
    Type.Literal('rolled-back'),
    Type.Literal('failed'),
    Type.Literal('recovery-required'),
  ]),
  plannedTree: Type.String(),
  repositories: Type.Array(TransactionRepositorySchema),
  transactionId: Type.String({ minLength: 1 }),
})

type TransactionJournal = Static<typeof TransactionJournalSchema>

interface MergePlan {
  conflicted: boolean
  currentCommit: string
  currentTree: string
  mergedTree: string
  stageEntries: { mode: string; oid: string; path: string; stage: number }[]
  unmergedPaths: string[]
}

interface Prepared {
  destinationHeadBefore: string
  patchPath: string
  plan: MergePlan
  repoRoot: string
  spec: RepositoryIntegrationSpec
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function destinationRepositoryRoot(
  destinationPhysicalRoot: string,
  relativePath: string,
): Promise<string> {
  const target =
    relativePath.length === 0
      ? destinationPhysicalRoot
      : join(destinationPhysicalRoot, relativePath)
  if (!(await pathExists(join(target, '.git')))) {
    throw new Error(`The destination repository boundary is missing: ${target}`)
  }
  return target
}

async function captureDestinationTree(
  repoRoot: string,
  nestedPaths: readonly string[],
  baselineTree: string,
): Promise<string> {
  const indexDir = await mkdtemp(join(tmpdir(), 'pi-subagent-index-'))
  const indexPath = join(indexDir, 'index')
  try {
    await gitWithIndex(repoRoot, indexPath, ['read-tree', 'HEAD']).catch(() => '')
    await gitWithIndex(repoRoot, indexPath, ['add', '-A', '--', '.'])
    for (const nestedPath of nestedPaths) {
      await gitWithIndex(repoRoot, indexPath, ['update-index', '--force-remove', '--', nestedPath])
      const baselineEntry = await git(repoRoot, ['ls-tree', baselineTree, '--', nestedPath]).catch(
        () => '',
      )
      const gitlink = baselineEntry.trim().match(/^160000\s+commit\s+([0-9a-f]+)/)
      if (gitlink?.[1] !== undefined) {
        await gitWithIndex(repoRoot, indexPath, [
          'update-index',
          '--add',
          '--cacheinfo',
          `160000,${gitlink[1]},${nestedPath}`,
        ])
      }
    }
    return (await gitWithIndex(repoRoot, indexPath, ['write-tree'])).trim()
  } finally {
    await rm(indexDir, { force: true, recursive: true })
  }
}

async function headOf(repoRoot: string): Promise<string | undefined> {
  try {
    const commit = (await git(repoRoot, ['rev-parse', 'HEAD'])).trim()
    return /^[0-9a-f]{40,64}$/.test(commit) ? commit : undefined
  } catch {
    return undefined
  }
}

async function runMergeTree(
  repoRoot: string,
  mergeBase: string,
  currentCommit: string,
  resultCommit: string,
): Promise<{
  conflicted: boolean
  mergedTree: string
  stageEntries: { mode: string; oid: string; path: string; stage: number }[]
  unmergedPaths: string[]
}> {
  const output = await new Promise<string>((resolveResult, reject) => {
    const child = spawn(
      'git',
      ['merge-tree', '--write-tree', '-z', '--merge-base', mergeBase, currentCommit, resultCommit],
      { cwd: repoRoot, stdio: 'pipe' },
    )
    const stdout: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.on('error', reject)
    child.on('close', (exitCode) => {
      if (exitCode === 0 || exitCode === 1) {
        resolveResult(Buffer.concat(stdout).toString('utf8'))
        return
      }
      reject(new Error(`git merge-tree failed with exit code ${exitCode}.`))
    })
  })
  const fields = output.split('\0')
  const mergedTree = fields[0]?.trim()
  if (mergedTree === undefined || mergedTree.length === 0) {
    throw new Error('git merge-tree did not report a merged tree.')
  }
  const stageEntries: { mode: string; oid: string; path: string; stage: number }[] = []
  const unmergedPaths: string[] = []
  let index = 1
  while (index < fields.length) {
    const field = fields[index]
    if (field === undefined || field.length === 0) break
    const match = /^([0-7]{6})\s+(\S+)\s+([123])\t(.+)$/.exec(field)
    if (match !== null) {
      const path = match[4] ?? ''
      stageEntries.push({
        mode: match[1] ?? '',
        oid: match[2] ?? '',
        path,
        stage: Number(match[3]),
      })
      if (!unmergedPaths.includes(path)) unmergedPaths.push(path)
    }
    index += 1
  }
  return { conflicted: unmergedPaths.length > 0, mergedTree, stageEntries, unmergedPaths }
}

async function planMerge(
  repoRoot: string,
  baselineCommit: string,
  currentTree: string,
  resultCommit: string,
): Promise<MergePlan> {
  const currentCommit = await commitTree(
    repoRoot,
    currentTree,
    baselineCommit,
    'pi-subagent current',
  )
  const merged = await runMergeTree(repoRoot, baselineCommit, currentCommit, resultCommit)
  return { currentCommit, currentTree, ...merged }
}

export async function integrateRepositories(options: {
  beforeApply?: (() => void) | undefined
  artifactRoot: string
  destinationWorkspaceId: string
  owner: LockOwner
  repositories: RepositoryIntegrationSpec[]
}): Promise<RepositoryIntegrationOutcome[]> {
  const { owner } = options
  const ordered = [...options.repositories].sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : 1,
  )
  const destinationRoots = new Map<string, string>()
  for (const spec of ordered) {
    destinationRoots.set(
      spec.repositoryId,
      await destinationRepositoryRoot(spec.destinationPhysicalRoot, spec.relativePath),
    )
  }

  const outcomes: RepositoryIntegrationOutcome[] = []
  const journal: TransactionJournal = {
    destinationWorkspaceId: options.destinationWorkspaceId,
    owner,
    phase: 'planned',
    plannedTree: '',
    repositories: [],
    transactionId: randomUUID(),
  }
  const journalPath = join(options.artifactRoot, `transaction-${journal.transactionId}.json`)
  const prepared: Prepared[] = []
  const locksHeld: { release: () => Promise<void> }[] = []
  const temporaryRefs: { ref: string; repoRoot: string }[] = []

  try {
    for (const repositoryId of sortedRepositoryIds(ordered)) {
      const spec = ordered.find((candidate) => candidate.repositoryId === repositoryId)
      if (spec === undefined) continue
      const lockRoot = join(spec.durableCommonDir, 'pi-subagent', 'locks')
      const lock = await acquireLock(
        join(lockRoot, `dest-${options.destinationWorkspaceId}-${repositoryId}`),
        owner,
        join(lockRoot, 'recovery'),
      )
      locksHeld.push(lock)
    }

    for (const spec of ordered) {
      const repoRoot = destinationRoots.get(spec.repositoryId)
      if (repoRoot === undefined) throw new Error('The destination repository root is unavailable.')
      const destinationHeadBefore = (await headOf(repoRoot)) ?? ''
      try {
        await git(repoRoot, ['cat-file', '-e', `${spec.resultCommit}^{commit}`])
      } catch {
        const ref = `refs/pi-subagent/integration/${journal.transactionId}/${spec.repositoryId}`
        await withRepositoryLock(spec.durableCommonDir, 'refs', owner, async () => {
          await git(repoRoot, [
            'fetch',
            '--no-tags',
            '--quiet',
            spec.durableCommonDir,
            `${spec.resultCommit}:${ref}`,
          ])
        })
        temporaryRefs.push({ ref, repoRoot })
      }
      const currentTree = await captureDestinationTree(
        repoRoot,
        spec.nestedPaths,
        spec.baselineTree,
      )
      const plan = await planMerge(repoRoot, spec.baselineCommit, currentTree, spec.resultCommit)
      const integrationPatch = plan.conflicted
        ? ''
        : await git(repoRoot, [
            'diff',
            '--binary',
            '--full-index',
            plan.currentCommit,
            plan.mergedTree,
          ])
      const integrationPatchRef = await writePatchArtifact({
        artifactRoot: options.artifactRoot,
        name: `transaction-${journal.transactionId}-${spec.repositoryId}`,
        patch: integrationPatch,
      })
      prepared.push({
        destinationHeadBefore,
        patchPath: fileURLToPath(integrationPatchRef.uri),
        plan,
        repoRoot,
        spec,
      })
      journal.repositories.push({
        baselineTree: spec.baselineTree,
        beforeTree: currentTree,
        durableCommonDir: spec.durableCommonDir,
        nestedPaths: [...spec.nestedPaths],
        patchDigest: integrationPatchRef.sha256,
        patchUri: integrationPatchRef.uri,
        plannedTree: plan.mergedTree,
        relativePath: spec.relativePath,
        repoRoot,
        repositoryId: spec.repositoryId,
        status: 'planned',
      })
    }

    journal.plannedTree = prepared[0]?.plan.mergedTree ?? ''
    await writeAtomicJson(journalPath, journal)

    if (prepared.some((entry) => entry.plan.conflicted)) {
      for (const entry of prepared) {
        outcomes.push(
          entry.plan.conflicted
            ? await conflictOutcome(entry, journalPath, owner, journal.transactionId)
            : {
                currentTree: entry.plan.currentTree,
                destinationHeadAfter: entry.destinationHeadBefore,
                destinationHeadBefore: entry.destinationHeadBefore,
                error: 'Another repository in the transaction reported a conflict.',
                journalUri: journalPath,
                mergedTree: entry.plan.mergedTree,
                mergeArtifacts: undefined,
                repositoryId: entry.spec.repositoryId,
                status: 'recovery-required',
                transactionPhase: 'planned',
              },
        )
      }
      return outcomes
    }

    for (const entry of prepared) {
      const journalRepository = journal.repositories.find(
        (repository) => repository.repositoryId === entry.spec.repositoryId,
      )
      if (journalRepository === undefined) {
        throw new Error('The transaction repository journal is unavailable.')
      }
      journalRepository.status = 'applying'
      await writeAtomicJson(journalPath, journal)
      const beforeHead = (await headOf(entry.repoRoot)) ?? ''
      if (beforeHead !== entry.destinationHeadBefore) {
        throw new Error('The destination HEAD changed during integration.')
      }
      const beforeTree = await captureDestinationTree(
        entry.repoRoot,
        entry.spec.nestedPaths,
        entry.spec.baselineTree,
      )
      if (beforeTree !== entry.plan.currentTree) {
        throw new Error('The destination tree changed during integration.')
      }
      options.beforeApply?.()
      if (entry.plan.currentTree !== entry.plan.mergedTree) {
        await git(entry.repoRoot, ['apply', '--binary', '--whitespace=nowarn', entry.patchPath])
      }
      journalRepository.status = 'applied'
      journal.phase = 'applied'
      await writeAtomicJson(journalPath, journal)
      const verifiedTree = await captureDestinationTree(
        entry.repoRoot,
        entry.spec.nestedPaths,
        entry.spec.baselineTree,
      )
      if (verifiedTree !== entry.plan.mergedTree) {
        throw new Error(
          `Integration verification failed: expected tree ${entry.plan.mergedTree}, found ${verifiedTree}.`,
        )
      }
      outcomes.push({
        currentTree: entry.plan.currentTree,
        destinationHeadAfter: (await headOf(entry.repoRoot)) ?? '',
        destinationHeadBefore: entry.destinationHeadBefore,
        error: undefined,
        journalUri: journalPath,
        mergedTree: entry.plan.mergedTree,
        mergeArtifacts: undefined,
        repositoryId: entry.spec.repositoryId,
        status: 'integrated',
        transactionPhase: 'verified',
      })
      journalRepository.status = 'verified'
      await writeAtomicJson(journalPath, journal)
    }
    journal.phase = 'verified'
    await writeAtomicJson(journalPath, journal)
    return outcomes
  } catch (error) {
    const failure = errorMessage(error)
    journal.phase = 'failed'
    await writeAtomicJson(journalPath, journal).catch(() => {})
    const appliedSpecs = prepared.filter((entry) =>
      outcomes.some(
        (outcome) =>
          outcome.mergedTree === entry.plan.mergedTree && outcome.status === 'integrated',
      ),
    )
    if (appliedSpecs.length === 0) {
      for (const spec of ordered) {
        const preparedEntry = prepared.find(
          (entry) => entry.spec.repositoryId === spec.repositoryId,
        )
        outcomes.push({
          currentTree: preparedEntry?.plan.currentTree,
          destinationHeadAfter: preparedEntry?.destinationHeadBefore,
          destinationHeadBefore: preparedEntry?.destinationHeadBefore ?? '',
          error: failure,
          journalUri: journalPath,
          mergedTree: preparedEntry?.plan.mergedTree,
          mergeArtifacts: undefined,
          repositoryId: spec.repositoryId,
          status: 'recovery-required',
          transactionPhase: 'failed',
        })
      }
      return outcomes
    }
    for (const entry of [...appliedSpecs].reverse()) {
      const outcome = outcomes.find(
        (candidate) =>
          candidate.mergedTree === entry.plan.mergedTree && candidate.status === 'integrated',
      )
      if (outcome === undefined) continue
      try {
        const rollbackTree = await captureDestinationTree(
          entry.repoRoot,
          entry.spec.nestedPaths,
          entry.spec.baselineTree,
        )
        if (rollbackTree !== entry.plan.mergedTree) {
          throw new Error('The destination changed after integration verification.')
        }
        if (entry.plan.currentTree !== entry.plan.mergedTree) {
          await git(entry.repoRoot, [
            'apply',
            '--reverse',
            '--binary',
            '--whitespace=nowarn',
            entry.patchPath,
          ])
        }
        const restoredTree = await captureDestinationTree(
          entry.repoRoot,
          entry.spec.nestedPaths,
          entry.spec.baselineTree,
        )
        outcome.destinationHeadAfter = (await headOf(entry.repoRoot)) ?? ''
        const journalRepository = journal.repositories.find(
          (repository) => repository.repositoryId === entry.spec.repositoryId,
        )
        if (restoredTree === entry.plan.currentTree) {
          outcome.status = 'recovery-required'
          outcome.transactionPhase = 'rolled-back'
          if (journalRepository !== undefined) journalRepository.status = 'rolled-back'
        } else {
          outcome.status = 'recovery-required'
          outcome.transactionPhase = 'failed'
          if (journalRepository !== undefined) journalRepository.status = 'recovery-required'
        }
        outcome.error = failure
      } catch (rollbackError) {
        outcome.status = 'recovery-required'
        outcome.transactionPhase = 'failed'
        outcome.error = `${failure}; rollback failed: ${errorMessage(rollbackError)}`
        const journalRepository = journal.repositories.find(
          (repository) => repository.repositoryId === entry.spec.repositoryId,
        )
        if (journalRepository !== undefined) journalRepository.status = 'recovery-required'
      }
    }
    journal.phase = journal.repositories.every(
      (repository) => repository.status === 'planned' || repository.status === 'rolled-back',
    )
      ? 'rolled-back'
      : 'recovery-required'
    await writeAtomicJson(journalPath, journal).catch(() => {})
    for (const spec of ordered) {
      if (outcomes.some((outcome) => outcome.repositoryId === spec.repositoryId)) continue
      const entry = prepared.find((candidate) => candidate.spec.repositoryId === spec.repositoryId)
      outcomes.push({
        currentTree: entry?.plan.currentTree,
        destinationHeadAfter: entry?.destinationHeadBefore,
        destinationHeadBefore: entry?.destinationHeadBefore ?? '',
        error: failure,
        journalUri: journalPath,
        mergedTree: entry?.plan.mergedTree,
        mergeArtifacts: undefined,
        repositoryId: spec.repositoryId,
        status: 'recovery-required',
        transactionPhase: 'failed',
      })
    }
    return outcomes
  } finally {
    for (const temporary of temporaryRefs) {
      const spec = ordered.find(
        (candidate) => destinationRoots.get(candidate.repositoryId) === temporary.repoRoot,
      )
      if (spec === undefined) continue
      await withRepositoryLock(spec.durableCommonDir, 'refs', owner, async () => {
        await git(temporary.repoRoot, ['update-ref', '-d', temporary.ref])
      }).catch(() => {})
    }
    for (const lock of [...locksHeld].reverse()) await lock.release().catch(() => {})
  }
}

async function transactionJournalPaths(directory: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const paths: string[] = []
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) paths.push(...(await transactionJournalPaths(path)))
    else if (entry.name.startsWith('transaction-') && entry.name.endsWith('.json')) paths.push(path)
  }
  return paths
}

export async function recoverIntegrationTransactions(storeRoot: string): Promise<string[]> {
  const paths = await transactionJournalPaths(join(storeRoot, 'artifacts'))
  const recovered: string[] = []
  for (const journalPath of paths) {
    let journal: TransactionJournal
    try {
      journal = Value.Decode(
        TransactionJournalSchema,
        JSON.parse(await readFile(journalPath, 'utf8')),
      )
    } catch {
      continue
    }
    if (journal.phase === 'verified' || journal.phase === 'rolled-back') continue
    const status = await ownerStatus(journal.owner)
    if (status !== 'dead') continue
    const recoveryOwner = await currentLockOwner(
      `transaction-recovery-${journal.transactionId}`,
      journal.transactionId,
    )
    const locks: { release: () => Promise<void> }[] = []
    try {
      for (const repositoryId of sortedRepositoryIds(journal.repositories)) {
        const repository = journal.repositories.find(
          (candidate) => candidate.repositoryId === repositoryId,
        )
        if (repository === undefined) continue
        const lockRoot = join(repository.durableCommonDir, 'pi-subagent', 'locks')
        locks.push(
          await acquireLock(
            join(lockRoot, `dest-${journal.destinationWorkspaceId}-${repositoryId}`),
            recoveryOwner,
            join(lockRoot, 'recovery'),
          ),
        )
      }
      let ambiguous = false
      for (const repository of [...journal.repositories].reverse()) {
        const currentTree = await captureDestinationTree(
          repository.repoRoot,
          repository.nestedPaths,
          repository.baselineTree,
        )
        if (currentTree === repository.beforeTree) {
          repository.status = 'rolled-back'
          await writeAtomicJson(journalPath, journal)
          continue
        }
        if (currentTree === repository.plannedTree) {
          repository.status = 'verified'
          await writeAtomicJson(journalPath, journal)
          continue
        }
        repository.status = 'recovery-required'
        ambiguous = true
        await writeAtomicJson(journalPath, journal)
      }
      const allVerified = journal.repositories.every(
        (repository) => repository.status === 'verified',
      )
      const allRolledBack = journal.repositories.every(
        (repository) => repository.status === 'rolled-back',
      )
      journal.phase = allVerified ? 'verified' : allRolledBack ? 'rolled-back' : 'recovery-required'
      if (ambiguous) journal.phase = 'recovery-required'
      await writeAtomicJson(journalPath, journal)
      recovered.push(pathToFileURL(journalPath).href)
    } catch {
      journal.phase = 'recovery-required'
      await writeAtomicJson(journalPath, journal).catch(() => {})
    } finally {
      for (const lock of [...locks].reverse()) await lock.release().catch(() => {})
    }
  }
  return recovered
}

async function conflictOutcome(
  entry: Prepared,
  journalPath: string,
  owner: LockOwner,
  transactionId: string,
): Promise<RepositoryIntegrationOutcome> {
  const patch =
    entry.spec.patch.uri.length === 0
      ? ''
      : await readFile(fileURLToPath(entry.spec.patch.uri), 'utf8')
  const patchRef = await writePatchArtifact({
    artifactRoot: dirname(journalPath),
    name: `merge-conflict-${entry.spec.repositoryId}`,
    patch,
  })
  const currentRef = `refs/pi-subagent/v2/conflicts/${transactionId}/${entry.spec.repositoryId}/current`
  const mergedRef = `refs/pi-subagent/v2/conflicts/${transactionId}/${entry.spec.repositoryId}/merged`
  const mergedCommit = await commitTree(
    entry.repoRoot,
    entry.plan.mergedTree,
    entry.plan.currentCommit,
    'pi-subagent conflicted merge',
  )
  await promoteCommit({
    commit: entry.plan.currentCommit,
    durableCommonDir: entry.spec.durableCommonDir,
    owner,
    ref: currentRef,
    sourceRepoRoot: entry.repoRoot,
  })
  await promoteCommit({
    commit: mergedCommit,
    durableCommonDir: entry.spec.durableCommonDir,
    owner,
    ref: mergedRef,
    sourceRepoRoot: entry.repoRoot,
  })
  const mergeArtifacts: MergeArtifacts = {
    baseTree: entry.spec.baselineTree,
    currentRef,
    currentTree: entry.plan.currentTree,
    destinationHead: entry.destinationHeadBefore,
    journalUri: journalPath,
    mergedRef,
    mergedTree: entry.plan.mergedTree,
    patch: patchRef,
    resultTree: entry.spec.resultTree,
    stageEntries: entry.plan.stageEntries,
    unmergedPaths: entry.plan.unmergedPaths,
  }
  return {
    currentTree: entry.plan.currentTree,
    destinationHeadAfter: entry.destinationHeadBefore,
    destinationHeadBefore: entry.destinationHeadBefore,
    error: `The merge reported ${entry.plan.unmergedPaths.length} conflicted path(s).`,
    journalUri: journalPath,
    mergedTree: entry.plan.mergedTree,
    mergeArtifacts,
    repositoryId: entry.spec.repositoryId,
    status: 'conflict',
    transactionPhase: 'planned',
  }
}
