import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { mirrorAgentDirectory, pinnedPackage } from './revisions.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('revision agent directories', () => {
  it('points packages from the source checkout at the pinned revision', () => {
    const agent = '/home/user/.pi/agent'
    const source = '/home/user/Workspaces/pi-extensions'
    const pinned = '/tmp/bench/revisions/base'
    expect(
      pinnedPackage('../../Workspaces/pi-extensions/packages/pstack', agent, source, pinned),
    ).toBe('/tmp/bench/revisions/base/packages/pstack')
    expect(pinnedPackage('npm:pi-web-access', agent, source, pinned)).toBe('npm:pi-web-access')
    expect(pinnedPackage('../../Workspaces/other/packages/x', agent, source, pinned)).toBe(
      '/home/user/Workspaces/other/packages/x',
    )
  })

  it('links every agent file except settings and sessions, and rewrites settings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bench-revisions-'))
    roots.push(root)
    const agent = join(root, 'home', '.pi', 'agent')
    const source = join(root, 'home', 'Workspaces', 'pi-extensions')
    await mkdir(join(agent, 'sessions'), { recursive: true })
    await writeFile(join(agent, 'auth.json'), '{}\n')
    await writeFile(
      join(agent, 'settings.json'),
      JSON.stringify({
        packages: [
          '../../Workspaces/pi-extensions/packages/pstack',
          { source: '../../Workspaces/pi-extensions/packages/todo', extensions: [] },
          'npm:pi-web-access',
        ],
        theme: 'dark',
      }),
    )
    const target = join(root, 'mirror')
    await mirrorAgentDirectory({
      agentDir: agent,
      revisionRoot: join(root, 'pinned'),
      sourceRoot: source,
      target,
    })
    expect((await lstat(join(target, 'auth.json'))).isSymbolicLink()).toBe(true)
    expect(await readlink(join(target, 'auth.json'))).toBe(join(agent, 'auth.json'))
    await expect(lstat(join(target, 'sessions'))).rejects.toThrow(/ENOENT/)
    expect(JSON.parse(await readFile(join(target, 'settings.json'), 'utf8'))).toEqual({
      packages: [
        join(root, 'pinned', 'packages', 'pstack'),
        { source: join(root, 'pinned', 'packages', 'todo'), extensions: [] },
        'npm:pi-web-access',
      ],
      theme: 'dark',
    })
  })
})
