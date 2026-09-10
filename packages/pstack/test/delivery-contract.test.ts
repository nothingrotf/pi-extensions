import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

import { loadPstackBootstrap } from '../src/bootstrap.ts'

function skill(path: string): string {
  return readFileSync(new URL(`../skills/${path}`, import.meta.url), 'utf8')
}

const deliveryContractPath = 'poteto-mode/references/delivery-contract.md'
const poolAvailability = 'availability for selection, never a dispatch count'
const laneRule = 'never the size of a configured model pool'

describe('pstack delivery contract', () => {
  it('publishes the shared per-issue fields as prompt content only', () => {
    const contract = skill(deliveryContractPath)
    for (const field of [
      'issue:',
      'phase:',
      'accepted design:',
      'evidence:',
      'base:',
      'head:',
      'patch:',
      'verification owner:',
      'acceptance criteria:',
    ])
      expect(contract).toContain(field)
    expect(contract).toContain('not Task schema parameters')
    expect(contract).not.toContain('"phase"')
    for (const phase of ['design', 'implementation', 'correction', 'verification', 'publication'])
      expect(contract).toContain(phase)
    expect(contract).toContain('time-to-acceptance')
    expect(contract).toContain('no measured savings')
    expect(contract).toContain('early executable probe')
    expect(contract).toContain('application database role')
    expect(contract).toContain('Pin a reusable harness')
    expect(contract).toContain('A changed runtime or dependency invalidates')
    expect(contract).toContain('throughput.md')
    expect(contract).toContain('never merges')
    expect(contract).toContain('user gates')
  })

  it('hands an accepted design to a leaf instead of forcing a design rerun', async () => {
    const bootstrap = await loadPstackBootstrap()
    expect(bootstrap.systemPrompt).toContain('An accepted design carries its grounding')
    expect(bootstrap.systemPrompt).toContain('poteto-mode/references/delivery-contract.md')
    expect(bootstrap.systemPrompt).toContain('never in the Task schema')
    expect(bootstrap.systemPrompt).toContain('A leaf must return required delegation')
    const agent = readFileSync(new URL('../agents/poteto-agent.md', import.meta.url), 'utf8')
    expect(agent).toContain('Implement the accepted design supplied by the coordinator')
    expect(agent).toContain('do not rerun `how` or `architect` for it')
    const how = skill('how/SKILL.md')
    expect(how).toContain('does not rerun this skill')
  })

  it('scopes the architect trigger to new or contested design', () => {
    const poteto = skill('poteto-mode/SKILL.md')
    expect(poteto).not.toContain('Code crossing a function boundary')
    expect(poteto).toContain('Crossing a function is not a design trigger')
    expect(poteto).toContain('genuinely new or contested contracts, ownership, state, or security')
    expect(poteto).toContain('references/delivery-contract.md')
    expect(poteto).toContain('One persistent implementer')
    expect(poteto).toContain('one independent reviewer')
    expect(poteto).toContain('Two independent issue lanes')
    expect(poteto).toContain(laneRule)
    for (const playbook of ['feature', 'bug-fix', 'perf-issue', 'refactoring']) {
      const source = skill(`poteto-mode/playbooks/${playbook}.md`)
      expect(source, playbook).not.toContain('crosses a function boundary')
      expect(source, playbook).toContain('references/delivery-contract.md')
    }
    const feature = skill('poteto-mode/playbooks/feature.md')
    expect(feature).toContain('design: accepted')
    expect(feature).not.toContain('`architect` for parallel design exploration')
    expect(feature).not.toContain('Mandatory: no skip-with-reason escape')
    expect(feature).toContain('Ordinary local structure choices do not trigger a bakeoff')
    expect(poteto).toContain('references/throughput.md')
  })

  it('keeps one implementer, one reviewer, and two issue lanes in the autopilots', () => {
    for (const playbook of ['autopilot-full', 'autopilot-stack']) {
      const source = skill(`poteto-mode/playbooks/${playbook}.md`)
      expect(source, playbook).toContain('pstack-nested')
      expect(source, playbook).toContain('foreground')
      expect(source, playbook).toContain('synthetic snapshot')
      expect(source, playbook).toContain('accepted patch')
      expect(source, playbook).toContain('references/delivery-contract.md')
      expect(source, playbook).toContain('one independent reviewer')
      expect(source, playbook).toContain(laneRule)
      expect(source, playbook).toContain('time-to-acceptance')
      expect(source, playbook).toContain('runtime preflight')
      expect(source, playbook).toContain('explicit swarm requirement')
      expect(source, playbook).not.toContain('gets a fresh swarm')
      expect(source, playbook).toContain('same reviewer')
    }
  })

  it('retains compatible review owners and separates destination publication from prose', () => {
    const contract = skill(deliveryContractPath)
    expect(contract).toContain('one complete verdict')
    expect(contract).toContain(
      'The reviewer reports cleanup findings, and the implementer applies required edits',
    )
    expect(contract).toContain('from the actual implementation model')
    expect(contract).toContain('from their first dispatch')
    expect(contract).toContain('Do not allocate a separate worktree or preparation owner')
    expect(contract).toContain('Resume a compatible reviewer to complete a missing verdict')
    const task = skill('poteto-mode/references/task-contracts.md')
    expect(task).toContain('Never weaken resume validation')
    expect(task).toContain(
      'A combined static and runtime reviewer starts with `runtime verification`',
    )
    const orchestrate = skill('poteto-mode/playbooks/orchestrate.md')
    expect(orchestrate).not.toContain('Never resume-chain a brief')
    expect(orchestrate).toContain('Resume the same implementer and independent reviewer')
    const trail = skill('show-me-your-work/SKILL.md')
    expect(trail).toContain('Reuse the existing independent reviewer')
    expect(trail).toContain('role: "code review"')
    for (const playbook of ['opening-a-pr', 'autopilot-full', 'autopilot-stack']) {
      const source = skill(`poteto-mode/playbooks/${playbook}.md`)
      expect(source).toContain('role: "publication"')
      expect(source).not.toContain('role: "judgment and prose"')
    }
  })

  it('treats a configured design pool as availability, not fanout', () => {
    const architect = skill('architect/SKILL.md')
    expect(architect).not.toContain('use four inherited runners')
    expect(architect).toContain(poolAvailability)
    expect(architect).toContain('at least two structurally distinct candidates')
    expect(architect).toContain('does not rerun')
    const arena = skill('arena/SKILL.md')
    expect(arena).not.toContain('use four inherited runners')
    expect(arena).toContain(poolAvailability)
  })
})
