import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'automate-me', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('automate-me', () => {
  it('mines bounded Pi session evidence', () => {
    const port = skill()
    for (const value of ['session_history', '`list`', '`search`', '`read`', 'pi-session://'])
      expect(port).toContain(value)
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('A `Task` child has no `session_history`')
  })

  it('uses Pi questions and skill locations', () => {
    const port = skill()
    expect(port).toContain('`AskQuestion`')
    expect(port).toContain('`allowMultiple: true`')
    expect(port).toContain('`.pi/skills/**/*-mode/SKILL.md`')
    expect(port).toContain('`~/.agents/skills/*-mode/SKILL.md`')
    expect(port).not.toMatch(/\.cursor\/skills|~\/\.cursor|agent-transcripts/)
  })

  it('uses bundled authoring and safe landing contracts', () => {
    const port = skill()
    expect(port).toContain('bundled `create-skill` skill')
    expect(port).toContain('**unslop**')
    expect(port).toContain('Work in a worktree off main.')
    expect(port).toContain("Don't push to main directly.")
  })
})
