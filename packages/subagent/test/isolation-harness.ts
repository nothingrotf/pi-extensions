import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { commonDirectory, repositoryRoot } from '../src/git-isolation.ts'
import { createIsolation, type IsolationDestination } from '../src/isolation.ts'
import { createRootWorkspaceContext } from '../src/workspace.ts'

export const execFileAsync = promisify(execFile)

export async function command(cwd: string, args: readonly string[]): Promise<string> {
  const executable = args[0]
  if (executable === undefined) throw new Error('The command is empty.')
  const result = await execFileAsync(executable, args.slice(1), { cwd })
  return result.stdout
}

export async function repository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'subagent-isolation-test-'))
  await command(directory, ['git', 'init', '-q', '-b', 'main'])
  await command(directory, ['git', 'config', 'user.name', 'Test User'])
  await command(directory, ['git', 'config', 'user.email', 'test@example.com'])
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n', 'utf8')
  await writeFile(join(directory, 'tracked.txt'), 'base\n', 'utf8')
  await command(directory, ['git', 'add', '.gitignore', 'tracked.txt'])
  await command(directory, ['git', 'commit', '-q', '-m', 'base'])
  return directory
}

export interface Harness {
  context: Awaited<ReturnType<typeof createRootWorkspaceContext>>
  destination: IsolationDestination
}

export async function harness(cwd: string): Promise<Harness> {
  const context = await createRootWorkspaceContext(cwd, 'scope-test')
  const repoRoot = (await repositoryRoot(context.physicalRoot)) ?? context.physicalRoot
  return {
    context,
    destination: {
      destinationPhysicalRoot: context.physicalRoot,
      destinationWorkspaceId: context.workspaceId,
      durableCommonDir: await commonDirectory(repoRoot),
    },
  }
}

export async function writer(cwd: string, writerId: string, relativeCwd = '') {
  const environment = await harness(cwd)
  return createIsolation({
    destination: environment.destination,
    integration: 'apply',
    parent: environment.context,
    relativeCwd,
    spawnOrdinal: 1,
    writerId,
  })
}
