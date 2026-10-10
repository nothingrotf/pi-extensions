import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { createServer } from 'vite-plus'
import { describe, expect, it } from 'vite-plus/test'

import { git, SHARED_TASK_CACHE_PATHS } from '../src/git-isolation.ts'
import {
  captureIsolation,
  cleanupCapturedReceipt,
  cleanupWorkspaceArtifacts,
} from '../src/isolation.ts'
import { relativeCwdWithin, writeManifest } from '../src/workspace.ts'
import { command, repository, writer } from './isolation-harness.ts'

describe('writer isolation', () => {
  it('serves browser modules without disabling Vite filesystem guards', async () => {
    const directory = await repository()
    try {
      await mkdir(join(directory, 'src'))
      await writeFile(join(directory, 'src', 'probe.ts'), 'export const answer = 42\n')
      const isolation = await writer(directory, 'vite-browser')
      try {
        const server = await createServer({
          configFile: false,
          root: isolation.rootWorktree,
          server: { middlewareMode: true, watch: null },
        })
        try {
          expect((await server.transformRequest('/src/probe.ts'))?.code).toContain('answer = 42')
          await expect(server.transformRequest('/.git/config')).rejects.toThrow(
            'Failed to load url',
          )
        } finally {
          await server.close()
        }
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it.each([false, true])(
    'cleans captured execution paths including legacy layout=%s',
    async (legacy) => {
      const directory = await repository()
      try {
        const isolation = await writer(directory, 'captured-cleanup')
        const receipt = await captureIsolation(isolation)
        let physicalRoot = isolation.rootWorktree
        if (legacy) {
          physicalRoot = join(isolation.baseDir, 'root')
          await rename(isolation.rootWorktree, physicalRoot)
          await writeManifest({ ...isolation.manifest, physicalRoot })
        }
        expect(await cleanupCapturedReceipt(receipt)).toBe(false)
        await expect(stat(physicalRoot)).rejects.toHaveProperty('code', 'ENOENT')
        await expect(stat(isolation.baseDir)).rejects.toHaveProperty('code', 'ENOENT')
        const ref = receipt.repositories[0]?.durableRef
        if (ref === undefined) throw new Error('The durable result ref is missing.')
        expect((await git(directory, ['rev-parse', ref])).trim()).toBe(
          receipt.repositories[0]?.resultCommit,
        )
        expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
      } finally {
        await rm(directory, { force: true, recursive: true })
      }
    },
    180_000,
  )

  it('uses a canonical execution root for nested workspace containment', async () => {
    const directory = await repository()
    try {
      const isolation = await writer(directory, 'canonical-root')
      try {
        const canonical = await realpath(isolation.rootWorktree)
        expect(isolation.context.physicalRoot).toBe(canonical)
        expect(relativeCwdWithin(isolation.context.physicalRoot, canonical)).toBe('')
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('rejects cleanup of a retained path outside its attempt', async () => {
    const directory = await repository()
    const unrelated = await mkdtemp(join(tmpdir(), 'subagent-cleanup-unrelated-'))
    try {
      const isolation = await writer(directory, 'unsafe-cleanup')
      try {
        await writeFile(join(unrelated, 'keep.txt'), 'keep')
        const receipt = await captureIsolation(isolation)
        await writeManifest({ ...isolation.manifest, physicalRoot: unrelated })
        expect(await cleanupCapturedReceipt(receipt)).toBe(true)
        expect(await readFile(join(unrelated, 'keep.txt'), 'utf8')).toBe('keep')
        expect((await stat(isolation.baseDir)).isDirectory()).toBe(true)
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
      await rm(unrelated, { force: true, recursive: true })
    }
  })

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
      await writeFile(
        join(bin, 'python3'),
        '#!/bin/sh\necho "Operation not supported" >&2\nexit 45\n',
      )
      await chmod(join(bin, 'python3'), 0o755)
      await mkdir(join(directory, 'node_modules'))
      await writeFile(join(directory, 'node_modules', 'dependency.txt'), 'dependency\n')
      process.env.PATH = `${bin}:${originalPath ?? ''}`
      const isolation = await writer(directory, 'partial-clone')
      await isolation.dependencies
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

  it('clones the dependency tree as one copy-on-write unit on macOS', async () => {
    if (process.platform !== 'darwin') return
    const directory = await repository()
    const originalPath = process.env.PATH
    try {
      const bin = join(directory, 'bin')
      await mkdir(bin)
      await writeFile(join(bin, 'cp'), '#!/bin/sh\necho "cp must not run" >&2\nexit 1\n')
      await chmod(join(bin, 'cp'), 0o755)
      await mkdir(join(directory, 'node_modules', 'pkg'), { recursive: true })
      await writeFile(join(directory, 'node_modules', 'pkg', 'index.js'), 'source\n', 'utf8')
      process.env.PATH = `${bin}:${originalPath ?? ''}`
      const isolation = await writer(directory, 'clonefile-tree')
      try {
        await isolation.dependencies
        const cloned = join(isolation.rootWorktree, 'node_modules', 'pkg', 'index.js')
        expect(await readFile(cloned, 'utf8')).toBe('source\n')
        expect(isolation.repositories[0]?.dependencyMode).toBe('copy-on-write')
        await writeFile(cloned, 'edited in worktree\n', 'utf8')
        expect(await readFile(join(directory, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe(
          'source\n',
        )
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      if (originalPath === undefined) delete process.env.PATH
      else process.env.PATH = originalPath
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('returns the workspace before dependency materialization finishes', async () => {
    const directory = await repository()
    try {
      await mkdir(join(directory, 'node_modules', 'bulk'), { recursive: true })
      for (let index = 0; index < 400; index += 1) {
        await writeFile(
          join(directory, 'node_modules', 'bulk', `module-${index}.txt`),
          'dependency\n'.repeat(64),
          'utf8',
        )
      }
      const isolation = await writer(directory, 'deferred-dependencies')
      try {
        expect(await readFile(join(isolation.rootWorktree, 'tracked.txt'), 'utf8')).toBe('base\n')
        await isolation.dependencies
        expect(
          await readFile(
            join(isolation.rootWorktree, 'node_modules', 'bulk', 'module-399.txt'),
            'utf8',
          ),
        ).toContain('dependency')
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('completes root dependencies before nested repository dependencies', async () => {
    const directory = await repository()
    try {
      const nested = join(directory, 'nested')
      await mkdir(nested, { recursive: true })
      await command(nested, ['git', 'init', '-q', '-b', 'main'])
      await command(nested, ['git', 'config', 'user.name', 'Test User'])
      await command(nested, ['git', 'config', 'user.email', 'test@example.com'])
      await writeFile(join(nested, '.gitignore'), 'node_modules/\n', 'utf8')
      await writeFile(join(nested, 'tracked.txt'), 'base\n', 'utf8')
      await command(nested, ['git', 'add', '.'])
      await command(nested, ['git', 'commit', '-q', '-m', 'base'])
      await writeFile(join(directory, '.gitignore'), 'node_modules/\nnested/\n', 'utf8')
      await mkdir(join(directory, 'node_modules'), { recursive: true })
      await writeFile(join(directory, 'node_modules', 'root.txt'), 'root\n', 'utf8')
      await mkdir(join(nested, 'node_modules', 'bulk'), { recursive: true })
      for (let index = 0; index < 300; index += 1) {
        await writeFile(
          join(nested, 'node_modules', 'bulk', `module-${index}.txt`),
          'dependency\n'.repeat(64),
          'utf8',
        )
      }
      const isolation = await writer(directory, 'root-first')
      try {
        await isolation.rootDependencies
        expect(
          await readFile(join(isolation.rootWorktree, 'node_modules', 'root.txt'), 'utf8'),
        ).toBe('root\n')
        await isolation.dependencies
        const nestedWorktree = isolation.repositories.find(
          (entry) => entry.relativePath === 'nested',
        )?.worktree
        if (nestedWorktree === undefined) throw new Error('Missing nested worktree')
        expect(
          await readFile(join(nestedWorktree, 'node_modules', 'bulk', 'module-299.txt'), 'utf8'),
        ).toContain('dependency')
      } finally {
        await cleanupWorkspaceArtifacts(isolation)
      }
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)

  it('shares one task cache directory across writers of the same repository', async () => {
    const directory = await repository()
    try {
      await mkdir(join(directory, 'node_modules'), { recursive: true })
      const first = await writer(directory, 'cache-first')
      await first.dependencies
      const cachePath = join(first.rootWorktree, SHARED_TASK_CACHE_PATHS[0] ?? '')
      const sharedTarget = await realpath(cachePath)
      expect(sharedTarget.startsWith(first.rootWorktree)).toBe(false)
      await writeFile(join(cachePath, 'entry.bin'), 'cached\n', 'utf8')
      const second = await writer(directory, 'cache-second')
      await second.dependencies
      const secondCache = join(second.rootWorktree, SHARED_TASK_CACHE_PATHS[0] ?? '')
      expect(await realpath(secondCache)).toBe(sharedTarget)
      expect(await readFile(join(secondCache, 'entry.bin'), 'utf8')).toBe('cached\n')
      await cleanupWorkspaceArtifacts(first)
      await cleanupWorkspaceArtifacts(second)
      expect(await readFile(join(sharedTarget, 'entry.bin'), 'utf8')).toBe('cached\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 180_000)
})
