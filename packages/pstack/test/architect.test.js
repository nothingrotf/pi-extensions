import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'architect')

function text(path) {
  return readFileSync(path, 'utf8')
}

describe('architect', () => {
  it('ships complete design references', () => {
    expect(text(join(skillRoot, 'references', 'design-red-flags.md'))).toContain(
      '# Design red flags',
    )
    expect(text(join(skillRoot, 'references', 'rationale-template.md'))).toContain(
      '# Rationale template',
    )
  })

  it('uses the ported model and todo contracts', () => {
    const skill = text(join(skillRoot, 'SKILL.md'))
    expect(skill).toContain('Use `todo_write`')
    expect(skill).toContain('~/.agents/rules/pstack-models.md')
    expect(skill).toContain('provider/model-id:effort [fast]')
    expect(skill).toContain('Omit `Task.model` for `auto` or `inherit-parent`')
    expect(skill).toContain('use four inherited runners')
    expect(skill).not.toMatch(/~\/\.cursor|grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })

  it('uses isolated runners without generated code comments', () => {
    const prompt = text(join(skillRoot, 'references', 'runner-prompt.md'))
    expect(prompt).toContain('managed `Task` worktree')
    expect(prompt).toContain('separate pseudocode blocks')
    expect(prompt).toContain('independently configured runners')
    expect(prompt).not.toContain('// TODO')
    expect(prompt).not.toContain('doc comments')
  })
})
