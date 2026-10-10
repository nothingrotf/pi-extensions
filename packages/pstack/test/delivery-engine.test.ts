import { describe, expect, it } from 'vite-plus/test'

import {
  type DeliveryEngineHost,
  type DeliveryEngineInput,
  type EngineAction,
  type EngineDispatch,
  type EngineTaskInput,
  runDeliveryEngine,
} from '../src/delivery-engine.ts'
import type { DeliveryNextStep } from '../src/delivery-next.ts'
import type { DeliveryIssue } from '../src/delivery.ts'

const issue: DeliveryIssue = {
  version: 1,
  ownerSessionId: 'root',
  issue: 'ISSUE-1',
  runtimeRequired: true,
  criteria: [
    { id: 'works', description: 'The change works.' },
    { id: 'tested', description: 'A test covers the change.' },
  ],
  submissions: [],
  createdAt: 0,
}

const input: DeliveryEngineInput = {
  issue: 'ISSUE-1',
  owner: { role: 'bug-fix', brief: 'Fix the boundary in src/pricing.ts.' },
  review: {
    codeModel: 'openai-codex/gpt-6.1-sol:xhigh',
    runtimeModel: 'anthropic/claude-opus-5:medium',
    brief: 'Run bun test.',
  },
}

interface Script {
  steps: DeliveryNextStep[]
  outputs?: string[]
  unresolved?: { unresolvedCriteria: string[]; unresolvedFindings: string[] }
  abortAfterDispatch?: number
  rejectDispatch?: string
  rejectDeliver?: string
}

function scripted(script: Script) {
  const dispatched: EngineTaskInput[] = []
  const delivered: EngineAction[] = []
  const controller = new AbortController()
  let cursor = 0
  let clock = 0
  const next = (): DeliveryNextStep => {
    const step = script.steps[Math.min(cursor, script.steps.length - 1)]
    if (step === undefined) throw new Error('The script has no steps.')
    cursor += 1
    return step
  }
  const host: DeliveryEngineHost = {
    checkpoint: () => ({ issue, next: next() }),
    async deliver(action) {
      delivered.push(action)
      return script.rejectDeliver
    },
    async dispatch(task): Promise<EngineDispatch> {
      dispatched.push(task)
      clock += 1000
      if (script.rejectDispatch !== undefined)
        return { agents: [], error: script.rejectDispatch, text: '' }
      if (script.abortAfterDispatch === dispatched.length) controller.abort()
      const nodes = 'tasks' in task ? task.tasks : [task]
      return {
        agents: nodes.map((node, index) => ({
          agentId: node.resume ?? `agent-${dispatched.length}-${index}`,
          status: 'completed',
        })),
        error: undefined,
        text: script.outputs?.[dispatched.length - 1] ?? `output ${dispatched.length}`,
      }
    },
    now: () => clock,
    signal: controller.signal,
  }
  const summarize = () =>
    script.unresolved ?? { unresolvedCriteria: ['works'], unresolvedFindings: [] }
  return { delivered, dispatched, host, summarize }
}

const instruction = 'Follow the step.'

