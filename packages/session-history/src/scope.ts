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
  for (const session of sessions) {
    if (await pathsMatch(session.cwd, cwd)) {
      visible.push(session)
    }
  }
  return visible
}
