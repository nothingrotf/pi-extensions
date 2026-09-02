import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'swarm', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('swarm', () => {
  it('uses Pi model configuration without substitution', () => {
    const port = skill()
    expect(port).toContain('~/.agents/rules/pstack-models.md')
    expect(port).toContain('provider/model-id:effort [fast]')
    expect(port).toContain('Omit `Task.model` for `auto` or `inherit-parent`')
    expect(port).toContain('mark that arm `BLOCKED`')
    expect(port).toContain('Do not substitute a model.')
    expect(port).not.toMatch(/~\/\.cursor|grok-4\.6|environment:|cloud_base_branch/)
  })

  it('uses parallel local Tasks and isolated writers', () => {
    const port = skill()
    expect(port).toContain('Use `todo_write`')
    expect(port).toContain('`subagent_type: "generalPurpose"`')
    expect(port).toContain('`run_in_background: true`')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('`isolation: { mode: "worktree", integration: "branch" }`')
    expect(port).toContain('Native `Task` notifications report completion.')
    expect(port).toContain('Do not poll.')
  })

  it('requires structured evidence and bounded inspection', () => {
    const port = skill()
    expect(port).toContain('`outputSchema`')
    expect(port).toContain('`schemaMode: "strict"`')
    expect(port).toContain('`TaskControl` `status`')
    expect(port).toContain('artifacts, gates, and isolation receipt')
    expect(port).toContain('proceed with N-1')
  })
})
