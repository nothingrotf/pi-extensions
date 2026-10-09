import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import {
  captureWorkspaceIdentity,
  commonDirectory,
  git,
  repositoryRoot,
  writePatchArtifact,
} from './git-isolation.ts'
import type { InPlaceReceipt, WorkspaceIdentity } from './schema.ts'
import { currentLockOwner, digest, errorMessage, tryAcquireLock } from './workspace.ts'

export interface InPlaceLease {
  release: () => Promise<void>
  worktree: string
}

export async function linkedWorktreeRoot(cwd: string): Promise<string> {
  const root = await repositoryRoot(cwd)
  if (root === undefined) {
    throw new Error(`In-place execution requires a Git worktree, but ${cwd} is not in one.`)
  }
  const gitDir = await realpath(
    (await git(root, ['rev-parse', '--path-format=absolute', '--git-dir'])).trim(),
  )
  if (gitDir === (await commonDirectory(root))) {
    throw new Error(
      `In-place execution requires a linked Git worktree, but ${root} is a primary checkout. Create one with git worktree add, or request isolation mode "worktree".`,
    )
  }
  return root
}

export async function acquireInPlaceLease(cwd: string, writerId: string): Promise<InPlaceLease> {
  const worktree = await linkedWorktreeRoot(cwd)
  const lockRoot = join(await commonDirectory(worktree), 'pi-subagent', 'locks')
  const owner = await currentLockOwner(writerId, randomUUID())
  const result = await tryAcquireLock(
    join(lockRoot, `in-place-${digest(worktree)}`),
    owner,
    join(lockRoot, 'recovery'),
  )
  if (result.kind === 'held') {
    throw new Error(
      `The worktree ${worktree} is leased by in-place writer ${result.holder.writerId}. Wait for that Task to settle before dispatching another in-place Task there.`,
    )
  }
  return { release: result.lock.release, worktree }
}

async function headOf(root: string): Promise<string | undefined> {
  try {
    const head = (await git(root, ['rev-parse', 'HEAD'])).trim()
    return /^[0-9a-f]{40,64}$/.test(head) ? head : undefined
  } catch {
    return undefined
  }
}

export async function captureInPlaceReceipt(
  worktree: string,
  start: WorkspaceIdentity,
): Promise<InPlaceReceipt> {
  const capturedAt = Date.now()
  try {
    const end = await captureWorkspaceIdentity(worktree)
    if (end === undefined) throw new Error(`The worktree ${worktree} is no longer a repository.`)
    const startPaths = start.snapshot.repositories.map((entry) => entry.relativePath).sort()
    const endPaths = end.snapshot.repositories.map((entry) => entry.relativePath).sort()
    if (JSON.stringify(startPaths) !== JSON.stringify(endPaths)) {
      throw new Error('The in-place run added, removed, or moved a repository boundary.')
    }
    const artifactRoot = join(
      await commonDirectory(worktree),
      'pi-subagent',
      'artifacts',
      'in-place',
    )
    const repositories = await Promise.all(
      end.snapshot.repositories.map(async (result) => {
        const base = start.snapshot.repositories.find(
          (entry) => entry.relativePath === result.relativePath,
        )
        if (base === undefined) throw new Error('The in-place baseline repository is missing.')
        const patch = await git(result.root, [
          'diff',
          '--binary',
          '--full-index',
          base.tree,
          result.tree,
        ])
        const entry: InPlaceReceipt['repositories'][number] = {
          baseTree: base.tree,
          patch: await writePatchArtifact({
            artifactRoot,
            name: `in-place-${digest(`${base.tree}:${result.tree}:${patch}`)}`,
            patch,
          }),
          relativePath: result.relativePath,
          resultTree: result.tree,
          root: result.root,
        }
        const head = await headOf(result.root)
        if (head !== undefined) entry.head = head
        return entry
      }),
    )
    return { capturedAt, repositories, status: 'captured', worktree }
  } catch (error) {
    return { capturedAt, error: errorMessage(error), repositories: [], status: 'failed', worktree }
  }
}
