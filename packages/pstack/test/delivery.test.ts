import { resolveStructuredOutput, validateOutputSchema } from '@nothingrotf/subagent'
import { describe, expect, it } from 'vite-plus/test'

import { deliveryView } from '../src/delivery-views.ts'
import {
  type DeliveryEvidence,
  type DeliveryIssue,
  type DeliverySubmission,
  DeliveryOutputSchema,
  currentDeliveryReport,
  deliveryReportDiagnostics,
  parseDeliveryIssue,
  recordDelivery,
  deliveryRepairIdentity,
  refreshDeliveryIntegration,
  repairDeliveryReport,
  sameDeliveryArtifact,
  summarizeDelivery,
} from '../src/delivery.ts'

const artifact = {
  repositories: [
    {
      root: '/product',
      relativePath: '',
      base: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      patch: 'c'.repeat(64),
    },
  ],
}
const evidence: DeliveryEvidence[] = [
  {
    id: 'test',
    kind: 'command',
    passed: true,
    reference: 'file:///test-output',
    sha256: 'd'.repeat(64),
  },
]
const issue: DeliveryIssue = {
  version: 1,
  ownerSessionId: 'parent',
  issue: 'SPT-135',
  runtimeRequired: true,
  criteria: [{ id: 'replay', description: 'Replay after purge preserves delivery' }],
  submissions: [],
  createdAt: 0,
}
const implementation: DeliverySubmission = {
  agentId: 'implementer',
  attempt: 1,
  role: 'feature',
  execution: 'completed',
  artifact,
  integration: 'captured',
  evidence,
  recordedAt: 1,
  report: {
    issue: 'SPT-135',
    kind: 'implementation',
    state: 'candidate',
    criteria: [{ id: 'replay', result: 'pass', evidence: ['test'] }],
    findings: [],
    reason: '',
    failureClass: 'none',
  },
}
const verifier: DeliverySubmission = {
  ...implementation,
  agentId: 'reviewer',
  role: 'runtime verification',
  recordedAt: 2,
  report: { ...implementation.report, kind: 'runtime-verification', state: 'accepted' },
}
function save(current: DeliveryIssue, entry: DeliverySubmission): DeliveryIssue {
  const result = recordDelivery(current, entry)
  if (!result.ok) throw result.error
  return result.value
}

