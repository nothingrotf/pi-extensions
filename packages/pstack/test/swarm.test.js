import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import { resolveStructuredOutput, validateOutputSchema } from '../../subagent/src/output.ts'
import { decodeJsonValue } from '../../subagent/src/schema.ts'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const skillPath = join(packageRoot, 'skills', 'swarm', 'SKILL.md')

function skill() {
  return readFileSync(skillPath, 'utf8')
}

describe('swarm', () => {
  it('uses Pi model configuration without substitution', () => {
    const port = skill()
    expect(port).toContain('parsed `swarm workers` runtime policy')
    expect(port).toContain('provider/model-id:effort [fast]')
    expect(port).toContain('Omit `Task.model` to select its scalar default')
    expect(port).toContain('mark that arm `BLOCKED`')
    expect(port).toContain('Do not substitute a model.')
    expect(port).not.toMatch(/~\/\.cursor|grok-4\.6|environment:|cloud_base_branch/)
  })

  it('uses parallel local Tasks and isolated writers', () => {
    const port = skill()
    expect(port).toContain('Use `todo_write`')
    expect(port).toContain('`subagent_type: "generalPurpose"`')
    expect(port).toContain('`run_in_background: true`')
    expect(port).toContain('`readonly: true`')
    expect(port).toContain('`isolation: { mode: "worktree", integration: "branch" }`')
    expect(port).toContain('Native `Task` notifications report completion.')
    expect(port).toContain('Do not poll.')
  })

  it('requires structured evidence and bounded inspection', () => {
    const port = skill()
    expect(port).toContain('`outputSchema`')
    expect(port).toContain('`schemaMode: "strict"`')
    expect(port).toContain('`TaskControl` `status`')
    expect(port).toContain('artifacts, gates, and isolation receipt')
    expect(port).toContain('proceed with N-1')
  })

  it('binds verification and measurement briefs to exact product identity', () => {
    const port = skill()
    expect(port).toContain('## Verifiable work contract')
    expect(port).toContain('base and head SHAs')
    expect(port).toContain('base, result tree, and patch digest')
    expect(port).toContain('Require the same identity in the result')
    expect(port).toContain('Missing or incompatible identity is a gap, never `PASS`.')
  })

  it('requires a measurement method in briefs and reports', () => {
    const port = skill()
    expect(port).toContain('number of samples')
    expect(port).toContain('what one sample is')
    expect(port).toContain('order or interleaving')
    expect(port).toContain('runtime and conditions')
    expect(port).toContain(
      'Missing or incompatible method is a gap, never `PASS`, when measurement is assigned.',
    )
  })

  it('expresses the assigned contract inside the strict schema', () => {
    const port = skill()
    expect(port).toContain('`summary`, `evidence`, and `gaps` state the assigned contract')
    expect(port).toContain('required structured `subject` field')
    expect(port).toContain('structured `method` field')
    expect(port).toContain('requested identity and observed identity')
    expect(port).toContain('`established: false` when identity cannot be established')
    expect(port).toContain('`observed` field is an empty string when unavailable')
    expect(port).toContain('not a generic `evidence` field')
    expect(port).toContain(
      '`ISSUES` for demonstrated discrepancies or `BLOCKED` for unavailable required proof',
    )
  })

  it('keeps conditional requirements out of simple generation workflows', () => {
    const port = skill()
    expect(port).toContain(
      'Apply these requirements only when the brief verifies or measures a product.',
    )
    expect(port).toContain(
      'Never invent SHAs or a benchmark method for generation or writing work.',
    )
    expect(port).toContain('Verification without measurement does not require benchmark metadata')
    expect(port).toContain('assigned identity or method')
  })

  it('audits semantic truth separately from schema gates and keeps every defect', () => {
    const port = skill()
    expect(port).toContain('Schema gates prove shape, not semantic truth.')
    expect(port).toContain('Keep every demonstrated defect, not only the first.')
  })

  it('repairs report-only defects through the supported path without new execution', () => {
    const port = skill()
    expect(port).toContain('`pstack_delivery` with `action: "repair"`')
    expect(port).toContain('receipts intact')
    expect(port).toContain('without a new Task or model run')
    expect(port).toContain('Missing execution needs real proof, not repair.')
    expect(port).toContain('Omit `outputSchema` and `schemaMode` in a managed delivery.')
    expect(port).toContain('`delivery: { kind: "managed", issue: "<existing issue id>" }`')
    expect(port).toContain(
      '`code review` for static analysis or `runtime verification` for shell proof',
    )
    expect(port).toContain('Use only registered criterion IDs')
    expect(port).toContain('review findings belong in `findings`, not `criteria`')
    expect(port).toContain('DeliveryOutputSchema')
  })

  it('accepts observed and unavailable identities through the runtime using its documented schema', () => {
    const example = skill().match(/```json\n([\s\S]*?)\n```/)?.[1]
    if (example === undefined) throw new Error('The documented subject schema is missing.')
    const schema = decodeJsonValue(JSON.parse(example))
    validateOutputSchema(schema)
    for (const subject of [
      { requested: 'base:abc head:def', observed: 'base:abc head:def', established: true },
      { requested: 'base:abc head:def', observed: '', established: false },
    ])
      expect(resolveStructuredOutput(JSON.stringify(subject), schema, 'strict')?.status).toBe(
        'valid',
      )
    expect(
      resolveStructuredOutput(JSON.stringify({ requested: 'base:abc head:def' }), schema, 'strict')
        ?.status,
    ).toBe('invalid')
    expect(
      resolveStructuredOutput(
        JSON.stringify({ requested: 'base:abc head:def', observed: null, established: false }),
        schema,
        'strict',
      )?.status,
    ).toBe('invalid')
  })

  it('preserves enforcement rules and forbids em dashes', () => {
    const port = skill()
    expect(port).toContain('`isolation: { mode: "worktree", integration: "manual" }`')
    expect(port).toContain('Never join its incidental patch.')
    expect(port).not.toContain('\u2014')
    expect(port).not.toContain('children.tsv')
  })
})
