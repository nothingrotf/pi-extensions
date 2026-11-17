import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

function skill(path: string): string {
  return readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8')
}

describe('standalone pstack worker contracts', () => {
  it.each([
    ['recall', 'judgment and prose'],
    ['automate-me', 'judgment and prose'],
    ['maintain-verification-skill', 'judgment and prose'],
    ['show-me-your-work', 'arena cross-judge pool'],
  ])('%s supplies planning capabilities and its scoped role', (name, role) => {
    const source = skill(`${name}/SKILL.md`)
    expect(source).toContain('capability_profile: "pstack-leaf"')
    expect(source).toContain(`role: "${role}"`)
    expect(source).toContain('subagent_type: "generalPurpose"')
  })

  it('keeps autonomous wakeups in the actual loop session', () => {
    const source = skill('poteto-mode/playbooks/autonomous-run.md')
    expect(source).toContain('loop_next')
    expect(source).toContain('watch.command')
    expect(source).not.toContain('watcher subagent')
  })

  it.each(['autopilot-full', 'autopilot-stack'] as const)(
    '%s follows the upstream owner-published flow',
    (name) => {
      const playbook = skill(`poteto-mode/playbooks/${name}.md`)
      expect(playbook).not.toContain('managed')
      expect(playbook).not.toContain('pstack_deliver')
      expect(playbook).not.toContain('role: "publication"')
      expect(playbook).not.toContain('draft')
    },
  )

  it('runs autopilot-stack as autopilot-full without the merge', () => {
    const stack = skill('poteto-mode/playbooks/autopilot-stack.md')
    expect(stack).toContain('Run the Autopilot-full playbook, but do not merge.')
    expect(stack).toContain('Stack a PR only when it builds on another PR.')
    expect(stack).toContain('nobody pushes without the operator')
    const full = skill('poteto-mode/playbooks/autopilot-full.md')
    expect(full).toContain('Block a PR only for a problem you can show')
    expect(full).toContain('a wording-only change gets none')
  })

  it('restates the goal first and decides before measuring', () => {
    const mode = skill('poteto-mode/SKILL.md')
    expect(mode).toContain("First message → restate the user's goal")
    expect(mode).toContain('PR `## Summary`')
    expect(mode).toContain('Run a resume with `run_in_background: true` too')
    expect(skill('principle-explain-the-number/SKILL.md')).toContain(
      'Write the decision before you run.',
    )
  })

  it('babysits through gh without rebasing or merging', () => {
    const opening = skill('poteto-mode/playbooks/opening-a-pr.md')
    const babysit = skill('poteto-mode/playbooks/babysit.md')
    expect(opening).toContain('Opening a PR does not start a babysit.')
    expect(babysit).toContain('Never rebase, retarget, or force-push.')
    expect(babysit).toContain('Babysitting never authorizes merging.')
    expect(babysit).toContain('installed `loop` skill')
    expect(babysit).not.toMatch(/origin pr|cursor-team-kit/)
    const full = skill('poteto-mode/playbooks/autopilot-full.md')
    expect(full).toContain('playbooks/babysit.md')
    expect(full).toContain('--force-with-lease')
    expect(full).not.toMatch(/origin pr|Cursor cloud agent|cursor-team-kit/)
  })

  it('removes each linked worktree after its PR lands or closes', () => {
    const contracts = skill('poteto-mode/references/task-contracts.md')
    expect(contracts).toContain('git worktree add -b <branch> <path> <base>')
    expect(contracts).toContain('dispatch the owner in a later call')
    expect(contracts).toContain('git worktree remove <path>')
  })

  it('refuses to label a revealing bootstrap as a blinded evaluation', () => {
    const source = skill('poteto-mode/playbooks/eval.md')
    expect(source).toContain('assembled system prompt')
    expect(source).toContain('BLOCKED')
    expect(source).toContain('pstack-leaf')
  })

  it('routes ambient evidence and exhausted depth back to the root', () => {
    const source = skill('poteto-mode/references/task-contracts.md')
    expect(source).toContain('session_history')
    expect(source).toContain('remaining depth')
    expect(source).toContain('root coordinator')
  })
})
