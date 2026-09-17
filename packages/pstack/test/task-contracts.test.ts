import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import { TaskControlInputSchema } from '../../subagent/src/control.ts'
import { TaskInputSchema } from '../../subagent/src/schema.ts'

const contractPath = new URL('../skills/poteto-mode/references/task-contracts.md', import.meta.url)

function contracts(): unknown[] {
  return [...readFileSync(contractPath, 'utf8').matchAll(/```json\n([\s\S]*?)\n```/g)].map(
    (match) => JSON.parse(match[1] ?? ''),
  )
}

describe('pstack executable Task contracts', () => {
  it('publishes valid explicit roles and isolated verifier policy', () => {
    const examples = contracts()
    expect(examples).toHaveLength(4)
    for (const example of examples.slice(0, 3)) {
      expect(Value.Check(TaskInputSchema, example), fileURLToPath(contractPath)).toBe(true)
      expect(example).toMatchObject({ delivery: { kind: 'managed', issue: '<open issue id>' } })
    }
    expect(examples[0]).toMatchObject({
      capability_profile: 'pstack-nested',
      role: 'feature',
      subagent_type: 'poteto-agent',
    })
    expect(examples[1]).toMatchObject({
      isolation: { integration: 'manual', mode: 'worktree' },
      readonly: false,
      role: 'runtime verification',
      run_in_background: true,
    })
    expect(examples[2]).toMatchObject({
      capability_profile: 'pstack-leaf',
      readonly: true,
      role: 'code review',
      subagent_type: 'generalPurpose',
    })
  })

  it('publishes a typed completion wait instead of invalid polling arguments', () => {
    const wait = contracts()[3]
    expect(Value.Check(TaskControlInputSchema, wait)).toBe(true)
    expect(wait).toEqual({
      action: 'wait',
      agent_ids: ['<agent-id from the dispatch receipt>'],
    })
    for (const invalid of [
      { action: 'wait', agent_id: 'child', timeout_ms: 300000 },
      { action: 'wait', agent_ids: ['child'], timeout_ms: '300000' },
      { action: 'wait', agent_ids: ['child'], timeout_seconds: 300 },
    ]) {
      expect(Value.Check(TaskControlInputSchema, invalid)).toBe(false)
    }
  })
})
