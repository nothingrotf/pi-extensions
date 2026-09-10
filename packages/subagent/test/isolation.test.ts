import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

import {
  commitTree,
  commonDirectory,
  git,
  nestedRepositories,
  promoteCommit,
  repositoryRoot,
} from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupWorkspaceArtifacts,
  createIsolation,
  integrateStagedReceipt,
  needsRecoveryCapture,
  recoverIsolations,
  type IsolationDestination,
} from '../src/isolation.ts'
import type { WorkspaceLifecycle } from '../src/schema.ts'
import {
  acquireLock,
  createRootWorkspaceContext,
  currentLockOwner,
  relativeCwdWithin,
} from '../src/workspace.ts'

const execFileAsync = promisify(execFile)

async function command(cwd: string, args: readonly string[]): Promise<string> {
  const executable = args[0]
  if (executable === undefined) throw new Error('The command is empty.')
  const result = await execFileAsync(executable, args.slice(1), { cwd })
  return result.stdout
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'subagent-isolation-test-'))
  await command(directory, ['git', 'init', '-q', '-b', 'main'])
  await command(directory, ['git', 'config', 'user.name', 'Test User'])
  await command(directory, ['git', 'config', 'user.email', 'test@example.com'])
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n', 'utf8')
  await writeFile(join(directory, 'tracked.txt'), 'base\n', 'utf8')
  await command(directory, ['git', 'add', '.gitignore', 'tracked.txt'])
  await command(directory, ['git', 'commit', '-q', '-m', 'base'])
  return directory
}

interface Harness {
  context: Awaited<ReturnType<typeof createRootWorkspaceContext>>
  destination: IsolationDestination
}

async function harness(cwd: string): Promise<Harness> {
  const context = await createRootWorkspaceContext(cwd, 'scope-test')
  const repoRoot = (await repositoryRoot(context.physicalRoot)) ?? context.physicalRoot
  return {
    context,
    destination: {
      destinationPhysicalRoot: context.physicalRoot,
      destinationWorkspaceId: context.workspaceId,
      durableCommonDir: await commonDirectory(repoRoot),
    },
  }
}

async function writer(cwd: string, writerId: string, relativeCwd = '') {
  const environment = await harness(cwd)
  return createIsolation({
    destination: environment.destination,
    integration: 'apply',
    parent: environment.context,
    relativeCwd,
    spawnOrdinal: 1,
    writerId,
  })
}

