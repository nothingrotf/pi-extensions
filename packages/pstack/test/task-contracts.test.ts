import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

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
    expect(examples).toHaveLength(3)
    for (const example of examples) {
      expect(Value.Check(TaskInputSchema, example), fileURLToPath(contractPath)).toBe(true)
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
})
