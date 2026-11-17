import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'interrogate')

function skill() {
  return readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
}

describe('interrogate', () => {
  it('keeps only findings that a rerun proves', () => {
    const source = skill()
    expect(source).toContain('A finding survives only when a run proves it.')
    expect(source).toContain('Prove each finding with a run against the real code')
    expect(source).toContain('by rerunning its command')
    expect(source).toContain('Skip arena Phases C, D, and E.')
    expect(source).toContain('Do not apply fixes.')
    expect(existsSync(join(skillRoot, 'references'))).toBe(false)
  })

  it('runs one adversary per configured reviewer entry', () => {
    const source = skill()
    expect(source).toContain('parsed `interrogate reviewers` runtime policy')
    expect(source).toContain('One adversary runs per entry')
    expect(source).toContain('passes its entry as `Task.model`')
    expect(source).not.toMatch(/~\/\.cursor|grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })

  it('runs each adversary as a manual-isolation verifier', () => {
    const source = skill()
    expect(source).toContain('`role: "interrogate reviewers"`')
    expect(source).toContain('`capability_profile: "pstack-leaf"`')
    expect(source).toContain('`readonly: false`')
    expect(source).toContain('`isolation: { mode: "worktree", integration: "manual" }`')
    expect(source).toContain('Never join its incidental patch.')
  })
})
