import { describe, expect, it } from 'vite-plus/test'

import { nextDeliveryStep } from '../src/delivery-next.ts'
import { deliveryView } from '../src/delivery-views.ts'
import {
  deliveryRepairIdentity,
  promoteSettledRuntimeVerdict,
  type DeliveryIssue,
  type DeliverySubmission,
  recordDelivery,
  repairDeliveryReport,
  summarizeDelivery,
} from '../src/delivery.ts'

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

  it('accepts a settled runtime candidate instead of returning it to the owner', () => {
    const first = save(opened, candidate('b'.repeat(40)))
    const staticReview = review('code review', 'b'.repeat(40), 'accepted')
    const runtimeReview = review('runtime verification', 'b'.repeat(40), 'accepted')
    const staticCandidate = {
      ...staticReview,
      report: { ...staticReview.report, state: 'candidate' as const },
    }
    const runtimeCandidate = {
      ...runtimeReview,
      report: { ...runtimeReview.report, state: 'candidate' as const },
    }
    expect(nextDeliveryStep(save(first, staticCandidate, runtimeCandidate), idle)).toMatchObject({
      step: 'correct',
    })
    const promoted = promoteSettledRuntimeVerdict(first, runtimeCandidate)
    expect(promoted.report.state).toBe('accepted')
    expect(nextDeliveryStep(save(first, staticCandidate, promoted), idle)).toMatchObject({
      step: 'publish',
    })
    const pending = {
      ...runtimeCandidate,
      report: {
        ...runtimeCandidate.report,
        criteria: [{ id: 'works', result: 'pending' as const, evidence: ['command:1'] }],
      },
    }
    expect(promoteSettledRuntimeVerdict(first, pending)).toBe(pending)
    expect(promoteSettledRuntimeVerdict(first, staticCandidate)).toBe(staticCandidate)
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

  it('waits for runtime verification when the static review defers execution criteria', () => {
    const deferring: DeliverySubmission = {
      ...review('code review', 'b'.repeat(40), 'accepted'),
      report: {
        ...review('code review', 'b'.repeat(40), 'accepted').report,
        state: 'candidate',
        criteria: [{ id: 'works', result: 'pending', evidence: [] }],
        reason: 'The criterion needs execution.',
      },
    }
    const partial = save(opened, candidate('b'.repeat(40)), deferring)
    expect(nextDeliveryStep(partial, idle)).toMatchObject({
      step: 'review',
      roles: ['runtime verification'],
    })
    const accepted = save(partial, review('runtime verification', 'b'.repeat(40), 'accepted'))
    expect(nextDeliveryStep(accepted, idle)).toMatchObject({ step: 'publish' })
  })

  it('asks for a report repair before a replacement review', () => {
    const first = save(opened, candidate('b'.repeat(40)))
    const failedContract: DeliverySubmission = {
      ...review('code review', 'b'.repeat(40), 'accepted'),
      agentId: 'static',
      execution: 'failed',
      failureKind: 'report-contract',
    }
    const recoverable = save(first, failedContract)
    expect(nextDeliveryStep(recoverable, idle)).toMatchObject({
      step: 'repair',
      agentId: 'static',
      attempt: 1,
    })
    const blocked = save(
      first,
      failedContract,
      review('runtime verification', 'b'.repeat(40), 'blocked'),
    )
    expect(nextDeliveryStep(blocked, idle)).toMatchObject({ step: 'correct' })

    const repaired = (issue: DeliveryIssue, report: DeliverySubmission['report']) => {
      const recorded = issue.submissions.find((entry) => entry.agentId === 'static')
      if (recorded === undefined) throw new Error('The failed review is missing.')
      const result = repairDeliveryReport(issue, {
        ...deliveryRepairIdentity(recorded),
        agentId: 'static',
        attempt: 1,
        recordedAt: 20,
        report,
        revision: 1,
      })
      if (!result.ok) throw result.error
      return result.value
    }
    const rejection = review('code review', 'b'.repeat(40), 'blocked')
    const repairedRejection = repaired(
      save(first, { ...rejection, execution: 'failed', failureKind: 'report-contract' }),
      { ...rejection.report, reason: 'Repaired: a regression remains.' },
    )
    expect(nextDeliveryStep(repairedRejection, idle)).toMatchObject({ step: 'correct' })
    expect(summarizeDelivery(repairedRejection).rejectedReviewRounds).toBe(1)

    const repairedAcceptance = save(
      repaired(recoverable, { ...failedContract.report, reason: 'Repaired: accepted.' }),
      review('runtime verification', 'b'.repeat(40), 'accepted'),
    )
    expect(nextDeliveryStep(repairedAcceptance, idle)).toMatchObject({ step: 'publish' })
  })

  it('requires a diagnosis after three rejected review rounds', () => {
    const rounds = ['b', 'e', 'f'].map((letter, index) => [
      candidate(letter.repeat(40), index + 1),
      { ...review('runtime verification', letter.repeat(40), 'blocked'), attempt: index + 1 },
    ])
    const twice = save(opened, ...rounds.slice(0, 2).flat())
    expect(nextDeliveryStep(twice, idle)).toMatchObject({ step: 'correct', resume: 'owner' })
    const thrice = save(twice, ...(rounds[2] ?? []))
    const step = nextDeliveryStep(thrice, idle)
    expect(step).toMatchObject({ step: 'diagnose', role: 'hardest tasks' })
    expect(step.instruction).toContain('rejected 3 candidates')
    const unrelated = save(
      twice,
      candidate('f'.repeat(40), 3),
      { ...review('code review', 'f'.repeat(40), 'accepted'), attempt: 3 },
      {
        ...review('runtime verification', 'f'.repeat(40), 'accepted'),
        attempt: 3,
        report: {
          ...review('runtime verification', 'f'.repeat(40), 'accepted').report,
          findings: [
            { id: 'bug', blocking: true, disposition: 'corrected', evidence: ['command:1'] },
          ],
        },
      },
    )
    expect(nextDeliveryStep(unrelated, idle)).toMatchObject({ step: 'publish' })
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
    const stalled = save(opened, wip(1), wip(2))
    expect(nextDeliveryStep(stalled, idle)).toMatchObject({
      step: 'diagnose',
      role: 'hardest tasks',
    })
    const diagnosed = save(stalled, {
      agentId: 'diagnostician',
      attempt: 1,
      role: 'hardest tasks',
      execution: 'completed',
      integration: 'captured',
      evidence: [
        {
          id: 'failure',
          kind: 'failure',
          passed: true,
          reference: 'file:///diagnosis',
          sha256: 'e'.repeat(64),
        },
      ],
      recordedAt: 3,
      report: {
        issue: 'ISSUE-1',
        kind: 'diagnosis',
        state: 'wip',
        criteria: [],
        findings: [],
        reason: 'The boundary check reads the wrong field.',
        failureClass: 'regression',
      },
    })
    expect(nextDeliveryStep(diagnosed, idle)).toMatchObject({ step: 'correct', resume: null })
    expect(nextDeliveryStep(save(diagnosed, wip(3)), idle)).toMatchObject({
      step: 'correct',
      resume: 'owner',
    })
  })
})
