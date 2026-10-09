import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { issueSlug, prepareIssueWorkspace, workspaceIsLive } from '../src/delivery-workspace.ts'

const execFile = promisify(execFileCallback)

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim()
}

describe('issue workspaces', () => {
  let root: string
  let source: string
  let previousRoot: string | undefined

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-workspace-')))
    source = join(root, 'source')
    await mkdir(join(source, '.pstack'), { recursive: true })
    await mkdir(join(source, 'node_modules', 'dep'), { recursive: true })
    await writeFile(join(source, '.gitignore'), '.env\nnode_modules/\nlocal.log\n')
    await writeFile(join(source, '.worktreeinclude'), '.env\n')
    await writeFile(join(source, '.env'), 'TOKEN=local\n')
    await writeFile(join(source, 'local.log'), 'not copied\n')
    await writeFile(join(source, 'node_modules', 'dep', 'index.js'), 'export {}\n')
    await writeFile(
      join(source, '.pstack', 'worktree-setup.sh'),
      'echo "$PSTACK_ISSUE" >> "$PSTACK_SOURCE_ROOT/setup-runs"\n',
    )
    await writeFile(join(source, 'README.md'), 'source\n')
    await git(source, 'init', '-q', '-b', 'main')
    await git(source, 'config', 'user.email', 'test@example.com')
    await git(source, 'config', 'user.name', 'Test')
    await git(source, 'add', '.')
    await git(source, 'commit', '-q', '-m', 'init')
    previousRoot = process.env['PSTACK_WORKTREE_ROOT']
    process.env['PSTACK_WORKTREE_ROOT'] = join(root, 'worktrees')
  })

  afterEach(async () => {
    if (previousRoot === undefined) delete process.env['PSTACK_WORKTREE_ROOT']
    else process.env['PSTACK_WORKTREE_ROOT'] = previousRoot
    await rm(root, { force: true, recursive: true })
  })

  it('creates one prepared worktree per issue and reuses it', async () => {
    const first = await prepareIssueWorkspace({
      cwd: source,
      issue: 'SPT-12',
      ownerSessionId: 'owner',
    })
    expect(first).toMatchObject({
      base: await git(source, 'rev-parse', 'HEAD'),
      branch: `pstack/${issueSlug('SPT-12')}`,
      issue: 'SPT-12',
      preparation: { dependencies: ['node_modules'], included: 1, setup: { status: 'passed' } },
      sourceRoot: source,
    })
    expect(first.worktree.startsWith(join(root, 'worktrees'))).toBe(true)
    expect(await git(first.worktree, 'branch', '--show-current')).toBe(first.branch)
    expect(await readFile(join(first.worktree, '.env'), 'utf8')).toBe('TOKEN=local\n')
    await expect(readFile(join(first.worktree, 'local.log'), 'utf8')).rejects.toThrow(/ENOENT/)
    expect(await readFile(join(first.worktree, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe(
      'export {}\n',
    )
    expect(await workspaceIsLive(first)).toBe(true)

    await writeFile(join(first.worktree, 'README.md'), 'changed\n')
    const second = await prepareIssueWorkspace({
      cwd: source,
      issue: 'SPT-12',
      ownerSessionId: 'owner',
    })
    expect(second.worktree).toBe(first.worktree)
    expect(await readFile(join(second.worktree, 'README.md'), 'utf8')).toBe('changed\n')
    expect(await readFile(join(source, 'setup-runs'), 'utf8')).toBe('SPT-12\nSPT-12\n')
  })

  it('reports a failed setup script without discarding the worktree', async () => {
    await writeFile(join(source, '.pstack', 'worktree-setup.sh'), 'echo broken >&2\nexit 3\n')
    await git(source, 'commit', '-q', '-am', 'break setup')
    const workspace = await prepareIssueWorkspace({
      cwd: source,
      issue: 'broken',
      ownerSessionId: 'owner',
    })
    expect(workspace.preparation.setup).toMatchObject({ exitCode: 3, status: 'failed' })
    const log = workspace.preparation.setup.log
    if (log === undefined) throw new Error('The setup log is missing.')
    expect(await readFile(log, 'utf8')).toBe('broken\n')
    expect(await workspaceIsLive(workspace)).toBe(true)
  })

  it('refuses to adopt a directory that is not a worktree of the source', async () => {
    const first = await prepareIssueWorkspace({
      cwd: source,
      issue: 'adopt',
      ownerSessionId: 'owner',
    })
    await git(source, 'worktree', 'remove', '--force', first.worktree)
    await mkdir(first.worktree, { recursive: true })
    expect(await workspaceIsLive(first)).toBe(false)
    await expect(
      prepareIssueWorkspace({ cwd: source, issue: 'adopt', ownerSessionId: 'owner' }),
    ).rejects.toThrow('is not a worktree of')
  })

  it('keeps simple issue IDs readable and disambiguates the rest', () => {
    expect(issueSlug('fix-login')).toBe('fix-login')
    expect(issueSlug('SPT-12')).toMatch(/^spt-12-[a-f0-9]{6}$/)
    expect(issueSlug('a/b')).not.toBe(issueSlug('a-b'))
  })
})
