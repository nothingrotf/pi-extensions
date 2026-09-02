import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'arena', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('arena', () => {
  it('uses Pi model configuration and inherited fallbacks', () => {
    const port = skill()
    expect(port).toContain('~/.agents/rules/pstack-models.md')
    expect(port).toContain('provider/model-id:effort [fast]')
    expect(port).toContain('use four inherited runners')
    expect(port).toContain('Omit `Task.model` for `auto` or `inherit-parent`')
    expect(port).not.toMatch(/~\/\.cursor|grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })

  it('isolates writers through Task worktrees', () => {
    const port = skill()
    expect(port).toContain('`isolation: { mode: "worktree", integration: "branch" }`')
    expect(port).toContain('`run_in_background: true`')
    expect(port).toContain('Native `Task` notifications report completion.')
    expect(port).toContain('retained `Task` branches or patches')
  })

  it('uses todo and an honest judge fallback', () => {
    const port = skill()
    expect(port).toContain('Use `todo_write`')
    expect(port).toContain('mark the judge `BLOCKED`')
    expect(port).toContain('Do not substitute a model.')
  })
})
