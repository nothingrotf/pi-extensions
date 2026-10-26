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

  it('starts authorized autopilot babysit once the owner reports the PR URL', () => {
    const opening = skill('poteto-mode/playbooks/opening-a-pr.md')
    const babysit = skill('poteto-mode/playbooks/babysit.md')
    for (const source of [opening, babysit]) {
      expect(source).toContain('Autopilot-full')
      expect(source).toContain('Autopilot-stack')
      expect(source).toContain('explicit lifecycle assignment')
      expect(source).not.toContain('managed')
      expect(source).not.toContain('publication Task')
    }
    expect(opening).toContain('once the owner reports the PR URL')
    expect(opening).toContain('The root owns this lifecycle, not the owner.')
    expect(opening).not.toContain('Autopilot-stack layer PRs are the one exception.')
    expect(babysit).toContain('one babysitter at the merge frontier')
    expect(babysit).toContain('Route code fixes to the implementer')
    expect(babysit).toContain('For a standalone request, fix only on the owning branch')
    const full = skill('poteto-mode/playbooks/autopilot-full.md')
    expect(full).toContain('playbooks/babysit.md')
    expect(full).toContain('git ls-remote')
    expect(full).toContain('--force-with-lease')
    expect(full).toContain('Never force-push a shared branch')
  })

  it('releases each linked worktree after its PR lands or closes', () => {
    const contracts = skill('poteto-mode/references/task-contracts.md')
    expect(contracts).toContain('git worktree add -b <branch> <path> <base>')
    expect(contracts).toContain('dispatch the owner in a later call')
    expect(contracts).toContain('scripts/release-worktree.sh <path>')
    expect(skill('poteto-mode/references/stack-backends.md')).toContain(
      'Use it to grow a stack one published layer at a time.',
    )
  })

  it('logs idle audits without repeating operator status', () => {
    const source = skill('poteto-mode/playbooks/multi-phase-plan.md')
    expect(source).toContain('not already reported')
    expect(source).toContain('no reply text')
    expect(source).toContain("tick's row")
    expect(source).toContain('Record which changes the operator status covered')
    expect(source).toContain('decision log')
  })

  it('retains broken WIP at pause without claiming acceptance or bypassing repository rules', () => {
    const source = skill('poteto-mode/playbooks/pause-safely.md')
    expect(source).not.toContain('Never stop mid-edit in a known-broken state')
    expect(source).toContain('A broken WIP checkpoint is not acceptance')
    expect(source).toContain('repository rules permit a WIP commit')
    expect(source).toContain('required checks pass without bypass')
    expect(source.indexOf('Run the required precommit checks')).toBeLessThan(
      source.indexOf('commit only task edits'),
    )
    expect(source).toContain('Otherwise, retain a patch')
    expect(source).toContain('retain a patch and untracked task files')
    expect(source).toContain('Cancel isolated writers')
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
