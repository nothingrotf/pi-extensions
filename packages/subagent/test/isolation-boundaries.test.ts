import { lstat, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import {
  captureWorkspaceIdentity,
  commonDirectory,
  git,
  nestedRepositories,
  nestedRepositoryLayout,
  SHARED_REPOSITORIES_FILE,
} from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupWorkspaceArtifacts,
  createIsolation,
  integrateStagedReceipt,
} from '../src/isolation.ts'
import { acquireLock, currentLockOwner } from '../src/workspace.ts'
import { command, harness, repository, writer } from './isolation-harness.ts'

describe('writer isolation: repository boundaries', () => {
  it('uses compare-and-swap when concurrent contenders reclaim a stale lock', async () => {
    const directory = await repository()
    try {
      const commonDir = await commonDirectory(directory)
      const lockRoot = join(commonDir, 'pi-subagent', 'locks')
      const lockPath = join(lockRoot, 'stale-race')
      const recoveryRoot = join(lockRoot, 'recovery')
      const deadOwner = {
        attemptId: 'dead-attempt',
        pid: 999_999,
        startedAt: 1,
        token: 'dead-owner-token',
        writerId: 'dead-writer',
      }
      const stale = await acquireLock(lockPath, deadOwner, recoveryRoot)
      let acquisitions = 0
      const firstPromise = acquireLock(
        lockPath,
        await currentLockOwner('first-writer', 'first-attempt'),
        recoveryRoot,
      ).then((lock) => {
        acquisitions += 1
        return lock
      })
      const secondPromise = acquireLock(
        lockPath,
        await currentLockOwner('second-writer', 'second-attempt'),
        recoveryRoot,
      ).then((lock) => {
        acquisitions += 1
        return lock
      })
      const winner = await Promise.race([firstPromise, secondPromise])
      expect(acquisitions).toBe(1)
      await winner.release()
      const locks = await Promise.all([firstPromise, secondPromise])
      for (const lock of locks) await lock.release()
      await stale.release()
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('preserves sparse checkout state in private metadata', async () => {
    const directory = await repository()
    try {
      await mkdir(join(directory, 'included'))
      await mkdir(join(directory, 'excluded'))
      await writeFile(join(directory, 'included', 'file.txt'), 'included\n', 'utf8')
      await writeFile(join(directory, 'excluded', 'file.txt'), 'excluded\n', 'utf8')
      await command(directory, ['git', 'add', 'included', 'excluded'])
      await command(directory, ['git', 'commit', '-q', '-m', 'sparse files'])
      await git(directory, ['sparse-checkout', 'set', 'included'])
      const isolation = await writer(directory, 'writer-sparse')
      expect(await readFile(join(isolation.rootWorktree, 'included', 'file.txt'), 'utf8')).toBe(
        'included\n',
      )
      await expect(
        readFile(join(isolation.rootWorktree, 'excluded', 'file.txt'), 'utf8'),
      ).rejects.toThrow(/ENOENT/)
      expect(
        (await git(isolation.rootWorktree, ['config', '--bool', 'core.sparseCheckout'])).trim(),
      ).toBe('true')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('keeps a linked worktree as the root integration boundary', async () => {
    const directory = await repository()
    const linked = `${directory}-linked`
    try {
      await git(directory, ['worktree', 'add', '-q', '-b', 'linked-boundary', linked])
      const isolation = await writer(linked, 'writer-linked-root')
      await writeFile(join(isolation.rootWorktree, 'linked-only.txt'), 'linked result\n', 'utf8')
      const environment = await harness(linked)
      const integrated = await integrateStagedReceipt(
        await captureIsolation(isolation),
        environment.destination,
        'writer-linked-root',
      )
      expect(integrated.status).toBe('integrated')
      expect(await readFile(join(linked, 'linked-only.txt'), 'utf8')).toBe('linked result\n')
      await expect(readFile(join(directory, 'linked-only.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(linked, { force: true, recursive: true })
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('creates a working isolation for an unborn repository', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'subagent-unborn-'))
    const directory = join(parent, 'repo')
    await mkdir(directory)
    try {
      await command(directory, ['git', 'init', '-q', '-b', 'trunk'])
      await writeFile(join(directory, 'seed.txt'), 'seed\n', 'utf8')
      await writeFile(join(directory, 'keep.txt'), 'keep\n', 'utf8')
      const isolation = await writer(directory, 'writer-unborn')
      expect(isolation.repositories[0]?.headState).toBe('unborn')
      expect(await readFile(join(isolation.rootWorktree, 'seed.txt'), 'utf8')).toBe('seed\n')
      expect(await readFile(join(isolation.rootWorktree, 'keep.txt'), 'utf8')).toBe('keep\n')
      await writeFile(join(isolation.rootWorktree, 'seed.txt'), 'seed\nwriter\n', 'utf8')
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(
        await captureIsolation(isolation),
        environment.destination,
        'writer-unborn',
      )
      expect(integrated.status).toBe('integrated')
      expect(await readFile(join(directory, 'seed.txt'), 'utf8')).toBe('seed\nwriter\n')
      expect(await readFile(join(directory, 'keep.txt'), 'utf8')).toBe('keep\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  }, 180_000)

  it('starts a nested writer from its parent workspace state', async () => {
    const directory = await repository()
    try {
      const parent = await writer(directory, 'writer-nested-parent')
      await writeFile(join(parent.rootWorktree, 'parent-work.txt'), 'parent work\n', 'utf8')
      const environment = await harness(directory)
      const child = await createIsolation({
        destination: {
          destinationPhysicalRoot: parent.context.physicalRoot,
          destinationWorkspaceId: parent.context.workspaceId,
          durableCommonDir: parent.durableCommonDir,
        },
        integration: 'apply',
        parent: parent.context,
        relativeCwd: '',
        spawnOrdinal: 1,
        writerId: 'writer-nested-child',
      })
      expect(await readFile(join(child.rootWorktree, 'parent-work.txt'), 'utf8')).toBe(
        'parent work\n',
      )
      await writeFile(join(child.rootWorktree, 'child-work.txt'), 'child work\n', 'utf8')
      const childIntegrated = await integrateStagedReceipt(
        await captureIsolation(child),
        {
          destinationPhysicalRoot: parent.context.physicalRoot,
          destinationWorkspaceId: parent.context.workspaceId,
          durableCommonDir: parent.durableCommonDir,
        },
        'writer-nested-child',
      )
      expect(childIntegrated.status).toBe('integrated')
      expect(await readFile(join(parent.rootWorktree, 'child-work.txt'), 'utf8')).toBe(
        'child work\n',
      )
      const parentIntegrated = await integrateStagedReceipt(
        await captureIsolation(parent),
        environment.destination,
        'writer-nested-parent',
      )
      expect(parentIntegrated.status).toBe('integrated')
      expect(await readFile(join(directory, 'parent-work.txt'), 'utf8')).toBe('parent work\n')
      expect(await readFile(join(directory, 'child-work.txt'), 'utf8')).toBe('child work\n')
      await cleanupWorkspaceArtifacts(child)
      await cleanupWorkspaceArtifacts(parent)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('distinguishes indexed submodules from independent nested repositories', async () => {
    const directory = await repository()
    const upstream = await repository()
    try {
      await git(directory, [
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        upstream,
        'vendor/submodule',
      ])
      await git(directory, ['commit', '-qm', 'submodule'])
      const independent = join(directory, 'vendor', 'independent')
      await git(directory, ['clone', '-q', upstream, independent])
      expect(await nestedRepositories(directory)).toEqual(['vendor/independent'])
      const isolation = await writer(directory, 'writer-submodule-discovery')
      expect(isolation.repositories.map((entry) => entry.relativePath)).toEqual([
        '',
        'vendor/independent',
      ])
      const receipt = await captureIsolation(isolation)
      expect(receipt.captureStatus).toBe('captured')
      expect(receipt.repositories.map((entry) => entry.relativePath)).toEqual([
        '',
        'vendor/independent',
      ])
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
      await rm(upstream, { force: true, recursive: true })
    }
  }, 180_000)

  it('shares an ignored reference repository instead of isolating it', async () => {
    const directory = await repository()
    const reference = await repository()
    try {
      await writeFile(join(directory, '.gitignore'), 'node_modules/\n/repos/\n/vendor/\n')
      await writeFile(join(directory, SHARED_REPOSITORIES_FILE), '# references\n/repos/\n')
      await git(directory, ['add', '.gitignore', SHARED_REPOSITORIES_FILE])
      await git(directory, ['commit', '-qm', 'declare shared references'])
      await git(directory, ['clone', '-q', reference, 'repos/reference'])
      await git(directory, ['clone', '-q', reference, 'vendor/product'])
      await writeFile(join(directory, 'repos', 'reference', 'local.txt'), 'reference only\n')
      expect(await nestedRepositoryLayout(directory)).toEqual({
        isolated: ['vendor/product'],
        shared: ['repos/reference'],
      })
      expect(await nestedRepositories(directory)).toEqual(['repos/reference', 'vendor/product'])
      const identity = await captureWorkspaceIdentity(directory)
      expect(identity?.snapshot.repositories.map((entry) => entry.relativePath)).toEqual([
        '',
        'vendor/product',
      ])
      const isolation = await writer(directory, 'writer-shared-reference')
      try {
        expect(isolation.repositories.map((entry) => entry.relativePath)).toEqual([
          '',
          'vendor/product',
        ])
        const link = join(isolation.rootWorktree, 'repos', 'reference')
        expect((await lstat(link)).isSymbolicLink()).toBe(true)
        expect(await readFile(join(link, 'local.txt'), 'utf8')).toBe('reference only\n')
        await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'product result\n')
        const receipt = await captureIsolation(isolation)
        expect(receipt.captureStatus).toBe('captured')
        expect(receipt.repositories.map((entry) => entry.relativePath)).toEqual([
          '',
          'vendor/product',
        ])
        expect(receipt.repositories[0]?.changedFiles).toEqual([
          { path: 'tracked.txt', status: 'M' },
        ])
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
      expect(await readFile(join(directory, 'repos', 'reference', 'local.txt'), 'utf8')).toBe(
        'reference only\n',
      )
    } finally {
      await rm(directory, { force: true, recursive: true })
      await rm(reference, { force: true, recursive: true })
    }
  }, 180_000)

  it.each(['baseline', 'new-rule', 'unignored', 'tracked', 'removed'])(
    'checks reference repository boundaries with %s ignores',
    async (scenario) => {
      const directory = await repository()
      const reference = await repository()
      try {
        if (scenario !== 'unignored' && scenario !== 'new-rule') {
          await writeFile(join(directory, '.gitignore'), 'node_modules/\nrefs/\n')
        }
        if (scenario === 'tracked') {
          await mkdir(join(directory, 'refs', 'external'), { recursive: true })
          await writeFile(join(directory, 'refs', 'external', 'product.txt'), 'tracked product\n')
          await git(directory, ['add', '-f', 'refs/external/product.txt'])
          await git(directory, ['commit', '-qm', 'tracked product'])
        }
        if (scenario === 'removed') {
          await git(directory, ['clone', '-q', reference, 'existing'])
        }
        const isolation = await writer(directory, `reference-${scenario}`)
        try {
          if (scenario === 'new-rule')
            await writeFile(join(isolation.rootWorktree, '.gitignore'), 'refs/\n')
          if (scenario === 'tracked')
            await rm(join(isolation.rootWorktree, 'refs'), { recursive: true, force: true })
          if (scenario === 'removed')
            await rm(join(isolation.rootWorktree, 'existing'), { recursive: true, force: true })
          await git(isolation.rootWorktree, ['clone', '-q', reference, 'refs/external'])
          await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'product result\n')
          const receipt = await captureIsolation(isolation)
          expect(receipt.captureStatus).toBe(scenario === 'baseline' ? 'captured' : 'failed')
          if (scenario === 'baseline') {
            expect(receipt.repositories.map((entry) => entry.relativePath)).toEqual([''])
            expect(receipt.repositories[0]?.changedFiles).toEqual([
              { path: 'tracked.txt', status: 'M' },
            ])
            const environment = await harness(directory)
            expect(
              (await integrateStagedReceipt(receipt, environment.destination, 'reference-parent'))
                .status,
            ).toBe('integrated')
            expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('product result\n')
            await expect(stat(join(directory, 'refs'))).rejects.toHaveProperty('code', 'ENOENT')
          } else {
            expect(receipt.error).toContain('nested repository boundary')
          }
        } finally {
          await cleanupWorkspaceArtifacts(isolation)
        }
      } finally {
        await rm(directory, { force: true, recursive: true })
        await rm(reference, { force: true, recursive: true })
      }
    },
    180_000,
  )

  it.each(['nested-parent', 'modified-parent', 'private-exclude'])(
    'checks new reference clones against %s ignore authority',
    async (scenario) => {
      const directory = await repository()
      const reference = await repository()
      try {
        await git(directory, ['clone', '-q', reference, 'product'])
        const product = join(directory, 'product')
        await mkdir(join(product, 'references'))
        await writeFile(
          join(product, 'references', '.gitignore'),
          scenario === 'private-exclude' ? '' : 'vendor/\n',
        )
        const isolation = await writer(directory, `reference-owner-${scenario}`)
        try {
          const isolatedProduct = join(isolation.rootWorktree, 'product')
          if (scenario === 'modified-parent')
            await writeFile(join(isolatedProduct, 'references', '.gitignore'), 'vendor/\n\n')
          if (scenario === 'private-exclude')
            await writeFile(
              join(isolatedProduct, '.git', 'info', 'exclude'),
              'references/vendor/\n',
            )
          await git(isolatedProduct, ['clone', '-q', reference, 'references/vendor/external'])
          const receipt = await captureIsolation(isolation)
          expect(receipt.captureStatus).toBe(scenario === 'nested-parent' ? 'captured' : 'failed')
          if (scenario === 'nested-parent') {
            expect(receipt.repositories.map((entry) => entry.relativePath)).toEqual(['', 'product'])
            expect(receipt.repositories.every((entry) => entry.changedFiles.length === 0)).toBe(
              true,
            )
          }
        } finally {
          await cleanupWorkspaceArtifacts(isolation)
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
        await rm(reference, { recursive: true, force: true })
      }
    },
    180_000,
  )
})
