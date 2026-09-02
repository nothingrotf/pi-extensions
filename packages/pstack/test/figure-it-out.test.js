import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'figure-it-out', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('figure-it-out', () => {
  it('uses Pi todo and the complete Poteto contract', () => {
    const port = skill()
    expect(port).toContain('name: figure-it-out')
    expect(port).toContain('disable-model-invocation: true')
    expect(port).toContain('Use `todo_write`')
    expect(port).toContain('full **poteto-mode** skill')
    expect(port).not.toMatch(/todolist|~\/\.cursor|cloud worker/)
  })

  it('preserves workflow and principle dependencies', () => {
    const port = skill()
    for (const name of [
      'architect',
      'arena',
      'show-me-your-work',
      'prove-it-works',
      'never-block-on-the-human',
      'foundational-thinking',
      'laziness-protocol',
      'separate-before-serializing-shared-state',
      'sequence-verifiable-units',
      'encode-lessons-in-structure',
    ])
      expect(port).toContain(name)
  })

  it('requires isolated work and an honest judge', () => {
    const port = skill()
    expect(port).toContain('its own worktree or branch')
    expect(port).toContain('read-only judge on a verified different model family')
    expect(port).toContain('return `BLOCKED`')
    expect(port).toContain('Do not substitute a model.')
  })

  it('ships all direct sibling skills', () => {
    for (const name of ['poteto-mode', 'architect', 'arena', 'show-me-your-work'])
      expect(existsSync(join(packageRoot, 'skills', name, 'SKILL.md'))).toBe(true)
  })
})
