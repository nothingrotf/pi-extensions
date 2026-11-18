import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import { git } from '../src/git-isolation.ts'

describe('isolation Git subprocesses', () => {
  it.each(['stdout', 'stderr'])('rejects oversized %s and leaves Git usable', async (stream) => {
    const repo = await mkdtemp(join(tmpdir(), 'subagent-git-output-'))
    try {
      await git(repo, ['init', '-q'])
      const redirect = stream === 'stderr' ? '1>&2 2>/dev/null' : '2>/dev/null'
      const alias = `alias.large-output=!exec dd if=/dev/zero bs=1048576 count=65 ${redirect}`
      await expect(git(repo, ['-c', alias, 'large-output'])).rejects.toMatchObject({
        code: 'PROCESS_OUTPUT_LIMIT',
      })
      await expect(git(repo, ['rev-parse', '--is-inside-work-tree'])).resolves.toBe('true\n')
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})
