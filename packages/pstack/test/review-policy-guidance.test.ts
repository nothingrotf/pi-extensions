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
    expect(skill).toContain('`role`: `code review`')
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
  it('documents new pools, scalar role, and compatibility fallback', () => {
    const skill = read('../skills/setup-pstack/SKILL.md')
    expect(skill).toContain('code review: inherit-parent')
    expect(skill).toContain('runtime verification: inherit-parent')
    expect(skill).toContain('publication: inherit-parent')
    expect(skill).toContain('Every list is an availability pool')
    expect(skill).toContain('List length never causes fanout')
    expect(skill).toContain('`runtime verification` selects one verifier by the required family')
    expect(skill).toContain('`judgment and prose` is only for prose or evidence synthesis')
    expect(skill).toContain('derives its pool from `arena cross-judge pool`')
    expect(skill).toContain('derives its scalar selector from `judgment and prose`')
    expect(skill).toContain('An explicit new-role entry always overrides its derived fallback')
    expect(skill).toContain('Before adding new role names, reload older Pi sessions')
    expect(skill).toContain('prepare the new policy separately and keep the legacy file active')
  })
})
