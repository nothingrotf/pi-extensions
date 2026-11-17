import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))

function text(...path) {
  return readFileSync(join(packageRoot, 'skills', ...path), 'utf8')
}

describe('how', () => {
  it('dispatches one read-only explainer through an active policy role', () => {
    const skill = text('how', 'SKILL.md')
    expect(skill).toContain('`role: "judgment and prose"`')
    expect(skill).toContain('`capability_profile: "pstack-leaf"`')
    expect(skill).toContain('`readonly: true`')
    expect(skill).toContain('without `Task` access, explore and write the explanation yourself')
    expect(skill).not.toMatch(/how explorer|how explainer|claude-fable|claude-opus-5/)
  })

  it('writes only active roles in the setup example', () => {
    const setup = text('setup-pstack', 'SKILL.md')
    const policy = setup.match(/```text\n([\s\S]*?)\n```/)?.[1]
    expect(policy).toContain('swarm workers: inherit-parent')
    expect(policy).not.toMatch(
      /how critics|how explorer|why synthesizer|reflect|architect runners|hardest tasks/,
    )
    expect(setup).toContain('Scalar dispatches can omit `Task.model`')
  })
})
