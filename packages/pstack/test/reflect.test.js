import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

describe('reflect', () => {
  it('recovers Pi transcripts and edits only local skill copies', () => {
    const skill = readFileSync(join(packageRoot, 'skills', 'reflect', 'SKILL.md'), 'utf8')
    expect(skill).toContain('`compact_recall`')
    expect(skill).toContain('`session_history`')
    expect(skill).toContain('`~/.pi/agent/npm/`')
    expect(skill).toContain('`.agents/skills/<skill>/` or `~/.agents/skills/<skill>/`')
    expect(skill).toContain('wait for approval before editing any skill')
    expect(skill).not.toMatch(/plugins\/cache|\.cursor\/|reflect tooling|reflect judgment/)
  })
})
