import { describe, expect, test } from 'vite-plus/test'

import { parsePorcelain, readGitStatus } from '../src/git.ts'

describe('Git status', () => {
  test('parses branch state and every working tree counter', () => {
    const status = parsePorcelain(
      [
        '# branch.head feature/hud',
        '# branch.ab +2 -1',
        '1 M. N... 100644 100644 100644 a b staged.ts',
        '1 .M N... 100644 100644 100644 a b modified.ts',
        '1 A. N... 000000 100644 100644 a b added.ts',
        '1 .D N... 100644 100644 000000 a b deleted.ts',
        '2 R. N... 100644 100644 100644 a b R100 renamed.ts\toriginal.ts',
        '? untracked.ts',
        'u UU N... 100644 100644 100644 100644 a b c conflict.ts',
      ].join('\n'),
    )

    expect(status).toEqual({
      branch: 'feature/hud',
      dirty: true,
      ahead: 2,
      behind: 1,
      staged: 3,
      modified: 2,
      added: 1,
      deleted: 1,
      renamed: 1,
      copied: 0,
      untracked: 1,
      conflicted: 1,
    })
  })

  test('returns a clean detached status without a branch label', () => {
    const status = parsePorcelain('# branch.head (detached)\n')
    expect(status.branch).toBeUndefined()
    expect(status.dirty).toBe(false)
  })

  test('stops a Git read when its session signal aborts', async () => {
    const controller = new AbortController()
    controller.abort()
    const status = await readGitStatus(process.cwd(), controller.signal)
    expect(status.branch).toBeUndefined()
    expect(status.dirty).toBe(false)
  })
})
