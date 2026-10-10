import { readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import {
  captureWorkspaceIdentity,
  captureIsolationIdentity,
  captureWorkspaceSnapshot,
} from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupWorkspaceArtifacts,
  integrateStagedReceipt,
  reconstructCapturedIsolation,
} from '../src/isolation.ts'
import { harness, repository, writer } from './isolation-harness.ts'

describe('writer isolation: captured patches', () => {
  it('derives writer identity from its captured baseline instead of the live source', async () => {
    const directory = await repository()
    try {
      const before = await captureWorkspaceIdentity(directory)
      await writeFile(join(directory, 'tracked.txt'), 'captured baseline\n')
      const isolation = await writer(directory, 'immutable-identity')
      try {
        expect(before?.baselineTree).not.toBe(isolation.repositories[0]?.baselineTree)
        await writeFile(join(directory, 'tracked.txt'), 'later source mutation\n')
        const identity = await captureIsolationIdentity(isolation)
        expect(identity.baselineTree).toBe(isolation.repositories[0]?.baselineTree)
        expect(identity.snapshot.repositories.map((entry) => entry.tree)).toEqual(
          isolation.repositories.map((entry) => entry.baselineTree),
        )
        expect(await readFile(fileURLToPath(identity.patch.uri), 'utf8')).toContain(
          'captured baseline',
        )
        expect(await readFile(fileURLToPath(identity.patch.uri), 'utf8')).not.toContain(
          'later source mutation',
        )
        expect((await captureIsolationIdentity(isolation)).patch).toEqual(identity.patch)
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }, 180_000)

  it('captures an immutable read-only workspace snapshot', async () => {
    const directory = await repository()
    try {
      await writeFile(join(directory, 'tracked.txt'), 'first snapshot\n', 'utf8')
      const snapshot = await captureWorkspaceSnapshot(directory)
      if (snapshot === undefined) throw new Error('The workspace snapshot is unavailable.')
      expect(snapshot.repositories).toHaveLength(1)
      const entry = snapshot.repositories[0]
      if (entry === undefined) throw new Error('The repository snapshot is unavailable.')
      expect(entry.root).toBe(await realpath(directory))
      expect(entry.relativePath).toBe('')
      expect(entry.base).toBe(entry.tree)
      const patchPath = fileURLToPath(entry.patch.uri)
      expect(await readFile(patchPath, 'utf8')).toContain('-base')
      expect(await readFile(patchPath, 'utf8')).toContain('+first snapshot')
      await writeFile(join(directory, 'tracked.txt'), 'second snapshot\n', 'utf8')
      expect(await readFile(patchPath, 'utf8')).toContain('+first snapshot')
      expect(await readFile(patchPath, 'utf8')).not.toContain('+second snapshot')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('reconstructs a captured patch into a new isolation', async () => {
    const directory = await repository()
    try {
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      const first = await writer(directory, 'writer-reconstruct-first')
      await writeFile(join(first.rootWorktree, 'tracked.txt'), 'base\nretained\n', 'utf8')
      const receipt = await captureIsolation(first)
      await cleanupWorkspaceArtifacts(first)
      const resumed = await writer(directory, 'writer-reconstruct-resumed')
      try {
        await reconstructCapturedIsolation({ identity, receipt, workspace: resumed })
        expect(await readFile(join(resumed.rootWorktree, 'tracked.txt'), 'utf8')).toBe(
          'base\nretained\n',
        )
        expect((await captureIsolation(resumed)).repositories[0]?.resultTree).toBe(
          receipt.repositories[0]?.resultTree,
        )
      } finally {
        await cleanupWorkspaceArtifacts(resumed)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('rejects captured work when the source baseline changed', async () => {
    const directory = await repository()
    try {
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      const first = await writer(directory, 'writer-reconstruct-conflict')
      await writeFile(join(first.rootWorktree, 'tracked.txt'), 'base\nretained\n', 'utf8')
      const receipt = await captureIsolation(first)
      await cleanupWorkspaceArtifacts(first)
      await writeFile(join(directory, 'tracked.txt'), 'base\nconcurrent\n', 'utf8')
      const resumed = await writer(directory, 'writer-reconstruct-conflict-resumed')
      try {
        await expect(
          reconstructCapturedIsolation({ identity, receipt, workspace: resumed }),
        ).rejects.toThrow('captured baseline')
        expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\nconcurrent\n')
      } finally {
        await cleanupWorkspaceArtifacts(resumed)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('rejects a tampered captured patch digest', async () => {
    const directory = await repository()
    try {
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      const first = await writer(directory, 'writer-reconstruct-tampered')
      await writeFile(join(first.rootWorktree, 'tracked.txt'), 'base\nretained\n', 'utf8')
      const receipt = await captureIsolation(first)
      await cleanupWorkspaceArtifacts(first)
      const patch = receipt.repositories[0]?.patch.path
      if (patch === undefined) throw new Error('The captured patch path is unavailable.')
      await writeFile(patch, 'tampered\n', 'utf8')
      const resumed = await writer(directory, 'writer-reconstruct-tampered-resumed')
      try {
        await expect(
          reconstructCapturedIsolation({ identity, receipt, workspace: resumed }),
        ).rejects.toThrow('digest')
      } finally {
        await cleanupWorkspaceArtifacts(resumed)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('rejects a missing captured patch artifact', async () => {
    const directory = await repository()
    try {
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      const first = await writer(directory, 'writer-reconstruct-missing')
      await writeFile(join(first.rootWorktree, 'tracked.txt'), 'base\nretained\n', 'utf8')
      const receipt = await captureIsolation(first)
      await cleanupWorkspaceArtifacts(first)
      const patch = receipt.repositories[0]?.patch.path
      if (patch === undefined) throw new Error('The captured patch path is unavailable.')
      await rm(patch)
      const resumed = await writer(directory, 'writer-reconstruct-missing-resumed')
      try {
        await expect(
          reconstructCapturedIsolation({ identity, receipt, workspace: resumed }),
        ).rejects.toThrow('missing')
      } finally {
        await cleanupWorkspaceArtifacts(resumed)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('does not reapply an already integrated captured patch', async () => {
    const directory = await repository()
    try {
      const identity = await captureWorkspaceIdentity(directory)
      if (identity === undefined) throw new Error('The workspace identity is unavailable.')
      const first = await writer(directory, 'writer-reconstruct-integrated')
      await writeFile(join(first.rootWorktree, 'tracked.txt'), 'base\nintegrated\n', 'utf8')
      const integrated = await integrateStagedReceipt(
        await captureIsolation(first),
        (await harness(directory)).destination,
        first.writerId,
      )
      expect(integrated.status).toBe('integrated')
      await cleanupWorkspaceArtifacts(first)
      const resumed = await writer(directory, 'writer-reconstruct-integrated-resumed')
      try {
        await reconstructCapturedIsolation({ identity, receipt: integrated, workspace: resumed })
        expect(await readFile(join(resumed.rootWorktree, 'tracked.txt'), 'utf8')).toBe(
          'base\nintegrated\n',
        )
      } finally {
        await cleanupWorkspaceArtifacts(resumed)
      }
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
