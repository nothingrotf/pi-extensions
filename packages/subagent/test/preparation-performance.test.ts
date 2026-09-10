import { mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { expect, it } from 'vite-plus/test'

import { commonDirectory, git, nestedRepositories } from '../src/git-isolation.ts'
import { captureIsolation, cleanupWorkspaceArtifacts, createIsolation } from '../src/isolation.ts'
import { createRootWorkspaceContext } from '../src/workspace.ts'

it('measures preparation with four dirty repositories and private dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subagent-preparation-'))
  const paths = ['', 'repos/alchemy', 'repos/cf-twitch', 'repos/effect']
  try {
    for (const path of paths) {
      const root = join(directory, path)
      await mkdir(root, { recursive: true })
      await git(root, ['init', '-q', '-b', 'main'])
      await git(root, ['config', 'user.name', 'Test User'])
      await git(root, ['config', 'user.email', 'test@example.com'])
      await writeFile(join(root, '.gitignore'), 'node_modules/\n')
      for (let index = 0; index < 300; index += 1) {
        const source = join(root, 'src', `module-${index}`)
        await mkdir(source, { recursive: true })
        await writeFile(join(source, 'index.ts'), `export const value = ${index}\n`)
      }
      await writeFile(join(root, 'tracked.txt'), 'base\n')
      await git(root, ['add', '.'])
      await git(root, ['commit', '-qm', 'base'])
      await writeFile(join(root, 'tracked.txt'), 'staged\n')
      await git(root, ['add', 'tracked.txt'])
      await writeFile(join(root, 'tracked.txt'), 'dirty\n')
      await writeFile(join(root, 'untracked.txt'), 'untracked\n')
      await mkdir(join(root, 'node_modules', 'dependency'), { recursive: true })
      await writeFile(join(root, 'node_modules', 'dependency', 'index.js'), 'dependency\n')
      await symlink('dependency', join(root, 'node_modules', 'linked'))
    }
    const parent = await createRootWorkspaceContext(directory, 'preparation-performance')
    const durableCommonDir = await commonDirectory(directory)
    const destination = {
      destinationPhysicalRoot: parent.physicalRoot,
      destinationWorkspaceId: parent.workspaceId,
      durableCommonDir,
    }
    const timings: number[] = []
    const discoveryTimings: number[] = []
    for (let trial = 0; trial < 3; trial += 1) {
      const discoveryStart = performance.now()
      expect(await nestedRepositories(directory)).toEqual(paths.slice(1))
      discoveryTimings.push(performance.now() - discoveryStart)
      const start = performance.now()
      const isolation = await createIsolation({
        destination,
        integration: 'apply',
        parent,
        relativeCwd: '',
        spawnOrdinal: trial,
        writerId: `preparation-${trial}`,
      })
      timings.push(performance.now() - start)
      expect(isolation.repositories.map((entry) => entry.relativePath)).toEqual(paths)
      for (const entry of isolation.repositories) {
        expect(await readFile(join(entry.worktree, 'tracked.txt'), 'utf8')).toBe('dirty\n')
        expect(await readFile(join(entry.worktree, 'untracked.txt'), 'utf8')).toBe('untracked\n')
        expect(await readlink(join(entry.worktree, 'node_modules', 'linked'))).toBe('dependency')
        expect(entry.dependencyPaths).toEqual(['node_modules'])
        expect(await commonDirectory(entry.worktree)).not.toBe(
          await commonDirectory(entry.physicalRepoRoot),
        )
        await writeFile(join(entry.worktree, 'node_modules', 'dependency', 'index.js'), 'private\n')
        expect(
          await readFile(
            join(entry.physicalRepoRoot, 'node_modules', 'dependency', 'index.js'),
            'utf8',
          ),
        ).toBe('dependency\n')
        expect(await git(entry.physicalRepoRoot, ['show', ':tracked.txt'])).toBe('staged\n')
      }
      const receipt = await captureIsolation(isolation)
      expect(receipt.captureStatus).toBe('captured')
      expect(receipt.repositories.map((entry) => entry.relativePath)).toEqual(paths)
      expect(receipt.repositories.every((entry) => entry.changedFiles.length === 0)).toBe(true)
      await cleanupWorkspaceArtifacts(isolation)
    }
    process.stdout.write(
      `${JSON.stringify({ preparationMs: timings, discoveryMs: discoveryTimings })}\n`,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}, 180_000)
