import { execFile } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { devNull } from 'node:os'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)

export async function canonicalPath(path: string): Promise<string> {
  try {
    return normalize(await realpath(path))
  } catch {
    return normalize(resolve(path))
  }
}

async function canonicalWorkspacePath(path: string): Promise<string | null> {
  if (!isAbsolute(path) || path.split(sep).includes('..')) return null
  const absolute = resolve(path)
  let ancestor = absolute
  while (true) {
    try {
      return join(await realpath(ancestor), relative(ancestor, absolute))
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') return null
      const existing = await lstat(ancestor).catch(() => null)
      if (existing !== null) return null
      const parent = dirname(ancestor)
      if (parent === ancestor) return null
      ancestor = parent
    }
  }
}

async function managedWorktreeBoundary(cwd: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const result = await executeFile(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        timeout: 1_000,
        maxBuffer: 16 * 1024,
        signal,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          HOME: process.env.HOME,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: devNull,
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
    )
    const common = result.stdout.trim()
    if (!isAbsolute(common)) return null
    return join(await realpath(common), 'pi-subagent', 'worktrees')
  } catch {
    signal?.throwIfAborted()
    return null
  }
}

export async function filterManagedWorktreeSessions<Session extends { cwd: string }>(
  sessions: readonly Session[],
  cwd: string,
  signal?: AbortSignal,
): Promise<Session[]> {
  signal?.throwIfAborted()
  if (sessions.length === 0) return []
  const boundary = await managedWorktreeBoundary(cwd, signal)
  if (boundary === null) return []
  const visible: Session[] = []
  for (const session of sessions) {
    signal?.throwIfAborted()
    const canonical = await canonicalWorkspacePath(session.cwd)
    if (canonical === null) continue
    const parts = relative(boundary, canonical).split(sep)
    if (canonical.startsWith(`${boundary}${sep}`) && parts.length >= 2 && parts[1] === 'root') {
      visible.push(session)
    }
  }
  return visible
}

export async function pathsMatch(left: string, right: string): Promise<boolean> {
  const [canonicalLeft, canonicalRight] = await Promise.all([
    canonicalPath(left),
    canonicalPath(right),
  ])
  return canonicalLeft === canonicalRight
}

export async function filterProjectSessions<Session extends { cwd: string }>(
  sessions: readonly Session[],
  cwd: string,
): Promise<Session[]> {
  const visible: Session[] = []
  const project = await canonicalPath(cwd)
  const canonicalPaths = new Map<string, string>([[cwd, project]])
  for (const session of sessions) {
    let canonical = canonicalPaths.get(session.cwd)
    if (canonical === undefined) {
      canonical = await canonicalPath(session.cwd)
      canonicalPaths.set(session.cwd, canonical)
    }
    if (canonical === project) {
      visible.push(session)
    }
  }
  return visible
}
