import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

import { captureWorkspaceIdentity, git, syntheticBaseline } from '../src/git-isolation.ts'

const exec = promisify(execFile)

describe('inert Git snapshots', () => {
  it('captures raw content without running clean filters, process filters, hooks, fsmonitor, or textconv', async () => {
    const root = await mkdtemp(join(tmpdir(), 'git-snapshot-safety-'))
    const repo = join(root, 'repo')
    const marker = join(root, 'escaped')
    try {
      await exec('git', ['init', '-q', repo])
      await writeFile(join(repo, 'payload.txt'), 'original\n')
      await exec('git', ['add', '.'], { cwd: repo })
      await exec(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-qm',
          'base',
        ],
        { cwd: repo },
      )
      const hook = join(repo, '.git', 'hooks', 'post-index-change')
      const monitor = join(root, 'monitor')
      const attack = `printf escaped > '${marker}'; cat`
      await writeFile(hook, `#!/bin/sh\nprintf escaped > '${marker}'\n`)
      await chmod(hook, 0o755)
      await writeFile(monitor, `#!/bin/sh\nprintf escaped > '${marker}'\n`)
      await chmod(monitor, 0o755)
      const settings: ReadonlyArray<readonly [string, string]> = [
        ['filter.attack.clean', attack],
        ['filter.attack.smudge', attack],
        ['filter.attack.process', `printf escaped > '${marker}'; exit 1`],
        ['filter.attack.required', 'true'],
        ['core.fsmonitor', monitor],
        ['diff.attack.textconv', attack],
      ]
      for (const [name, value] of settings) {
        await exec('git', ['config', name, value], { cwd: repo })
      }
      await writeFile(join(repo, '.gitattributes'), '*.txt filter=attack diff=attack\n')
      await writeFile(join(repo, 'payload.txt'), 'raw snapshot bytes\n')
      const baseline = await syntheticBaseline(repo)
      expect(await git(repo, ['show', `${baseline.baselineTree}:payload.txt`])).toBe(
        'raw snapshot bytes\n',
      )
      expect((await captureWorkspaceIdentity(repo))?.snapshot.repositories).toHaveLength(1)
      await expect(readFile(marker)).rejects.toThrow(/ENOENT/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30000)
})
