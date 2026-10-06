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
    ['show-me-your-work', 'code review'],
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

  it.each(['autopilot-full', 'autopilot-stack'])(
    '%s separates accepted changes from destination publication',
    (name) => {
      const source = skill(`poteto-mode/playbooks/${name}.md`)
      expect(source).toContain('pstack-nested')
      expect(source).toContain('foreground')
      expect(source).toContain('synthetic snapshot')
      expect(source).toContain('accepted patch')
    },
  )

  it('starts authorized autopilot babysit after publication without widening writer permissions', () => {
    for (const name of ['autopilot-full', 'autopilot-stack']) {
      const source = skill(`poteto-mode/playbooks/${name}.md`)
      expect(source).toContain('When publication returns the PR URL')
      expect(source).toContain("Record each PR's babysit assignment and mode in the checkpoint")
      expect(source).toContain('Use `background` while independent builds continue')
      expect(source).toContain('playbooks/babysit.md')
    }
    const opening = skill('poteto-mode/playbooks/opening-a-pr.md')
    const babysit = skill('poteto-mode/playbooks/babysit.md')
    for (const source of [opening, babysit]) {
      expect(source).toContain('Autopilot-full')
      expect(source).toContain('Autopilot-stack')
      expect(source).toContain('explicit lifecycle assignment')
    }
    expect(babysit).toContain('one babysitter at the merge frontier')
    expect(babysit).toContain('Route code fixes to the implementer')
    expect(babysit).toContain('foreground destination boundary')
    expect(babysit).toContain(
      'For a standalone request without a managed issue, fix only on the owning branch',
    )
    expect(opening).toContain('The root owns this lifecycle, not the publication Task')
    const full = skill('poteto-mode/playbooks/autopilot-full.md')
    expect(full).toContain('git ls-remote')
    expect(full).toContain('--force-with-lease')
    expect(full).toContain('Never force-push a shared branch')
  })

  it('grows a stack one published layer at a time and releases its local footprint', () => {
    const stack = skill('poteto-mode/playbooks/autopilot-stack.md')
    expect(stack).toContain(
      'Never implement the whole queue first and split it into pull requests later.',
    )
    expect(stack).toContain('Never hold accepted layers locally for a later batch submission.')
    expect(stack).toContain('gh stack link --remote <remote> --base <trunk>')
    expect(stack).toContain('Leave no run-owned worktree, local branch, container, or volume')
    expect(stack).not.toContain('gh stack init --base <trunk> <branches...>')
    for (const name of ['autopilot-full', 'autopilot-stack']) {
      const source = skill(`poteto-mode/playbooks/${name}.md`)
      expect(source).toContain('Keep issues in flight at or below the lane count')
      expect(source).toContain('local footprint')
    }
    const operations = skill('poteto-mode/references/delivery-operations.md')
    expect(operations).toContain('## Local footprint')
    expect(operations).toContain('Keep one destination worktree per issue in flight')
    expect(operations).toContain(
      'Never create a worktree per attempt, proof, review, candidate, or publication.',
    )
    expect(operations).toContain('scripts/release-worktree.sh <destination>')
    expect(operations).toContain(
      'git push <remote> HEAD:refs/heads/<snapshot-branch>`, without a local branch',
    )
    expect(operations).toContain('also after a failed hook or push')
    expect(skill('poteto-mode/references/task-contracts.md')).toContain(
      'Reuse one destination worktree per issue across rounds',
    )
    expect(skill('poteto-mode/references/stack-backends.md')).toContain(
      'Use it to grow a stack one published layer at a time.',
    )
  })

  it('keeps unaccepted stack layers in draft pull requests until independent acceptance', () => {
    const operations = skill('poteto-mode/references/delivery-operations.md')
    expect(operations).toContain("In Autopilot-full, use the issue's own `wip/<issue>` branch.")
    expect(operations).toContain(
      'In Autopilot-stack, use the layer branch and keep its pull request as a draft.',
    )
    expect(operations).toContain(
      'gh pr create --draft --base <parent-branch> --head <layer-branch>',
    )
    expect(operations).toContain('Omit `--open` from that command so that the layer stays a draft.')
    expect(operations).toContain('Never mark a draft ready from a snapshot')
    expect(operations).toContain('Never start a dependent layer from a draft parent.')
    expect(operations).toContain('Push WIP to a PR branch only for an Autopilot-stack draft layer.')
    const stack = skill('poteto-mode/playbooks/autopilot-stack.md')
    expect(stack).toContain("publish a WIP snapshot to the layer's draft pull request")
    expect(stack).toContain('marks the draft ready with `gh pr ready <number>`')
    expect(stack).toContain('--force-with-lease=<branch>:<observed-snapshot-tip>')
    expect(stack).toContain('after its parent layer is accepted and published')
    const opening = skill('poteto-mode/playbooks/opening-a-pr.md')
    expect(opening).toContain('Autopilot-stack layer PRs are the one exception.')
    const full = skill('poteto-mode/playbooks/autopilot-full.md')
    expect(full).not.toContain('draft')
  })

  it('logs idle audits without repeating operator status', () => {
    for (const path of [
      'poteto-mode/playbooks/multi-phase-plan.md',
      'poteto-mode/references/delivery-operations.md',
    ]) {
      const source = skill(path)
      expect(source).toContain('not already reported')
      expect(source).toContain('no reply text')
      expect(source).toContain("tick's row")
      expect(source).toContain('Record which changes the operator status covered')
      expect(source).toContain('decision log')
    }
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
