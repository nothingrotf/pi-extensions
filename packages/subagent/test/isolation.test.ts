import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

import {
  captureWriterIsolation,
  createWriterIsolation,
  recoverWriterIsolations,
} from '../src/isolation.ts'

const execFileAsync = promisify(execFile)

async function command(cwd: string, args: readonly string[]): Promise<string> {
  const executable = args[0]
  if (executable === undefined) throw new Error('The command is empty.')
  const result = await execFileAsync(executable, args.slice(1), { cwd })
  return result.stdout
}

async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'subagent-isolation-test-'))
  await command(directory, ['git', 'init', '-q'])
  await command(directory, ['git', 'config', 'user.name', 'Test User'])
  await command(directory, ['git', 'config', 'user.email', 'test@example.com'])
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n', 'utf8')
  await writeFile(join(directory, 'tracked.txt'), 'base\n', 'utf8')
  await command(directory, ['git', 'add', '.gitignore', 'tracked.txt'])
  await command(directory, ['git', 'commit', '-q', '-m', 'base'])
  return directory
}

describe('writer isolation', () => {
  it('captures and applies a task delta over baseline WIP', async () => {
    const directory = await repository()
    try {
      await command(directory, ['mkdir', 'node_modules'])
      await writeFile(join(directory, 'node_modules', 'dependency.txt'), 'dependency\n', 'utf8')
      await writeFile(join(directory, 'tracked.txt'), 'base\nwip\n', 'utf8')
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-1',
      })
      expect(await readFile(join(isolation.rootWorktree, 'tracked.txt'), 'utf8')).toBe(
        'base\nwip\n',
      )
      expect(
        await readFile(join(isolation.rootWorktree, 'node_modules', 'dependency.txt'), 'utf8'),
      ).toBe('dependency\n')
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'base\nwip\nagent\n', 'utf8')
      await writeFile(join(isolation.rootWorktree, 'created.txt'), 'created\n', 'utf8')
      const receipt = await captureWriterIsolation(isolation, true)
      expect(receipt.status).toBe('integrated')
      expect(receipt.cleanupDebt).toBe(false)
      expect(receipt.repositories).toHaveLength(1)
      expect(receipt.repositories[0]?.status).toBe('integrated')
      expect(receipt.repositories[0]?.changedFiles).toEqual([
        { path: 'created.txt', status: 'A' },
        { path: 'tracked.txt', status: 'M' },
      ])
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\nwip\nagent\n')
      expect(await readFile(join(directory, 'created.txt'), 'utf8')).toBe('created\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

  it('preserves a patch when the destination changes before integration', async () => {
    const directory = await repository()
    try {
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-2',
      })
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'agent\n', 'utf8')
      await writeFile(join(directory, 'tracked.txt'), 'parent\n', 'utf8')
      const receipt = await captureWriterIsolation(isolation, true)
      expect(receipt.status).toBe('conflict')
      expect(receipt.repositories[0]?.status).toBe('conflict')
      expect(receipt.repositories[0]?.error).toContain('destination tree changed')
      expect(receipt.repositories[0]?.patch.sha256).toHaveLength(64)
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('parent\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

  it('applies a retained patch when the repository path contains spaces', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'subagent isolation parent '))
    const directory = join(parent, 'repo with spaces')
    await mkdir(directory)
    try {
      await command(directory, ['git', 'init', '-q'])
      await command(directory, ['git', 'config', 'user.name', 'Test User'])
      await command(directory, ['git', 'config', 'user.email', 'test@example.com'])
      await writeFile(join(directory, 'tracked.txt'), 'base\n', 'utf8')
      await command(directory, ['git', 'add', 'tracked.txt'])
      await command(directory, ['git', 'commit', '-q', '-m', 'base'])
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-spaces',
      })
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'changed\n', 'utf8')
      const receipt = await captureWriterIsolation(isolation, true)
      expect(receipt.status).toBe('integrated')
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('changed\n')
    } finally {
      await rm(parent, { force: true, recursive: true })
    }
  }, 30_000)

  it('captures nested repository changes in an ordered ledger', async () => {
    const directory = await repository()
    try {
      const nested = join(directory, 'nested')
      await command(directory, ['mkdir', 'nested'])
      await command(nested, ['git', 'init', '-q'])
      await command(nested, ['git', 'config', 'user.name', 'Test User'])
      await command(nested, ['git', 'config', 'user.email', 'test@example.com'])
      await writeFile(join(nested, 'nested.txt'), 'nested base\n', 'utf8')
      await command(nested, ['git', 'add', 'nested.txt'])
      await command(nested, ['git', 'commit', '-q', '-m', 'nested base'])
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-nested',
      })
      await writeFile(
        join(isolation.rootWorktree, 'nested', 'nested.txt'),
        'nested agent\n',
        'utf8',
      )
      const receipt = await captureWriterIsolation(isolation, true)
      expect(receipt.status).toBe('integrated')
      expect(receipt.repositories.map((repository) => repository.relativePath)).toEqual([
        '',
        'nested',
      ])
      expect(await readFile(join(nested, 'nested.txt'), 'utf8')).toBe('nested agent\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

  it('recovers a dead writer and preserves its patch', async () => {
    const directory = await repository()
    try {
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-crash',
      })
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'crash work\n', 'utf8')
      const deadOwner = JSON.stringify({
        attemptId: isolation.attemptId,
        pid: 999_999,
        startedAt: 1,
        token: isolation.leaseToken,
        writerId: isolation.writerId,
      })
      await writeFile(join(isolation.baseDir, 'owner.json'), deadOwner, 'utf8')
      await writeFile(isolation.leasePath, deadOwner, 'utf8')
      const recoveries = await recoverWriterIsolations(directory)
      const recovery = recoveries.find((item) => item.attemptId === isolation.attemptId)
      expect(recovery?.ownerStatus).toBe('dead')
      expect(recovery?.receipt?.status).toBe('captured')
      expect(recovery?.receipt?.repositories[0]?.patch.sha256).toHaveLength(64)
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)

  it('captures failed work without applying it', async () => {
    const directory = await repository()
    try {
      const isolation = await createWriterIsolation({
        cwd: directory,
        integration: 'apply',
        writerId: 'writer-3',
      })
      await writeFile(join(isolation.rootWorktree, 'tracked.txt'), 'partial\n', 'utf8')
      const receipt = await captureWriterIsolation(isolation, false)
      expect(receipt.status).toBe('captured')
      expect(receipt.repositories[0]?.status).toBe('captured')
      expect(receipt.repositories[0]?.changedFiles).toEqual([{ path: 'tracked.txt', status: 'M' }])
      expect(await readFile(join(directory, 'tracked.txt'), 'utf8')).toBe('base\n')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  }, 30_000)
})
