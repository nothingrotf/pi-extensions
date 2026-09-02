import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'interrogate')

function text(path) {
  return readFileSync(path, 'utf8')
}

describe('interrogate', () => {
  it('ships complete reviewer guidance', () => {
    expect(text(join(skillRoot, 'references', 'code-quality-review.md'))).toContain(
      '# Code Quality Review',
    )
    expect(text(join(skillRoot, 'references', 'lead-judgment.md'))).toContain('# Lead Judgment')
    expect(text(join(skillRoot, 'references', 'reviewer-prompt.md'))).toContain(
      '# Reviewer Prompt Template',
    )
  })

  it('uses exact Task selectors and inherited fallbacks', () => {
    const skill = text(join(skillRoot, 'SKILL.md'))
    expect(skill).toContain('provider/model-id:effort [fast]')
    expect(skill).toContain('~/.agents/rules/pstack-models.md')
    expect(skill.match(/\| Reviewer [A-D] \| `inherit-parent` \|/g)).toHaveLength(4)
    expect(skill).toContain('Omit it for an absent, `auto`, or `inherit-parent` value')
    expect(skill).toContain('mark that reviewer `BLOCKED`')
    expect(skill).not.toMatch(/~\/\.cursor|grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })

  it('uses Pi read-only review tools', () => {
    const skill = text(join(skillRoot, 'SKILL.md'))
    const rubric = text(join(skillRoot, 'references', 'rubric.md'))
    expect(skill).toContain('- `readonly`: `true`')
    expect(rubric).toContain('`read`, `grep`, and `find`')
    expect(rubric).not.toContain('(Read, Grep, Glob)')
  })
})
