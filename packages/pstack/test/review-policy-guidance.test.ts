import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

import { selectCapabilityModel } from '../../subagent/src/capabilities.ts'
import { parsePstackModelPolicy } from '../src/model-policy.ts'

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const exceptions = [
  'Legal or license headers.',
  'Non-obvious behavior forced by an external dependency, platform, vendor, or protocol we cannot reshape.',
  '`// prettier-ignore`. Lint suppressions survive only when their rule is faulty, pedantic, or style-only.',
  'Doc comments that define a public API contract.',
  'Issue or RFC links that explain a constraint code cannot express.',
]

describe('Comment Sicko review guidance', () => {
  it('keeps the exact exception list in the agent', () => {
    const agent = read('../agents/comment-sicko.md')
    for (const exception of exceptions) expect(agent).toContain(exception)
    expect(agent).toContain('run `/why` from the **why** skill on it')
    expect(agent).toContain('I never write application code.')
  })

  it('spawns one isolated Comment Sicko and joins only an accepted diff', () => {
    const skill = read('../skills/no-comments/SKILL.md')
    expect(skill).toContain('`subagent_type: "comment-sicko"`')
    expect(skill).toContain('`isolation: { mode: "worktree", integration: "apply" }`')
    expect(skill).toContain('Call `TaskControl` with `action: "join"` only for an accepted diff')
    expect(skill).toContain('Do not restate its rules.')
  })
})

describe('setup pstack role guidance', () => {
  it('announces discarded known legacy roles without treating unknown roles as compatible', () => {
    const skill = read('../skills/setup-pstack/SKILL.md')
    for (const role of [
      'hardest tasks',
      'how explorer',
      'how explainer',
      'why investigators',
      'why synthesizer',
      'reflect tooling',
      'reflect judgment',
      'reflect divergent',
      'reflect synthesizer',
      'architect runners',
      'how critics',
      'code review',
      'runtime verification',
      'publication',
    ]) {
      expect(skill).toContain(`\`${role}\``)
      expect(() =>
        selectCapabilityModel([parsePstackModelPolicy(`${role}: auto`)], role, undefined),
      ).toThrow('Unknown model policy role')
    }
    expect(skill).toContain('accepts their valid configuration but ignores their selectors')
    expect(skill).toContain('list each retired row that the rewrite will remove')
    expect(skill).toContain('Unknown roles remain errors')
    expect(skill).toContain('resolve them with the operator before confirmation or rewriting')
    expect(skill).toContain('Preserve the choices of active roles')
  })

  it('keeps legacy roles out of the default setup file', () => {
    const skill = read('../skills/setup-pstack/SKILL.md')
    const example = skill.match(/```text\n(---[\s\S]*?)\n```/)?.[1] ?? ''
    expect(example).toContain('arena cross-judge pool: inherit-parent')
    expect(example).toContain('swarm workers: inherit-parent')
    for (const role of ['code review', 'hardest tasks', 'how explorer', 'architect runners'])
      expect(example).not.toContain(`${role}:`)
    expect(skill).toContain('so the list length sets the fan-out')
    expect(skill).toContain('`judgment and prose` is only for prose or evidence synthesis')
    expect(skill).toContain('Markdown comments (`<!-- ... -->`) are ignored')
  })
})