describe('writer isolation', () => {
  it('accepts dot-prefixed child paths and rejects parent escapes', () => {
    const root = join(tmpdir(), 'workspace')
    expect(relativeCwdWithin(root, join(root, '..cache'))).toBe('..cache')
    expect(() => relativeCwdWithin(root, join(dirname(root), 'outside'))).toThrow(
      'escapes its workspace root',
    )
  })

  it('retries a partial dependency clone without nesting the source directory', async () => {
    const directory = await repository()
    const originalPath = process.env.PATH
    try {
      const bin = join(directory, 'bin')
      await mkdir(bin)
      await writeFile(
        join(bin, 'cp'),
        '#!/bin/sh\nif [ "$1" = "-aR" ]; then exec /bin/cp "$@"; fi\nfor target do :; done\nmkdir -p "$target"\nprintf partial > "$target/dependency.txt"\nexit 1\n',
      )
      await chmod(join(bin, 'cp'), 0o755)
      await mkdir(join(directory, 'node_modules'))
      await writeFile(join(directory, 'node_modules', 'dependency.txt'), 'dependency\n')
      process.env.PATH = `${bin}:${originalPath ?? ''}`
      const isolation = await writer(directory, 'partial-clone')
      expect(
        await readFile(join(isolation.rootWorktree, 'node_modules', 'dependency.txt'), 'utf8'),
      ).toBe('dependency\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('captures and applies a task delta over baseline WIP', async () => {
    const directory = await repository()
    try {
      await mkdir(join(directory, 'node_modules'))
      await writeFile(join(directory, 'node_modules', 'dependency.txt'), 'dependency\n', 'utf8')
      await writeFile(join(directory, 'tracked.txt'), 'base\nwip\n', 'utf8')
      const isolation = await writer(directory, 'writer-1')
      expect(await readFile(join(isolation.rootWorktree, 'tracked.txt'), 'utf8')).toBe(
        'base\nwip\n',
      )
      expect(
        await readFile(join(isolation.rootWorktree, 'node_modules', 'dependency.txt'), 'utf8'),
      ).toBe('dependency\n')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'base\nwip\nagent\n', 'utf8')
      await writeFile(join(isolation.rootWorktree, 'created.txt'), 'created\n', 'utf8')
      const receipt = await captureIsolation(isolation)
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(receipt, environment.destination, 'writer-1')
      expect(integrated.status).toBe('integrated')
      expect(integrated.cleanupDebt).toBe(false)
      expect(integrated.repositories).toHaveLength(1)
      expect(integrated.repositories[0]?.status).toBe('integrated')
      expect(integrated.repositories[0]?.changedFiles).toEqual([
        { path: 'created.txt', status: 'A' },
        { path: 'tracked.txt', status: 'M' },
      ])
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\nwip\nagent\n')
      expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe('created\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('gives the writer private git metadata', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-private')
      const parentGit = (
        await git(directory, ['rev-parse', '--path-format=absolute', '--git-dir'])
      ).trim()
      const childGit = (
        await git(isolation.rootWorktree, ['rev-parse', '--path-format=absolute', '--git-dir'])
      ).trim()
      expect(childGit).not.toBe(parentGit)
      const parentCommon = (
        await git(directory, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
      ).trim()
      const childCommon = (
        await git(isolation.rootWorktree, [
          'rev-parse',
          '--path-format=absolute',
          '--git-common-dir',
        ])
      ).trim()
      expect(childCommon).not.toBe(parentCommon)
      await git(isolation.rootWorktree, ['branch', 'child-branch'])
      const parentBranches = (await git(directory, ['branch', '--list', 'child-branch'])).trim()
      expect(parentBranches).toBe('')
      await command(isolation.rootWorktree, ['git', 'tag', 'child-tag'])
      const parentTags = (await git(directory, ['tag', '--list', 'child-tag'])).trim()
      expect(parentTags).toBe('')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'child stash\n', 'utf8')
      await git(isolation.rootWorktree, ['stash', 'push', '-m', 'child-stash'])
      expect((await git(directory, ['stash', 'list'])).trim()).toBe('')
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('integrates disjoint sibling changes after the first writer changed the destination', async () => {
    const directory = await repository()
    try {
      const first = await writer(directory, 'writer-sibling-1')
      const second = await writer(directory, 'writer-sibling-2')
      await writeFile(join(first.rootWorktree, 'first.txt'), 'first\n', 'utf8')
      await writeFile(join(second.rootWorktree, 'second.txt'), 'second\n', 'utf8')
      const environment = await harness(directory)
      const firstIntegrated = await integrateStagedReceipt(
        await captureIsolation(first),
        environment.destination,
        'writer-sibling-1',
      )
      expect(firstIntegrated.status).toBe('integrated')
      const secondIntegrated = await integrateStagedReceipt(
        await captureIsolation(second),
        environment.destination,
        'writer-sibling-2',
      )
      expect(secondIntegrated.status).toBe('integrated')
      expect(await readFile(join(directory, 'first.txt'), 'utf8')).toBe('first\n')
      expect(await readFile(join(directory, 'second.txt'), 'utf8')).toBe('second\n')
      await cleanupWorkspaceArtifacts(first)
      await cleanupWorkspaceArtifacts(second)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('merges compatible same-file edits and retains conflicts without corrupting the destination', async () => {
    const directory = await repository()
    try {
      await writeFile(join(directory, 'lines.txt'), 'one\ntwo\nthree\nfour\nfive\n', 'utf8')
      await command(directory, ['git', 'add', 'lines.txt'])
      await command(directory, ['git', 'commit', '-q', '-m', 'lines'])
      const first = await writer(directory, 'writer-merge-1')
      const second = await writer(directory, 'writer-merge-2')
      const content = await readFile(join(first.rootWorktree, 'lines.txt'), 'utf8')
      await writeFile(
        join(first.rootWorktree, 'lines.txt'),
        content.replace('one\n', 'one-changed\n'),
        'utf8',
      )
      const secondContent = await readFile(join(second.rootWorktree, 'lines.txt'), 'utf8')
      await writeFile(
        join(second.rootWorktree, 'lines.txt'),
        secondContent.replace('five\n', 'five-changed\n'),
        'utf8',
      )
      const environment = await harness(directory)
      const firstIntegrated = await integrateStagedReceipt(
        await captureIsolation(first),
        environment.destination,
        'writer-merge-1',
      )
      expect(firstIntegrated.status).toBe('integrated')
      const secondIntegrated = await integrateStagedReceipt(
        await captureIsolation(second),
        environment.destination,
        'writer-merge-2',
      )
      expect(secondIntegrated.status).toBe('integrated')
      const merged = await readFile(join(directory, 'lines.txt'), 'utf8')
      expect(merged).toBe('one-changed\ntwo\nthree\nfour\nfive-changed\n')
      await cleanupWorkspaceArtifacts(first)

      const third = await writer(directory, 'writer-conflict')
      const thirdContent = await readFile(join(third.rootWorktree, 'lines.txt'), 'utf8')
      await writeFile(
        join(third.rootWorktree, 'lines.txt'),
        thirdContent.replace('one-changed\n', 'one-conflicting\n'),
        'utf8',
      )
      await writeFile(
        join(directory, 'lines.txt'),
        'one-parent\n' + thirdContent.slice('one-changed\n'.length),
        'utf8',
      )
      const conflictReceipt = await integrateStagedReceipt(
        await captureIsolation(third),
        environment.destination,
        'writer-conflict',
      )
      expect(conflictReceipt.status).toBe('conflict')
      expect(conflictReceipt.repositories[0]?.status).toBe('conflict')
      expect(conflictReceipt.repositories[0]?.mergeArtifacts).toBeDefined()
      expect(await readFile(join(directory, 'lines.txt'), 'utf8')).toContain('one-parent\n')
      await cleanupWorkspaceArtifacts(third)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('keeps destination staged state intact and adds child changes as unstaged', async () => {
    const directory = await repository()
    try {
      await writeFile(join(directory, 'tracked.txt'), 'base\nchild\n', 'utf8')
      await writeFile(join(directory, 'staged.txt'), 'staged\n', 'utf8')
      await command(directory, ['git', 'add', 'staged.txt'])
      const isolation = await writer(directory, 'writer-dirty')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'base\nchild\n', 'utf8')
      const environment = await harness(directory)
      const integrated = await integrateStagedReceipt(
        await captureIsolation(isolation),
        environment.destination,
        'writer-dirty',
      )
      expect(integrated.status).toBe('integrated')
      const staged = (await git(directory, ['diff', '--cached', '--name-only'])).trim()
      expect(staged).toBe('staged.txt')
      const unstaged = (await git(directory, ['diff', '--name-only'])).trim()
      expect(unstaged.split('\n')).toContain('tracked.txt')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('keeps result commits durable after workspace cleanup', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-durable')
      await writeFile(join(isolation.rootWorktree, 'durable.txt'), 'durable\n', 'utf8')
      const environment = await harness(directory)
      const receipt = await captureIsolation(isolation)
      const integrated = await integrateStagedReceipt(
        receipt,
        environment.destination,
        'writer-durable',
      )
      const durableRef = integrated.repositories[0]?.durableRef
      expect(durableRef).toBeDefined()
      await cleanupWorkspaceArtifacts(isolation)
      const resolved = await git(directory, ['rev-parse', durableRef ?? ''])
      expect(resolved.trim()).toBe(integrated.repositories[0]?.resultCommit)
      expect(await readFile(join(directory, 'durable.txt'), 'utf8')).toBe('durable\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

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

  it('recovers a dead writer workspace and preserves its patch', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-crash')
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
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('leaves captured dead workspaces untouched during startup recovery', async () => {
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
          state: 'staged',
        }),
        'utf8',
      )
      const recoveries = await recoverIsolations(directory)
      const recovery = recoveries.find((item) => item.attemptId === isolation.attemptId)
      expect(recovery?.ownerStatus).toBe('dead')
      expect(recovery?.receipt).toBeUndefined()
      expect((await git(durableCommonDir, ['rev-parse', durableRef])).trim()).toBe(before)
      expect(await readFile(join(isolation.rootWorktree, 'tracked.txt'), 'utf8')).toBe(
        'staged work\n',
      )
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

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

  it('captures failed work without applying it', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'writer-3')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'partial\n', 'utf8')
      const receipt = await captureIsolation(isolation)
      expect(receipt.status).toBe('captured')
      expect(receipt.integrationStatus).not.toBe('integrated')
      expect(receipt.repositories[0]?.changedFiles).toEqual([{ path: 'tracked.txt', status: 'M' }])
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
      await cleanupWorkspaceArtifacts(isolation)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)
})
