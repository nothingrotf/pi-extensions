import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

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
  it('preserves exact exceptions across agent and inline skill', () => {
    const agent = read('../agents/comment-sicko.md')
    const skill = read('../skills/no-comments/SKILL.md')
    for (const exception of exceptions) {
      expect(agent).toContain(exception)
      expect(skill).toContain(exception)
    }
  })

  it('supports leaf inline review without recursive delegation', () => {
    const agent = read('../agents/comment-sicko.md')
    const skill = read('../skills/no-comments/SKILL.md')
    expect(skill).toContain('including a leaf reviewer, perform the rubric inline')
    expect(skill).toContain('Do not spawn another Task or invoke `/how`, `/why`, or `/architect`')
    expect(agent).toContain('Trace direct scoped evidence before judging the claim')
    expect(agent).toContain('return a precise blocker to the root coordinator')
    expect(agent).toContain("Respect the caller's scope and permissions")
  })

  it('selects one report-only code reviewer without pool fanout', () => {
    const skill = read('../skills/no-comments/SKILL.md')
    expect(skill).toContain('launch exactly one independent reviewer')
    expect(skill).toContain('`role`: `arena cross-judge pool`')
    expect(skill).toContain('`readonly`: `true`')
    expect(skill).toContain('The pool is availability, not fanout')
    expect(skill).toContain('Consolidation never authorizes the reviewer to edit product files')
    expect(skill).toContain(
      'During accepted delivery or publication, reuse the existing independent verdict',
    )
    expect(read('../skills/deslop/SKILL.md')).toContain(
      'report findings without edits or another Task',
    )
  })
})

describe('setup pstack role guidance', () => {
  it('announces discarded known legacy roles without treating unknown roles as compatible', () => {
    const skill = read('../skills/setup-pstack/SKILL.md')
    expect(skill).toContain('`how critics` is a known legacy role')
    expect(skill).toContain('accepts its valid configuration but ignores its selectors')
    expect(skill).toContain('list each known legacy row that the rewrite will remove')
    expect(skill).toContain('Unknown roles remain errors')
    expect(skill).toContain('resolve them with the operator before confirmation or rewriting')
    expect(skill).toContain('Preserve the choices of active roles')
  })

  it('keeps managed-delivery roles out of the default setup file', () => {
    const skill = read('../skills/setup-pstack/SKILL.md')
    const example = skill.match(/```text\n(---[\s\S]*?)\n```/)?.[1] ?? ''
    expect(example).toContain('arena cross-judge pool: inherit-parent')
    expect(example).toContain('swarm workers: inherit-parent')
    for (const role of ['code review', 'runtime verification', 'publication'])
      expect(example).not.toContain(`${role}:`)
    expect(skill).toContain('are managed-delivery roles')
    expect(skill).toContain('so this skill does not write them')
    expect(skill).toContain('Preserve existing lines for these roles on a rerun')
    expect(skill).toContain('Every list is an availability pool')
    expect(skill).toContain('List length never causes fanout')
    expect(skill).toContain('`judgment and prose` is only for prose or evidence synthesis')
    expect(skill).toContain('Markdown comments (`<!-- ... -->`) are ignored')
  })
})
