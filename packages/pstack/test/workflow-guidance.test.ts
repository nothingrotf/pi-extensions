import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

function skill(path: string): string {
  return readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8')
}

describe('standalone pstack worker contracts', () => {
  it.each(['recall', 'automate-me', 'maintain-verification-skill', 'show-me-your-work'])(
    '%s supplies planning capabilities and an explicit review role',
    (name) => {
      const source = skill(`${name}/SKILL.md`)
      expect(source).toContain('capability_profile: "pstack-leaf"')
      expect(source).toContain('role: "judgment and prose"')
      expect(source).toContain('subagent_type: "generalPurpose"')
    },
  )

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
