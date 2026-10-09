import { describe, expect, it } from 'vite-plus/test'

import { nextDeliveryStep } from '../src/delivery-next.ts'
import { deliveryView } from '../src/delivery-views.ts'
import { type DeliveryIssue, type DeliverySubmission, recordDelivery } from '../src/delivery.ts'

const artifact = (tree: string) => ({
  repositories: [
    { root: '/issue', relativePath: '', base: 'a'.repeat(40), tree, patch: 'c'.repeat(64) },
  ],
})
const evidence = [
  {
    id: 'command:1',
    kind: 'command' as const,
    passed: true,
    reference: 'file:///log',
    sha256: 'd'.repeat(64),
  },
]
const opened: DeliveryIssue = {
  version: 1,
  ownerSessionId: 'root',
  issue: 'ISSUE-1',
  runtimeRequired: true,
  criteria: [{ id: 'works', description: 'The change works.' }],
  submissions: [],
  createdAt: 0,
}
const candidate = (tree: string, attempt = 1): DeliverySubmission => ({
  agentId: 'owner',
  attempt,
  role: 'feature',
  execution: 'completed',
  artifact: artifact(tree),
  integration: 'integrated',
  evidence,
  recordedAt: attempt,
  report: {
    issue: 'ISSUE-1',
    kind: 'implementation',
    state: 'candidate',
    criteria: [{ id: 'works', result: 'pass', evidence: ['command:1'] }],
    findings: [],
    reason: 'Ready.',
    failureClass: 'none',
  },
})
const review = (
  role: 'code review' | 'runtime verification',
  tree: string,
  verdict: 'accepted' | 'blocked',
): DeliverySubmission => ({
  agentId: role === 'code review' ? 'static' : 'runtime',
  attempt: 1,
  role,
  execution: 'completed',
  artifact: artifact(tree),
  integration: 'integrated',
  evidence,
  recordedAt: 10,
  report: {
    issue: 'ISSUE-1',
    kind: role === 'code review' ? 'technical-review' : 'runtime-verification',
    state: verdict,
    criteria: [
      { id: 'works', result: verdict === 'accepted' ? 'pass' : 'fail', evidence: ['command:1'] },
    ],
    findings:
      verdict === 'accepted'
        ? []
        : [{ id: 'bug', blocking: true, disposition: 'open', evidence: ['command:1'] }],
    reason: verdict === 'accepted' ? 'Accepted.' : 'A regression remains.',
    failureClass: verdict === 'accepted' ? 'none' : 'regression',
  },
})

function save(issue: DeliveryIssue, ...submissions: DeliverySubmission[]): DeliveryIssue {
  let current = issue
  for (const submission of submissions) {
    const result = recordDelivery(current, submission)
    if (!result.ok) throw result.error
    current = result.value
  }
  return current
}

const idle = { running: [], unrecorded: [], workspace: true }

describe('next delivery step', () => {
  it('records settled attempts and waits for running ones before any dispatch', () => {
    expect(nextDeliveryStep(opened, { ...idle, running: ['a'], unrecorded: ['b'] })).toMatchObject({
      step: 'record',
      agentIds: ['b'],
    })
    expect(nextDeliveryStep(opened, { ...idle, running: ['a'] })).toMatchObject({
      step: 'wait',
      agentIds: ['a'],
    })
  })

  it('prepares the workspace before the first owner', () => {
    expect(nextDeliveryStep(opened, { ...idle, workspace: false })).toMatchObject({
      step: 'workspace',
    })
    expect(nextDeliveryStep(opened, idle)).toMatchObject({ step: 'implement' })
  })

  it('reviews a candidate in parallel and resumes the owner for findings', () => {
    const first = save(opened, candidate('b'.repeat(40)))
    expect(nextDeliveryStep(first, idle)).toMatchObject({
      step: 'review',
      roles: ['code review', 'runtime verification'],
    })
    const rejected = save(
      first,
      review('code review', 'b'.repeat(40), 'accepted'),
      review('runtime verification', 'b'.repeat(40), 'blocked'),
    )
    expect(nextDeliveryStep(rejected, idle)).toMatchObject({ step: 'correct', resume: 'owner' })
    expect(nextDeliveryStep(rejected, { ...idle, workspace: false })).toMatchObject({
      step: 'correct',
      resume: null,
    })

    const corrected = save(rejected, candidate('e'.repeat(40), 2))
    expect(nextDeliveryStep(corrected, idle)).toMatchObject({
      step: 'review',
      roles: ['code review', 'runtime verification'],
    })
    const partial = save(corrected, {
      ...review('code review', 'e'.repeat(40), 'accepted'),
      attempt: 2,
      report: {
        ...review('code review', 'e'.repeat(40), 'accepted').report,
        findings: [
          { id: 'bug', blocking: true, disposition: 'corrected', evidence: ['command:1'] },
        ],
      },
    })
    expect(nextDeliveryStep(partial, idle)).toMatchObject({
      step: 'review',
      roles: ['runtime verification'],
    })
    const accepted = save(partial, {
      ...review('runtime verification', 'e'.repeat(40), 'accepted'),
      attempt: 2,
    })
    expect(nextDeliveryStep(accepted, idle)).toMatchObject({ step: 'publish' })
    const view = deliveryView(
      accepted,
      { action: 'read', issue: 'ISSUE-1' },
      nextDeliveryStep(accepted, idle),
    )
    if (!view.ok) throw view.error
    expect(JSON.parse(view.value.text)).toMatchObject({
      next: { step: 'publish' },
      summary: { state: 'accepted' },
    })
  })

  it('requires a diagnosis after two incomplete returns', () => {
    const wip = (attempt: number): DeliverySubmission => {
      const { artifact: _artifact, ...base } = candidate('b'.repeat(40), attempt)
      return {
        ...base,
        integration: 'captured',
        report: {
          ...base.report,
          state: 'wip',
          criteria: [{ id: 'works', result: 'fail', evidence: ['command:1'] }],
          reason: 'Still failing.',
          failureClass: 'regression',
        },
      }
    }
    expect(nextDeliveryStep(save(opened, wip(1), wip(2)), idle)).toMatchObject({
      step: 'diagnose',
      role: 'hardest tasks',
    })
  })
})
