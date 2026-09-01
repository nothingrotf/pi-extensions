import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { filterProjectSessions, pathsMatch } from '../src/scope.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('project scope', () => {
  it('uses canonical paths for symbolic links', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'session-history-scope-'))
    directories.push(directory)
    const project = join(directory, 'project')
    const link = join(directory, 'linked-project')
    await mkdir(project)
    await symlink(project, link)

    expect(await pathsMatch(project, link)).toBe(true)
    expect(await filterProjectSessions([{ cwd: link, id: 'visible' }], project)).toEqual([
      { cwd: link, id: 'visible' },
    ])
  })

  it('excludes sessions from another project', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'session-history-scope-'))
    directories.push(directory)
    const project = join(directory, 'project')
    const other = join(directory, 'other')
    await Promise.all([mkdir(project), mkdir(other)])

    expect(
      await filterProjectSessions(
        [
          { cwd: project, id: 'visible' },
          { cwd: other, id: 'hidden' },
        ],
        project,
      ),
    ).toEqual([{ cwd: project, id: 'visible' }])
  })
})