describe('delivery engine', () => {
  it('runs workspace, owner, record, paired review, correction, and acceptance in order', async () => {
    const run = scripted({
      steps: [
        { step: 'workspace', instruction },
        { step: 'implement', instruction },
        { step: 'record', agentIds: ['agent-1-0'], instruction },
        { step: 'review', roles: ['code review', 'runtime verification'], instruction },
        { step: 'record', agentIds: ['agent-2-0', 'agent-2-1'], instruction },
        { step: 'correct', resume: 'agent-1-0', instruction },
        { step: 'record', agentIds: ['agent-1-0'], instruction },
        { step: 'review', roles: ['code review'], instruction },
        { step: 'record', agentIds: ['agent-4-0'], instruction },
        { step: 'publish', instruction },
      ],
      outputs: ['owner report', 'static: finding F1 blocks the boundary'],
      unresolved: { unresolvedCriteria: ['tested'], unresolvedFindings: ['F1'] },
    })
    const result = await runDeliveryEngine(input, run.host, run.summarize)

    expect(result).toMatchObject({ dispatches: 4, issue: 'ISSUE-1', stop: 'accepted' })
    expect(run.delivered).toEqual([
      { action: 'workspace' },
      { action: 'record', agentId: 'agent-1-0' },
      { action: 'record', agentId: 'agent-2-0' },
      { action: 'record', agentId: 'agent-2-1' },
      { action: 'record', agentId: 'agent-1-0' },
      { action: 'record', agentId: 'agent-4-0' },
    ])
    const [owner, review, correction, finalReview] = run.dispatched
    expect(owner).toEqual({
      capability_profile: 'pstack-leaf',
      delivery: { issue: 'ISSUE-1', kind: 'managed' },
      description: 'Deliver ISSUE-1',
      prompt: 'Fix the boundary in src/pricing.ts.',
      role: 'bug-fix',
      run_in_background: false,
      subagent_type: 'generalPurpose',
    })
    expect(review).toMatchObject({
      tasks: [
        {
          id: 'static',
          model: 'openai-codex/gpt-6.1-sol:xhigh',
          readonly: true,
          role: 'code review',
        },
        {
          id: 'runtime',
          model: 'anthropic/claude-opus-5:medium',
          readonly: false,
          role: 'runtime verification',
        },
      ],
    })
    expect(JSON.stringify(review)).toContain('Run bun test.')
    expect(correction).toMatchObject({ resume: 'agent-1-0', run_in_background: false })
    expect(correction).not.toHaveProperty('role')
    const correctionPrompt =
      correction !== undefined && 'prompt' in correction ? correction.prompt : ''
    expect(correctionPrompt).toContain('Independent review rejected the current candidate.')
    expect(correctionPrompt).toContain('- tested: A test covers the change.')
    expect(correctionPrompt).toContain('Open findings: F1')
    expect(correctionPrompt).toContain('static: finding F1 blocks the boundary')
    expect(finalReview).toMatchObject({
      model: 'openai-codex/gpt-6.1-sol:xhigh',
      role: 'code review',
      run_in_background: false,
    })
    expect(finalReview).not.toHaveProperty('id')
    expect(result.steps.map((step) => step.step)).toEqual([
      'workspace',
      'implement',
      'record',
      'review',
      'record',
      'record',
      'correct',
      'record',
      'review',
      'record',
    ])
  })

  it('gives a fresh owner the brief, the review, and the diagnosis', async () => {
    const run = scripted({
      steps: [
        { step: 'diagnose', role: 'hardest tasks', instruction: 'Ask why corrections fail.' },
        { step: 'correct', resume: null, instruction },
        { step: 'publish', instruction },
      ],
      outputs: ['cause: the fixture caches prices'],
    })
    const result = await runDeliveryEngine(input, run.host, run.summarize)

    expect(result.stop).toBe('accepted')
    const [diagnosis, owner] = run.dispatched
    expect(diagnosis).toMatchObject({ readonly: true, role: 'hardest tasks' })
    expect(diagnosis).not.toHaveProperty('model')
    const diagnosisPrompt = diagnosis !== undefined && 'prompt' in diagnosis ? diagnosis.prompt : ''
    expect(diagnosisPrompt).toContain('Ask why corrections fail.')
    expect(diagnosisPrompt).toContain('Fix the boundary in src/pricing.ts.')
    expect(owner).toMatchObject({
      role: 'bug-fix',
      delivery: { issue: 'ISSUE-1', kind: 'managed' },
    })
    const ownerPrompt = owner !== undefined && 'prompt' in owner ? owner.prompt : ''
    expect(ownerPrompt.startsWith('Fix the boundary in src/pricing.ts.')).toBe(true)
    expect(ownerPrompt).toContain('cause: the fixture caches prices')
  })

  it('stops at the dispatch limit with the pending step', async () => {
    const run = scripted({
      steps: [
        { step: 'implement', instruction },
        { step: 'record', agentIds: ['agent-1-0'], instruction },
        { step: 'correct', resume: 'agent-1-0', instruction },
      ],
    })
    const result = await runDeliveryEngine({ ...input, maxDispatches: 1 }, run.host, run.summarize)

    expect(result).toMatchObject({
      dispatches: 1,
      next: { step: 'correct', resume: 'agent-1-0' },
      stop: 'dispatch-limit',
    })
  })

  it('returns control for running Tasks, rejected dispatches, and rejected protocol steps', async () => {
    const waiting = scripted({ steps: [{ step: 'wait', agentIds: ['bg'], instruction }] })
    expect(await runDeliveryEngine(input, waiting.host, waiting.summarize)).toMatchObject({
      detail: 'bg',
      dispatches: 0,
      stop: 'running',
    })

    const rejected = scripted({
      steps: [{ step: 'implement', instruction }],
      rejectDispatch: 'Unknown role.',
    })
    expect(await runDeliveryEngine(input, rejected.host, rejected.summarize)).toMatchObject({
      detail: 'Unknown role.',
      stop: 'dispatch-rejected',
    })

    const protocol = scripted({
      steps: [{ step: 'workspace', instruction }],
      rejectDeliver: 'Not a Git repository.',
    })
    expect(await runDeliveryEngine(input, protocol.host, protocol.summarize)).toMatchObject({
      detail: 'Not a Git repository.',
      stop: 'protocol-rejected',
    })
  })

  it('stops when a protocol step repeats without progress', async () => {
    const run = scripted({ steps: [{ step: 'record', agentIds: ['stuck'], instruction }] })
    const result = await runDeliveryEngine(input, run.host, run.summarize)

    expect(result.stop).toBe('stalled')
    expect(run.delivered.length).toBe(12)
  })

  it('stops after an abort without another dispatch', async () => {
    const run = scripted({
      abortAfterDispatch: 1,
      steps: [
        { step: 'implement', instruction },
        { step: 'correct', resume: 'agent-1-0', instruction },
      ],
    })
    const result = await runDeliveryEngine(input, run.host, run.summarize)

    expect(result.stop).toBe('aborted')
    expect(run.dispatched).toHaveLength(1)
  })
})
