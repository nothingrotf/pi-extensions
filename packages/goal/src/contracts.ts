import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { GoalContract } from './review-prompt.ts'

const contractPaths = ['GOAL.md', 'ACCEPTANCE.md', '.pi/GOAL.md', '.pi/ACCEPTANCE.md']

export function isUnderSpecifiedGoal(goal: string): boolean {
  const normalized = goal.trim().toLowerCase()
  if (normalized.length < 12) return true
  if (
    /[`/\\]|\.[a-z0-9]{1,8}\b|\b(?:api|cli|tui|desktop|headless|provider|model|auth|database|component|function|class|test)\b/.test(
      normalized,
    )
  ) {
    return false
  }
  const anaphoric =
    /\b(?:it|this|that|everything|all|isso|isto|aquilo|tudo|ele|ela|esse|essa|este|esta)\b/.test(
      normalized,
    )
  const terse =
    /^(?:implement|finish|fix|build|complete|do|ship|make|implemente|finalize|termine|corrija|melhore|refatore)(?:\s+[\p{L}\p{N}]+){0,6}$/iu.test(
      normalized,
    )
  return anaphoric || terse || normalized.length < 32
}

export async function loadGoalContract(
  cwd: string,
  objective: string,
): Promise<GoalContract | undefined> {
  if (!isUnderSpecifiedGoal(objective)) return undefined
  for (const relativePath of contractPaths) {
    try {
      const path = join(cwd, relativePath)
      if (!(await stat(path)).isFile()) continue
      const file = await open(path, 'r')
      let content: string
      try {
        const buffer = Buffer.alloc(16_000)
        const result = await file.read(buffer)
        content = buffer.subarray(0, result.bytesRead).toString('utf8').trim()
      } finally {
        await file.close()
      }
      if (content.length > 0) {
        return { path: relativePath, content: content.slice(0, 16_000) }
      }
    } catch {}
  }
  return undefined
}
