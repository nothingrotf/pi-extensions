import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { git } from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupWorkspaceArtifacts,
  integrateStagedReceipt,
} from '../src/isolation.ts'
import { command, harness, repository, writer } from './isolation-harness.ts'

describe('writer isolation: capture and merge', () => {
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
      await isolation.dependencies
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
})
