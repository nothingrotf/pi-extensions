import { realpath } from 'node:fs/promises'
import { normalize, resolve } from 'node:path'

export async function canonicalPath(path: string): Promise<string> {
  try {
    return normalize(await realpath(path))
  } catch {
    return normalize(resolve(path))
  }
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
