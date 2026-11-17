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
  it('uses Pi model configuration without Cursor cloud workers', () => {
    const port = skill()
    expect(port).toContain('parsed `swarm workers` runtime policy')
    expect(port).toContain('When the role has one selector or is absent, omit `model`.')
    expect(port).not.toMatch(/~\/\.cursor|claude-opus-5|environment:|cloud_base_branch/)
  })

  it('uses parallel local Tasks and isolated writers', () => {
    const port = skill()
    expect(port).toContain('Use `todo_write`')
    expect(port).toContain('`subagent_type: "generalPurpose"`')
    expect(port).toContain('`role: "swarm workers"`')
    expect(port).toContain('`run_in_background: true`')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('`isolation: { mode: "worktree", integration: "branch" }`')
    expect(port).toContain('`isolation: { mode: "worktree", integration: "manual" }`')
  })

  it('binds verification and measurement briefs to exact SHAs and method', () => {
    const port = skill()
    expect(port).toContain('each brief names the exact SHAs')
    expect(port).toContain('sample count, what one sample is, order')
    expect(port).toContain('Drop a result that does not record the SHAs and method its brief names')
    expect(port).toContain('A gap does not count as a pass.')
  })

  it('keeps every proven issue and forbids em dashes', () => {
    const port = skill()
    expect(port).toContain('lists every issue it can prove, not only the first')
    expect(port).not.toContain('\u2014')
  })
})
