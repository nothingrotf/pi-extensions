import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillRoot = join(packageRoot, 'skills', 'how')

function text(path) {
  return readFileSync(path, 'utf8')
}

describe('how', () => {
  it('ships the critic prompt and rubric', () => {
    expect(text(join(skillRoot, 'references', 'critic-prompt.md'))).toContain(
      '# Critic Prompt Template',
    )
    expect(text(join(skillRoot, 'references', 'critique-rubric.md'))).toContain(
      '# Architectural Critique Rubric',
    )
  })

  it('uses Pi tools and Task model selectors', () => {
    const port = [
      text(join(skillRoot, 'SKILL.md')),
      text(join(skillRoot, 'references', 'explorer-prompt.md')),
      text(join(skillRoot, 'references', 'explainer-prompt.md')),
    ].join('\n')
    expect(port).toContain('provider/model-id:effort [fast]')
    expect(port).toContain('`find`')
    expect(port).toContain('`grep`')
    expect(port).toContain('`read`')
    expect(port).not.toMatch(/grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
    expect(port).not.toContain('Use Glob')
    expect(port).not.toContain('Use Read, Grep, and Glob')
  })

  it('keeps inherited model aliases outside concrete selectors', () => {
    const setup = text(join(packageRoot, 'skills', 'setup-pstack', 'SKILL.md'))
    expect(setup).toContain('provider/model-id:effort [fast]')
    expect(setup).toContain('how explorer: inherit-parent')
    expect(setup).toContain(
      'how critics: inherit-parent, inherit-parent, inherit-parent, inherit-parent',
    )
    expect(setup).toContain('omit the `Task` `model` field')
    expect(setup).not.toMatch(/grok-4\.6|gpt-5\.6|claude-fable|claude-opus-5/)
  })
})
