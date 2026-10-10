import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import {
  captureWorkspaceIdentity,
  captureWorkspaceSnapshot,
  commitTree,
  commonDirectory,
  git,
  promoteCommit,
} from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupWorkspaceArtifacts,
  DETACHED_TREE_SUFFIX,
  drainDeferredRemovals,
  integrateStagedReceipt,
  needsRecoveryCapture,
  recoverIsolations,
} from '../src/isolation.ts'
import type { WorkspaceLifecycle } from '../src/schema.ts'
import { currentLockOwner } from '../src/workspace.ts'
import { command, harness, repository, writer } from './isolation-harness.ts'

describe('writer isolation: nested ledgers and recovery', () => {
  it('captures nested repository changes in an ordered ledger', async () => {
    const directory = await repository()
    try {
      const nested = join(directory, 'nested')
      await mkdir(nested)
      await command(nested, ['git', 'init', '-q', '-b', 'main'])
      await command(nested, ['git', 'config', 'user.name', 'Test User'])
      await command(nested, ['git', 'config', 'user.email', 'test@example.com'])
      await mkdir(join(nested, 'nested'))
      await writeFile(join(nested, 'nested.txt'), 'nested base\n', 'utf8')
      await writeFile(join(nested, 'nested', 'same-path.txt'), 'same path base\n', 'utf8')
      await command(nested, ['git', 'add', 'nested.txt', 'nested/same-path.txt'])
      await command(nested, ['git', 'commit', '-q', '-m', 'nested base'])
      const deeper = join(nested, 'deeper')
      await mkdir(deeper)
      await command(deeper, ['git', 'init', '-q', '-b', 'main'])
      await command(deeper, ['git', 'config', 'user.name', 'Test User'])
      await command(deeper, ['git', 'config', 'user.email', 'test@example.com'])
      await writeFile(join(deeper, 'deep.txt'), 'deep base\n', 'utf8')
      await command(deeper, ['git', 'add', 'deep.txt'])
      await command(deeper, ['git', 'commit', '-q', '-m', 'deep base'])
      const isolation = await writer(directory, 'writer-nested-repo')
      await writeFile(
        join(isolation.rootWorktree, 'nested', 'nested.txt'),
        'nested agent\n',
        'utf8',
      )
      await writeFile(
        join(isolation.rootWorktree, 'nested', 'nested', 'same-path.txt'),
        'same path agent\n',
        'utf8',
      )
      await writeFile(
        join(isolation.rootWorktree, 'nested', 'deeper', 'deep.txt'),
        'deep agent\n',
        'utf8',
      )
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(
        await captureIsolation(isolation),
        environment.destination,
        'writer-nested-repo',
      )
      expect(integrated.status).toBe('integrated')
      expect(integrated.repositories.map((repository) => repository.relativePath)).toEqual([
        '',
        'nested',
        'nested/deeper',
      ])
      expect(await readFile(join(nested, 'nested.txt'), 'utf8')).toBe('nested agent\n')
      expect(await readFile(join(nested, 'nested', 'same-path.txt'), 'utf8')).toBe(
        'same path agent\n',
      )
      expect(await readFile(join(deeper, 'deep.txt'), 'utf8')).toBe('deep agent\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('detaches the worktree synchronously and removes its contents off the critical path', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-deferred-cleanup')
      const bulk = join(isolation.rootWorktree, 'node_modules', 'bulk')
      await mkdir(bulk, { recursive: true })
      for (let index = 0; index < 200; index += 1) {
        await writeFile(join(bulk, `module-${index}.txt`), 'dependency\n'.repeat(64), 'utf8')
      }
      const parent = dirname(isolation.rootWorktree)
      const prefix = basename(isolation.rootWorktree)
      expect(await cleanupWorkspaceArtifacts(isolation)).toBe(false)
      await expect(stat(isolation.rootWorktree)).rejects.toHaveProperty('code', 'ENOENT')
      await expect(stat(isolation.baseDir)).rejects.toHaveProperty('code', 'ENOENT')
      await drainDeferredRemovals()
      const leftovers = (await readdir(parent)).filter((entry) =>
        entry.startsWith(`${prefix}${DETACHED_TREE_SUFFIX}`),
      )
      expect(leftovers).toEqual([])
      const storeWorktrees = join(isolation.storeRoot, 'worktrees')
      const stale = join(storeWorktrees, `ws-stale${DETACHED_TREE_SUFFIX}crashed`)
      await mkdir(stale, { recursive: true })
      await writeFile(join(stale, 'manifest.json'), '{}', 'utf8')
      await recoverIsolations(directory)
      await drainDeferredRemovals()
      await expect(stat(stale)).rejects.toHaveProperty('code', 'ENOENT')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('recovers a dead writer workspace and preserves its patch', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-crash')
      await isolation.dependencies
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'crash work\n', 'utf8')
      const deadOwner = {
        attemptId: isolation.attemptId,
        pid: 999_999,
        startedAt: 1,
        token: 'dead-token',
        writerId: isolation.writerId,
      }
      await writeFile(
        join(isolation.baseDir, 'manifest.json'),
        JSON.stringify({
          ...isolation.manifest,
          owner: deadOwner,
        }),
        'utf8',
      )
      const recoveries = await recoverIsolations(directory)
      const recovery = recoveries.find((item) => item.attemptId === isolation.attemptId)
      expect(recovery?.ownerStatus).toBe('dead')
      expect(recovery?.receipt?.status).toBe('captured')
      expect(recovery?.receipt?.repositories[0]?.patch.sha256).toHaveLength(64)
      expect(recovery?.receipt?.cleanupDebt).toBe(false)
      await expect(stat(isolation.rootWorktree)).rejects.toHaveProperty('code', 'ENOENT')
      await expect(stat(isolation.baseDir)).rejects.toHaveProperty('code', 'ENOENT')
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it.each(['staged', 'integrating'])(
    'removes a dead %s workspace after durable capture during startup recovery',
    async (state) => {
      const directory = await repository()
      try {
        const isolation = await writer(directory, 'writer-staged')
        await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'staged work\n', 'utf8')
        const receipt = await captureIsolation(isolation)
        expect(receipt.captureStatus).toBe('captured')
        const durableRef = receipt.repositories[0]?.durableRef
        if (durableRef === undefined) throw new Error('The durable ref is missing.')
        const durableCommonDir = await commonDirectory(directory)
        const before = (await git(durableCommonDir, ['rev-parse', durableRef])).trim()
        await writeFile(
          join(isolation.baseDir, 'manifest.json'),
          JSON.stringify({
            ...isolation.manifest,
            owner: { ...isolation.manifest.owner, pid: 999_999, startedAt: 1, token: 'dead' },
            state,
          }),
          'utf8',
        )
        const recoveries = await recoverIsolations(directory)
        const recovery = recoveries.find((item) => item.attemptId === isolation.attemptId)
        expect(recovery?.ownerStatus).toBe('dead')
        expect(recovery?.receipt).toBeUndefined()
        await expect(stat(isolation.rootWorktree)).rejects.toHaveProperty('code', 'ENOENT')
        await expect(stat(isolation.baseDir)).rejects.toHaveProperty('code', 'ENOENT')
        expect((await git(durableCommonDir, ['rev-parse', durableRef])).trim()).toBe(before)
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    },
    180_000,
  )

  it.each(['capture-conflict', 'integrating'])(
    'retains a dead %s workspace without durable result refs during startup recovery',
    async (state) => {
      const directory = await repository()
      let isolation: Awaited<ReturnType<typeof writer>> | undefined
      try {
        const workspace = await writer(directory, 'writer-capture-conflict')
        isolation = workspace
        await workspace.dependencies
        await writeFile(
          join(workspace.baseDir, 'manifest.json'),
          JSON.stringify({
            ...workspace.manifest,
            owner: { ...workspace.manifest.owner, pid: 999_999, startedAt: 1, token: 'dead' },
            state,
          }),
          'utf8',
        )
        const recoveries = await recoverIsolations(directory)
        const recovery = recoveries.find((item) => item.attemptId === workspace.attemptId)
        expect(recovery?.ownerStatus).toBe('dead')
        expect(recovery?.receipt).toBeUndefined()
        expect((await stat(workspace.rootWorktree)).isDirectory()).toBe(true)
      } finally {
        if (isolation !== undefined) await cleanupWorkspaceArtifacts(isolation)
        await rm(directory, { force: true, recursive: true })
      }
    },
    180_000,
  )

  it('classifies only uncaptured workspaces as recovery capture candidates', () => {
    const repositories = [{ relativePath: '' }]
    const manifest = (state: WorkspaceLifecycle) => ({ repositories, state })
    const capture: WorkspaceLifecycle[] = ['active', 'closing']
    const settled: WorkspaceLifecycle[] = [
      'allocating',
      'captured',
      'staged',
      'integrating',
      'integrated',
      'cleanup-pending',
      'cleaned',
      'aborted',
      'capture-conflict',
      'conflict',
      'recovery-required',
      'cleanup-debt',
    ]
    for (const state of capture) expect(needsRecoveryCapture(manifest(state))).toBe(true)
    for (const state of settled) expect(needsRecoveryCapture(manifest(state))).toBe(false)
    expect(needsRecoveryCapture({ repositories: [], state: 'active' })).toBe(false)
  })

  it('captures the same workspace again after an interrupted capture', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-recapture')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'first\n', 'utf8')
      const first = await captureIsolation(isolation)
      expect(first.captureStatus).toBe('captured')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'second\n', 'utf8')
      const second = await captureIsolation(isolation)
      expect(second.captureStatus).toBe('captured')
      expect(second.error).toBeUndefined()
      const durableRef = second.repositories[0]?.durableRef
      const resultCommit = second.repositories[0]?.resultCommit
      if (durableRef === undefined || resultCommit === undefined) {
        throw new Error('The second capture is incomplete.')
      }
      const durableCommonDir = await commonDirectory(directory)
      expect((await git(durableCommonDir, ['rev-parse', durableRef])).trim()).toBe(resultCommit)
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('promotes shallow nested repositories without corrupting the durable store', async () => {
    const directory = await repository()
    const upstream = await repository()
    try {
      await writeFile(join(upstream, 'tracked.txt'), 'upstream two\n', 'utf8')
      await command(upstream, ['git', 'commit', '-q', '-am', 'two'])
      await command(directory, [
        'git',
        'clone',
        '-q',
        '--depth',
        '1',
        `file://${upstream}`,
        'vendor',
      ])
      const vendor = join(directory, 'vendor')
      expect((await git(vendor, ['rev-parse', '--is-shallow-repository'])).trim()).toBe('true')
      const isolation = await writer(directory, 'writer-shallow')
      const nested = isolation.repositories.find((entry) => entry.relativePath === 'vendor')
      if (nested === undefined) throw new Error('The shallow nested repository is missing.')
      const durableCommonDir = await commonDirectory(directory)
      const parents = (
        await git(durableCommonDir, ['rev-list', '--parents', '-n', '1', nested.baselineCommit])
      )
        .trim()
        .split(/\s+/)
      expect(parents).toEqual([nested.baselineCommit])
      await writeFile(join(isolation.rootWorktree, 'vendor', 'tracked.txt'), 'vendored\n', 'utf8')
      const receipt = await captureIsolation(isolation)
      expect(receipt.captureStatus).toBe('captured')
      expect(receipt.error).toBeUndefined()
      const fsck = await command(durableCommonDir, ['git', 'fsck', '--connectivity-only'])
      expect(fsck).not.toContain('broken link')
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(
        receipt,
        environment.destination,
        'writer-shallow',
      )
      expect(integrated.status).toBe('integrated')
      expect(await readFile(join(vendor, 'tracked.txt'), 'utf8')).toBe('vendored\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
      await rm(upstream, { force: true, recursive: true })
    }
  }, 180_000)

  it('reports promotions that git rejects instead of leaving dangling objects unnoticed', async () => {
    const upstream = await repository()
    const directory = await mkdtemp(join(tmpdir(), 'subagent-shallow-promote-'))
    try {
      await writeFile(join(upstream, 'tracked.txt'), 'upstream two\n', 'utf8')
      await command(upstream, ['git', 'commit', '-q', '-am', 'two'])
      await command(directory, [
        'git',
        'clone',
        '-q',
        '--depth',
        '1',
        `file://${upstream}`,
        'shallow',
      ])
      const shallow = join(directory, 'shallow')
      const durable = await repository()
      try {
        const head = (await git(shallow, ['rev-parse', 'HEAD'])).trim()
        const tree = (await git(shallow, ['rev-parse', 'HEAD^{tree}'])).trim()
        const commit = await commitTree(shallow, tree, head, 'beyond the shallow root')
        const owner = await currentLockOwner('writer-shallow-promote', 'attempt-1')
        const durableCommonDir = await commonDirectory(durable)
        await expect(
          promoteCommit({
            commit,
            durableCommonDir,
            owner,
            ref: 'refs/pi-subagent/v2/test/shallow',
            sourceRepoRoot: shallow,
          }),
        ).rejects.toThrow('did not promote commit')
        const refs = await git(durableCommonDir, ['for-each-ref', 'refs/pi-subagent/v2/test/'])
        expect(refs.trim()).toBe('')
      } finally {
        await rm(durable, { force: true, recursive: true })
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
      await rm(upstream, { force: true, recursive: true })
    }
  }, 180_000)

  it('recognizes an interrupted applied transaction during startup recovery', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-transaction-crash')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'applied before crash\n', 'utf8')
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(
        await captureIsolation(isolation),
        environment.destination,
        isolation.writerId,
      )
      expect(integrated.status).toBe('integrated')
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('applied before crash\n')
      const journalPath = integrated.journalUri
      if (journalPath === undefined) throw new Error('The transaction journal is unavailable.')
      const interrupted = (await readFile(journalPath, 'utf8'))
        .replace(/"pid":\s*\d+/, '"pid": 999999')
        .replace(/"phase":\s*"verified"/, '"phase": "applied"')
      await writeFile(journalPath, interrupted, 'utf8')
      await recoverIsolations(directory)
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('applied before crash\n')
      expect(await readFile(journalPath, 'utf8')).toContain('"phase":"verified"')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('captures dirty nested repository snapshots with isolation baselines', async () => {
    const directory = await repository()
    try {
      await writeFile(join(directory, '.gitignore'), 'node_modules/\nnested/\n', 'utf8')
      await command(directory, ['git', 'add', '.gitignore'])
      await command(directory, ['git', 'commit', '-qm', 'ignore nested repository'])
      const nested = join(directory, 'nested')
      await mkdir(nested)
      await command(nested, ['git', 'init', '-q', '-b', 'main'])
      await command(nested, ['git', 'config', 'user.name', 'Test User'])
      await command(nested, ['git', 'config', 'user.email', 'test@example.com'])
      await writeFile(join(nested, 'nested.txt'), 'base\n', 'utf8')
      await command(nested, ['git', 'add', 'nested.txt'])
      await command(nested, ['git', 'commit', '-qm', 'nested base'])
      await writeFile(join(directory, 'tracked.txt'), 'root dirty\n', 'utf8')
      await writeFile(join(nested, 'nested.txt'), 'nested dirty\n', 'utf8')

      const snapshot = await captureWorkspaceSnapshot(directory)
      if (snapshot === undefined) throw new Error('The workspace snapshot is unavailable.')
      const isolation = await writer(directory, 'snapshot-nested')
      try {
        expect(snapshot.repositories.map((entry) => entry.relativePath)).toEqual(
          isolation.repositories.map((entry) => entry.relativePath),
        )
        expect(snapshot.repositories.map((entry) => entry.root)).toEqual(
          isolation.repositories.map((entry) => entry.physicalRepoRoot),
        )
        expect(snapshot.repositories.map((entry) => entry.base)).toEqual(
          isolation.repositories.map((entry) => entry.baselineTree),
        )
        expect(
          await readFile(fileURLToPath(snapshot.repositories[0]?.patch.uri ?? ''), 'utf8'),
        ).toContain('root dirty')
        expect(
          await readFile(fileURLToPath(snapshot.repositories[1]?.patch.uri ?? ''), 'utf8'),
        ).toContain('nested dirty')
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('captures unborn dirty content against the empty tree', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subagent-unborn-'))
    try {
      await command(directory, ['git', 'init', '-q', '-b', 'main'])
      await writeFile(join(directory, 'unborn.txt'), 'unborn dirty\n', 'utf8')
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      expect(identity.productHead).toBeUndefined()
      expect(await readFile(fileURLToPath(identity.patch.uri), 'utf8')).toContain('unborn dirty')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
