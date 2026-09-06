import { initTheme } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'
import { beforeAll, describe, expect, it } from 'vite-plus/test'

import { renderIntercomCard } from '../src/cards.ts'
import { type SubagentTheme } from '../src/format.ts'
import { railTaskDetail } from '../src/index.ts'
import { JobTree, type JobSnapshot } from '../src/jobs.ts'
import { resolveRole } from '../src/roles.ts'
import { decodeBatchTaskInput, decodeSingleTaskInput, TaskInputSchema } from '../src/schema.ts'
import { rowFromJob, TaskCall, TaskResult } from '../src/task-render.ts'

const theme: SubagentTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
  getFgAnsi: () => '',
}

const input = {
  description: 'Inspect behavior',
  model: 'openai-codex/gpt-6-astra',
  prompt: 'Inspect behavior without modifications.',
  role: 'why synthesizer',
  subagent_type: 'explore',
}

const job: JobSnapshot = {
  agentId: 'role-job',
  context: undefined,
  cost: 0,
  description: input.description,
  durationMs: 1_000,
  lastActivity: 'Reading files',
  model: input.model,
  role: input.role,
  status: 'running',
  subagentType: input.subagent_type,
  toolCalls: 1,
}

describe('explicit Task role metadata', () => {
  beforeAll(() => initTheme('dark'))

  it('validates bounded labels identically in single and batch inputs', () => {
    for (const role of [
      'feature',
      'refactoring',
      'why synthesizer',
      'Review_2-phase',
      'a'.repeat(64),
    ]) {
      expect(decodeSingleTaskInput({ ...input, role }).role).toBe(role)
      expect(decodeBatchTaskInput({ tasks: [{ ...input, id: 'one', role }] }).tasks[0]?.role).toBe(
        role,
      )
    }
    for (const role of [
      '',
      ' ',
      ' feature',
      'feature ',
      'a'.repeat(65),
      'why\nsynthesizer',
      '\u001b[31mfeature',
      'why\u202esynthesizer',
      1,
      null,
    ]) {
      expect(Value.Check(TaskInputSchema, { ...input, role })).toBe(false)
      expect(Value.Check(TaskInputSchema, { tasks: [{ ...input, id: 'one', role }] })).toBe(false)
    }
  })

  it('does not turn purpose labels into executable agent roles', () => {
    expect(resolveRole('explore', false).name).toBe('explore')
    expect(resolveRole('bash', false).name).toBe('shell')
    expect(() => resolveRole('why synthesizer', false)).toThrow('does not exist')
    const { role, ...legacy } = input
    expect(role).toBe('why synthesizer')
    expect(decodeSingleTaskInput(legacy)).not.toHaveProperty('role')
    expect(railTaskDetail(legacy)).toBe('Inspect behavior')
  })

  it('shows role beside model in single and batch rail summaries', () => {
    expect(railTaskDetail(input)).toBe('why synthesizer · 6-astra · Inspect behavior')
    expect(
      railTaskDetail({
        tasks: [
          { ...input, id: 'one' },
          { ...input, id: 'two', role: 'feature' },
        ],
      }),
    ).toBe('why synthesizer · 6-astra · Inspect behavior; feature · 6-astra · Inspect behavior')
    const { role, model, ...resumed } = input
    expect(railTaskDetail(resumed, { role, model })).toContain('why synthesizer · 6-astra')
  })

  it('keeps role/model and existing agent badges on task, jobs, and intercom cards', () => {
    const components = [
      new TaskCall(input, theme, {}),
      new TaskCall({ tasks: [{ ...input, id: 'one' }] }, theme, {}),
      new TaskResult([rowFromJob(job, true)], { expanded: false, live: false }, theme),
      new JobTree([job], { expanded: false, isPartial: true }, theme),
    ]
    for (const component of components) {
      const wide = component.render(120).map(stripTerminalSequences).join('\n')
      expect(wide).toContain('why synthesizer · 6-astra')
      for (const width of [1, 8, 20, 40, 80, 120]) {
        expect(component.render(width).every((line) => visibleWidth(line) <= width)).toBe(true)
      }
      expect(component.render(40).map(stripTerminalSequences).join('\n')).toContain(
        'why synthesizer · 6-astra',
      )
    }
    expect(components[2]?.render(120).join('\n')).toContain('⟦explore⟧')
    const card = renderIntercomCard(
      { agentId: 'role-job', kind: 'notification', level: 'info', message: 'Evidence found.' },
      input.description,
      0,
      { expanded: false, now: 1_000, role: input.role, model: input.model },
      theme,
    )
    expect(card.join('\n')).toContain('why synthesizer · 6-astra')
  })
})