describe('managed delivery acceptance', () => {
  it('replays legacy design records without granting implementation ownership', () => {
    const blocked = save(issue, {
      ...implementation,
      report: {
        ...implementation.report,
        state: 'blocked',
        reason: 'Design is required.',
        criteria: [],
      },
    })
    const design: DeliverySubmission = {
      ...implementation,
      agentId: 'designer',
      role: 'architect runners',
      execution: 'failed',
      failureKind: 'report-contract',
      report: { ...implementation.report, state: 'wip', reason: 'Design failed.', criteria: [] },
    }
    const persisted = { ...blocked, submissions: [...blocked.submissions, design] }
    const replayed = parseDeliveryIssue(persisted)
    if (!replayed.ok) throw replayed.error
    expect(replayed.value.submissions).toEqual(persisted.submissions)
    expect(summarizeDelivery(replayed.value)).toMatchObject({
      state: 'blocked',
      incompleteReturns: 1,
      diagnosisRequired: false,
      unresolvedCriteria: ['replay'],
    })
    const view = deliveryView(replayed.value, { action: 'read', issue: issue.issue })
    if (!view.ok) throw view.error
    expect(JSON.parse(view.value.text)).toMatchObject({
      implementationOwner: 'implementer',
      artifactSource: { agentId: 'implementer' },
    })
  })

  it('presents the full supported output contract and enforces report limits separately', () => {
    expect(() => validateOutputSchema(DeliveryOutputSchema)).not.toThrow()
    expect(
      resolveStructuredOutput(JSON.stringify(implementation.report), DeliveryOutputSchema, 'strict')
        ?.status,
    ).toBe('valid')
    for (const invalid of [
      { ...implementation.report, state: 'done' },
      { ...implementation.report, kind: 'comments-only' },
      { ...implementation.report, criteria: [{ id: 'replay', result: 'unknown', evidence: [] }] },
      {
        ...implementation.report,
        findings: [{ id: 'late', blocking: true, disposition: 'dismissed', evidence: [] }],
      },
      { ...implementation.report, extra: true },
    ]) {
      expect(
        resolveStructuredOutput(JSON.stringify(invalid), DeliveryOutputSchema, 'strict')?.status,
      ).toBe('invalid')
    }
    expect(
      recordDelivery(issue, {
        ...implementation,
        report: { ...implementation.report, reason: 'x'.repeat(4097) },
      }).ok,
    ).toBe(false)
  })

  it('separates successful execution, captured WIP, candidate, and independent acceptance', () => {
    const wip = save(issue, {
      ...implementation,
      report: {
        ...implementation.report,
        state: 'wip',
        reason: 'Replay proof remains pending',
        criteria: [],
      },
    })
    expect(summarizeDelivery(wip)).toMatchObject({
      state: 'wip',
      integration: 'captured',
      unresolvedCriteria: ['replay'],
    })
    const candidate = save(wip, { ...implementation, attempt: 2 })
    expect(summarizeDelivery(candidate).state).toBe('candidate')
    expect(summarizeDelivery(save(candidate, verifier)).state).toBe('accepted')
  })

  it('rejects missing, failed, and fabricated proof and runtime with zero commands', () => {
    for (const supplied of [
      [],
      [
        {
          ...evidence[0],
          id: 'different',
          kind: 'command',
          passed: true,
          reference: 'file:///x',
          sha256: 'd'.repeat(64),
        },
      ],
    ] satisfies DeliveryEvidence[][]) {
      expect(recordDelivery(issue, { ...implementation, evidence: supplied }).ok).toBe(false)
    }
    expect(
      recordDelivery(issue, {
        ...implementation,
        evidence: evidence.map((entry) => ({ ...entry, passed: false })),
      }).ok,
    ).toBe(false)
    expect(
      recordDelivery(issue, {
        ...verifier,
        evidence: evidence.map((entry) => ({ ...entry, kind: 'patch' })),
      }).ok,
    ).toBe(false)
    expect(
      recordDelivery(issue, {
        ...implementation,
        report: { ...implementation.report, state: 'accepted' },
      }).ok,
    ).toBe(false)
  })

  it('names the failed receipt and status that block a passing criterion', () => {
    const result = recordDelivery(issue, {
      ...implementation,
      evidence: evidence.map((entry) => ({ ...entry, kind: 'failure', passed: false })),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Failed evidence established readiness.')
    expect(result.error.message).toContain('Criterion replay references test with status error')
  })

  it('repairs only report serialization over pinned immutable evidence', () => {
    const original = save(issue, {
      ...implementation,
      intendedReport: implementation.report,
      report: {
        ...implementation.report,
        state: 'wip',
        reason: 'The candidate report cited a stale receipt alias.',
      },
    })
    const target = original.submissions[0]
    if (target === undefined) throw new Error('Missing repair target.')
    const identity = deliveryRepairIdentity(target)
    const repaired = repairDeliveryReport(original, {
      agentId: target.agentId,
      artifactSha256: identity.artifactSha256,
      attempt: target.attempt,
      evidenceSha256: identity.evidenceSha256,
      recordedAt: 10,
      report: implementation.report,
      reportSha256: identity.reportSha256,
      revision: 1,
    })
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) throw repaired.error
    expect(repaired.value.submissions[0]?.report).toEqual(target.report)
    expect(repaired.value.submissions[0]?.reportCorrections).toEqual([
      expect.objectContaining({ revision: 1, report: implementation.report }),
    ])
    expect(summarizeDelivery(repaired.value).state).toBe('candidate')
    const repairedSubmission = repaired.value.submissions[0]
    if (repairedSubmission === undefined) throw new Error('Missing repaired submission.')
    const refreshed = refreshDeliveryIntegration(repaired.value, {
      ...repairedSubmission,
      integration: 'integrated',
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) throw refreshed.error
    expect(refreshed.value.submissions[0]?.reportCorrections).toEqual(
      repairedSubmission.reportCorrections,
    )
    for (const changed of [
      { ...identity, reportSha256: '0'.repeat(64) },
      { ...identity, evidenceSha256: '0'.repeat(64) },
      { ...identity, artifactSha256: '0'.repeat(64) },
    ]) {
      expect(
        repairDeliveryReport(original, {
          agentId: target.agentId,
          attempt: target.attempt,
          recordedAt: 10,
          report: implementation.report,
          revision: 1,
          ...changed,
        }).ok,
      ).toBe(false)
    }
  })

  it('repairs only trusted report-contract failures and never launders execution failure', () => {
    const reportFailure = save(issue, {
      ...implementation,
      execution: 'failed',
      failureKind: 'report-contract',
      intendedReport: implementation.report,
      report: {
        ...implementation.report,
        state: 'wip',
        reason: 'The terminal report contract failed after successful execution.',
      },
    })
    const target = reportFailure.submissions[0]
    if (target === undefined) throw new Error('Missing report-contract target.')
    const repaired = repairDeliveryReport(reportFailure, {
      agentId: target.agentId,
      attempt: target.attempt,
      recordedAt: 20,
      report: implementation.report,
      revision: 1,
      ...deliveryRepairIdentity(target),
    })
    expect(repaired.ok).toBe(true)
    if (!repaired.ok) throw repaired.error
    expect(summarizeDelivery(repaired.value).state).toBe('candidate')

    const executionFailure = save(issue, {
      ...implementation,
      execution: 'failed',
      intendedReport: implementation.report,
      report: {
        ...implementation.report,
        state: 'wip',
        reason: 'The execution itself failed.',
      },
    })
    const failedTarget = executionFailure.submissions[0]
    if (failedTarget === undefined) throw new Error('Missing execution failure target.')
    expect(
      repairDeliveryReport(executionFailure, {
        agentId: failedTarget.agentId,
        attempt: failedTarget.attempt,
        recordedAt: 20,
        report: implementation.report,
        revision: 1,
        ...deliveryRepairIdentity(failedTarget),
      }).ok,
    ).toBe(false)
  })

  it('permits conservative WIP repair without erasing findings or promoting proof', () => {
    const intended: DeliverySubmission['report'] = {
      ...implementation.report,
      findings: [{ id: 'F1', blocking: false, disposition: 'corrected', evidence: ['test'] }],
    }
    const original = save(issue, {
      ...implementation,
      intendedReport: intended,
      report: { ...intended, state: 'wip', reason: 'The receipt alias requires correction.' },
    })
    const target = original.submissions[0]
    if (target === undefined) throw new Error('Missing conservative repair target.')
    const downgraded: DeliverySubmission['report'] = {
      ...intended,
      state: 'wip',
      criteria: [{ id: 'replay', result: 'pending', evidence: [] }],
      findings: [{ id: 'F1', blocking: true, disposition: 'open', evidence: [] }],
      reason: 'Immutable proof is unavailable, so readiness remains WIP.',
    }
    const result = repairDeliveryReport(original, {
      agentId: target.agentId,
      attempt: target.attempt,
      recordedAt: 30,
      report: downgraded,
      revision: 1,
      ...deliveryRepairIdentity(target),
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw result.error
    expect(currentDeliveryReport(result.value.submissions[0] ?? target)).toEqual(downgraded)
    expect(
      repairDeliveryReport(original, {
        agentId: target.agentId,
        attempt: target.attempt,
        recordedAt: 30,
        report: { ...intended, findings: [] },
        revision: 1,
        ...deliveryRepairIdentity(target),
      }).ok,
    ).toBe(false)
  })

  it('preserves original criterion outcomes and finding verdicts during repair', () => {
    const blockedReport: DeliverySubmission['report'] = {
      ...implementation.report,
      state: 'blocked',
      reason: 'The original report found a blocking failure.',
      criteria: [{ id: 'replay', result: 'fail', evidence: ['test'] }],
      findings: [{ id: 'F1', blocking: true, disposition: 'open', evidence: ['test'] }],
    }
    const blocked = save(issue, { ...implementation, report: blockedReport })
    const target = blocked.submissions[0]
    if (target === undefined) throw new Error('Missing blocked repair target.')
    const identity = deliveryRepairIdentity(target)
    const base = {
      agentId: target.agentId,
      attempt: target.attempt,
      recordedAt: 10,
      revision: 1,
      ...identity,
    }
    for (const report of [
      { ...blockedReport, kind: 'technical-review' as const },
      {
        ...blockedReport,
        criteria: [{ id: 'replay', result: 'pass' as const, evidence: ['test'] }],
      },
      { ...blockedReport, findings: [] },
      {
        ...blockedReport,
        findings: [{ id: 'F1', blocking: false, disposition: 'open' as const, evidence: ['test'] }],
      },
    ])
      expect(repairDeliveryReport(blocked, { ...base, report }).ok).toBe(false)
  })

  it('identifies unknown criterion IDs without changing the registered criteria', () => {
    const before = structuredClone(issue)
    const result = recordDelivery(issue, {
      ...implementation,
      report: {
        ...implementation.report,
        criteria: [
          { id: 'F1', result: 'pass', evidence: ['test'] },
          { id: 'repository-gate', result: 'pass', evidence: ['test'] },
        ],
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('Unknown criteria were accepted.')
    expect(result.error.message).toContain('Unknown criterion IDs: F1, repository-gate.')
    expect(result.error.message).toContain('Registered criterion IDs: replay.')
    expect(result.error.message).toContain('Keep review findings in findings, not criteria.')
    expect(issue).toEqual(before)
  })

  it.each([implementation, verifier])(
    'identifies prose evidence that cannot establish $role readiness',
    (submission) => {
      const result = recordDelivery(issue, {
        ...submission,
        report: {
          ...submission.report,
          criteria: [{ id: 'replay', result: 'pass', evidence: ['The replay test passed.'] }],
        },
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('Prose evidence established readiness.')
      expect(result.error.message).toContain(
        'Unrecorded evidence references: The replay test passed.',
      )
      expect(result.error.message).toContain('Use recorded receipt IDs, not prose or file paths.')
    },
  )

  it('preserves legacy blocked reports and nonblocking references without promoting their prose', () => {
    const blocked = recordDelivery(issue, {
      ...verifier,
      report: {
        ...verifier.report,
        state: 'blocked',
        reason: 'The recorded file reference needs independent proof.',
        criteria: [{ id: 'replay', result: 'blocked', evidence: ['src/replay.ts:12'] }],
      },
    })
    expect(blocked.ok).toBe(true)
    const candidate = recordDelivery(issue, {
      ...implementation,
      report: {
        ...implementation.report,
        findings: [
          { id: 'note', blocking: false, disposition: 'open', evidence: ['src/replay.ts:12'] },
        ],
      },
    })
    expect(candidate.ok).toBe(true)
  })

  it('invalidates old-head verdicts and never lets comments close technical review', () => {
    const accepted = save(save(issue, implementation), verifier)
    const corrected = save(accepted, {
      ...implementation,
      attempt: 2,
      recordedAt: 3,
      artifact: {
        repositories: artifact.repositories.map((entry) => ({ ...entry, tree: 'e'.repeat(40) })),
      },
    })
    expect(summarizeDelivery(corrected).state).toBe('candidate')
    expect(
      recordDelivery(corrected, {
        ...verifier,
        attempt: 2,
        report: { ...verifier.report, kind: 'comments' },
      }).ok,
    ).toBe(false)
    expect(
      summarizeDelivery(
        save(save(issue, implementation), { ...verifier, agentId: 'implementer', attempt: 2 }),
      ).state,
    ).toBe('candidate')
  })

  it('preserves open blockers and requires evidence for their dispositions', () => {
    const candidate = save(issue, implementation)
    const rejected = save(candidate, {
      ...verifier,
      report: {
        ...verifier.report,
        state: 'blocked',
        reason: 'Same-handle replay fails',
        findings: [{ id: 'late-handle', blocking: true, disposition: 'open', evidence: [] }],
      },
    })
    expect(summarizeDelivery(save(rejected, { ...verifier, attempt: 2 })).state).toBe('candidate')
    const resolved = save(rejected, {
      ...verifier,
      attempt: 2,
      report: {
        ...verifier.report,
        findings: [
          { id: 'late-handle', blocking: true, disposition: 'corrected', evidence: ['test'] },
        ],
      },
    })
    expect(summarizeDelivery(resolved).state).toBe('accepted')
  })

  it('requires diagnosis before a third equivalent return and does not count patch churn as progress', () => {
    const incomplete: DeliverySubmission = {
      ...implementation,
      report: {
        ...implementation.report,
        state: 'wip',
        criteria: [],
        reason: 'Recoverable edit mismatch',
        failureClass: 'execution-contract',
      },
    }
    const twice = save(save(issue, incomplete), { ...incomplete, attempt: 2 })
    expect(summarizeDelivery(twice)).toMatchObject({
      incompleteReturns: 2,
      diagnosisRequired: true,
    })
    const diagnostic: DeliverySubmission = {
      ...incomplete,
      agentId: 'diagnostician',
      role: 'hardest tasks',
      report: {
        ...incomplete.report,
        kind: 'diagnosis',
        reason:
          'Reproduce the exact edit mismatch, then apply an unambiguous edit and rerun replay',
      },
    }
    expect(summarizeDelivery(save(twice, diagnostic)).diagnosisRequired).toBe(false)
    expect(
      recordDelivery(twice, {
        ...diagnostic,
        report: { ...diagnostic.report, failureClass: 'context' },
      }).ok,
    ).toBe(false)
  })

  it('rejects corrupt versioned authority and duplicate attempts without losing previous state', () => {
    const accepted = save(save(issue, implementation), verifier)
    expect(parseDeliveryIssue(JSON.parse(JSON.stringify(accepted)))).toEqual({
      ok: true,
      value: accepted,
    })
    expect(parseDeliveryIssue({ ...accepted, version: 2 }).ok).toBe(false)
    expect(
      parseDeliveryIssue({ ...accepted, submissions: [{ ...implementation, evidence: [] }] }).ok,
    ).toBe(false)
    expect(recordDelivery(accepted, implementation).ok).toBe(false)
    expect(summarizeDelivery(accepted).state).toBe('accepted')
  })

  it('refreshes only integration status after join without changing acceptance evidence', () => {
    const accepted = save(save(issue, implementation), verifier)
    const refreshed = refreshDeliveryIntegration(accepted, {
      ...implementation,
      integration: 'integrated',
      recordedAt: 20,
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) throw refreshed.error
    expect(summarizeDelivery(refreshed.value)).toMatchObject({
      state: 'accepted',
      integration: 'integrated',
    })
    expect(refreshed.value.submissions[0]?.recordedAt).toBe(implementation.recordedAt)
    expect(
      refreshDeliveryIntegration(accepted, {
        ...implementation,
        report: { ...implementation.report, reason: 'altered' },
      }).ok,
    ).toBe(false)
    expect(refreshDeliveryIntegration(accepted, { ...implementation, attempt: 4 }).ok).toBe(false)
  })

  it('uses recorded failure evidence for diagnosis but never for readiness', () => {
    const failure: DeliveryEvidence = {
      id: 'failure',
      kind: 'failure',
      passed: false,
      reference: 'file:///failure',
      sha256: 'e'.repeat(64),
    }
    expect(
      recordDelivery(issue, {
        ...implementation,
        agentId: 'diagnostician',
        role: 'hardest tasks',
        evidence: [failure],
        report: {
          ...implementation.report,
          criteria: [],
          kind: 'diagnosis',
          state: 'wip',
          failureClass: 'context',
          reason: 'The runtime recorded a context-limit failure',
        },
      }).ok,
    ).toBe(true)
    expect(
      recordDelivery(issue, {
        ...implementation,
        evidence: [{ ...failure, id: 'test', passed: true }],
      }).ok,
    ).toBe(false)
  })

  it('records failed returns without a captured artifact and never promotes them', () => {
    const { artifact: _artifact, ...uncaptured } = implementation
    const failed: DeliverySubmission = {
      ...uncaptured,
      execution: 'failed',
      report: {
        ...implementation.report,
        state: 'wip',
        criteria: [],
        reason: 'Session creation failed before patch capture',
        failureClass: 'execution-contract',
      },
    }
    const twice = save(save(issue, failed), { ...failed, attempt: 2 })
    expect(summarizeDelivery(twice)).toMatchObject({ state: 'wip', diagnosisRequired: true })
    expect(recordDelivery(issue, { ...uncaptured, report: implementation.report }).ok).toBe(false)
  })

  it('does not let authors or stale reviews clear independent blocking findings', () => {
    const blocked = save(save(issue, implementation), {
      ...verifier,
      report: {
        ...verifier.report,
        state: 'blocked',
        reason: 'Late observations overwrite the current handle',
        findings: [{ id: 'late', blocking: true, disposition: 'open', evidence: [] }],
      },
    })
    const corrected = save(blocked, {
      ...implementation,
      attempt: 2,
      recordedAt: 3,
      report: {
        ...implementation.report,
        findings: [{ id: 'late', blocking: true, disposition: 'corrected', evidence: ['test'] }],
      },
    })
    expect(summarizeDelivery(corrected).unresolvedFindings).toEqual(['late'])
    const stale = save(corrected, {
      ...verifier,
      attempt: 2,
      recordedAt: 4,
      artifact: {
        repositories: artifact.repositories.map((entry) => ({ ...entry, tree: 'e'.repeat(40) })),
      },
      report: {
        ...verifier.report,
        findings: [{ id: 'late', blocking: true, disposition: 'rejected', evidence: ['test'] }],
      },
    })
    expect(summarizeDelivery(stale).unresolvedFindings).toEqual(['late'])
  })

  it('diagnoses omitted open blocking finding IDs by their full field identity', () => {
    const blocked = save(save(issue, implementation), {
      ...verifier,
      report: {
        ...verifier.report,
        findings: [
          {
            id: 'F1-complete-blocking-identity',
            blocking: true,
            disposition: 'open',
            evidence: [],
          },
        ],
        reason: 'The review found a blocking issue.',
        state: 'blocked',
      },
    })
    expect(
      deliveryReportDiagnostics(blocked, {
        ...verifier,
        attempt: 2,
        report: { ...verifier.report, findings: [] },
      }),
    ).toContain('Review omitted open blocking finding IDs: F1-complete-blocking-identity.')
  })

  it('rejects duplicate repository identities instead of comparing one-way membership', () => {
    const first = artifact.repositories[0]
    if (first === undefined) throw new Error('Missing fixture repository')
    const duplicate = { repositories: [first, first] }
    const different = { repositories: [first, { ...first, root: '/other' }] }
    expect(sameDeliveryArtifact(duplicate, different)).toBe(false)
    expect(sameDeliveryArtifact(different, duplicate)).toBe(false)
    expect(sameDeliveryArtifact(duplicate, duplicate)).toBe(false)
    expect(recordDelivery(issue, { ...implementation, artifact: duplicate }).ok).toBe(false)
  })

  it('treats an identity-less failed review as a veto, never as approval', () => {
    const accepted = save(save(issue, implementation), verifier)
    const { artifact: _artifact, ...failedReview } = verifier
    const failed = save(accepted, {
      ...failedReview,
      attempt: 2,
      execution: 'failed',
      report: {
        ...verifier.report,
        state: 'wip',
        criteria: [],
        reason: 'Review failed before its identity receipt was captured',
      },
    })
    expect(summarizeDelivery(failed).state).toBe('candidate')
  })

  it('requires the latest runtime verdict and preserves a separate technical rejection', () => {
    const accepted = save(save(issue, implementation), verifier)
    const blocked = save(accepted, {
      ...verifier,
      attempt: 2,
      report: { ...verifier.report, state: 'blocked', reason: 'Runtime regression reproduced' },
    })
    const technical = save(blocked, {
      ...verifier,
      agentId: 'static-reviewer',
      role: 'code review',
      report: { ...verifier.report, kind: 'technical-review' },
    })
    expect(summarizeDelivery(technical).state).toBe('candidate')
    const rejected = save(accepted, {
      ...verifier,
      agentId: 'static-reviewer',
      role: 'code review',
      report: {
        ...verifier.report,
        kind: 'technical-review',
        state: 'blocked',
        reason: 'Unsafe code path',
      },
    })
    expect(summarizeDelivery(save(rejected, { ...verifier, attempt: 2 })).state).toBe('candidate')
  })

  it('compares complete repository identities independently of ordering', () => {
    const repositories = Array.from({ length: 12 }, (_, index) => ({
      ...artifact.repositories[0],
      root: `/repo-${index}`,
      relativePath: `${index}`,
      base: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      patch: 'c'.repeat(64),
    }))
    for (let index = 0; index < repositories.length; index += 1) {
      const rotated = [...repositories.slice(index), ...repositories.slice(0, index)]
      expect(sameDeliveryArtifact({ repositories }, { repositories: rotated })).toBe(true)
      expect(sameDeliveryArtifact({ repositories }, { repositories: rotated.slice(1) })).toBe(false)
    }
  })
})
