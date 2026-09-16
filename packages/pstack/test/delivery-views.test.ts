import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vite-plus/test'

import { deliveryView } from '../src/delivery-views.ts'
import { type DeliveryIssue, parseDeliveryIssue } from '../src/delivery.ts'

function fixture(character: string): DeliveryIssue {
  const issue: DeliveryIssue = {
    version: 1,
    issue: `issue-${character.repeat(240)}`,
    ownerSessionId: 'owner',
    criteria: Array.from({ length: 128 }, (_, index) => ({
      id: `criterion-${index}-${character.repeat(230)}`,
      description: character.repeat(4000),
    })),
    runtimeRequired: true,
    createdAt: 0,
    submissions: [],
  }
  issue.submissions = [
    {
      agentId: `agent-${character.repeat(240)}`,
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'captured',
      evidence: Array.from({ length: 32 }, (_, index) => ({
        id: `command:${index + 1}`,
        kind: 'command',
        passed: true,
        reference: `file:///${character.repeat(4000)}`,
        sha256: 'a'.repeat(64),
      })),
      recordedAt: 1,
      artifact: {
        repositories: Array.from({ length: 64 }, (_, index) => ({
          root: `/repo/${index}/${character.repeat(4000)}`,
          relativePath: `repo/${index}/${character.repeat(4000)}`,
          base: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          patch: 'c'.repeat(64),
        })),
      },
      report: {
        issue: issue.issue,
        kind: 'implementation',
        state: 'wip',
        reason: character.repeat(4000),
        failureClass: 'none',
        criteria: [],
        findings: Array.from({ length: 256 }, (_, index) => ({
          id: `finding-${index}-${character.repeat(230)}`,
          blocking: true,
          disposition: 'open',
          evidence: [],
        })),
      },
    },
  ]
  const parsed = parseDeliveryIssue(issue)
  if (!parsed.ok) throw parsed.error
  return parsed.value
}

function checkedView(issue: DeliveryIssue, input: Parameters<typeof deliveryView>[1]) {
  const result = deliveryView(issue, input)
  if (!result.ok) throw result.error
  expect(Buffer.byteLength(result.value.text)).toBeLessThanOrEqual(32 * 1024)
  expect(Buffer.byteLength(JSON.stringify(result.value.details))).toBeLessThanOrEqual(32 * 1024)
  return JSON.parse(result.value.text)
}

describe('delivery views', () => {
  it.each(['x', '界', '\u0001', '"', '\\'])(
    'bounds escaped summaries and advances complete criterion pages for %j',
    (character) => {
      const issue = fixture(character)
      const before = JSON.stringify(issue)
      const checkpoint = checkedView(issue, { action: 'read', issue: issue.issue })
      expect(checkpoint.summary.state).toBe('wip')
      if (character === 'x') expect(checkpoint.partial).toBeUndefined()
      if (character === '\u0001') expect(checkpoint.partial).toBe(true)
      expect(checkpoint.summary.unresolvedCriterionCount).toBe(128)
      expect(checkpoint.summary.unresolvedFindingCount).toBe(256)
      expect(checkpoint.recentAttempts?.[0]?.repair ?? checkpoint.repairs[0]).toMatchObject({
        action: 'repair',
        revision: 1,
        reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      const criteria = []
      let offset = 0
      while (offset < issue.criteria.length) {
        const page = checkedView(issue, {
          action: 'read',
          issue: issue.issue,
          view: 'criteria',
          offset,
          limit: 20,
        })
        expect(page.criteria.length).toBeGreaterThan(0)
        criteria.push(...page.criteria)
        if (page.nextOffset === null) break
        expect(page.nextOffset).toBeGreaterThan(offset)
        offset = page.nextOffset
      }
      expect(criteria).toEqual(issue.criteria)
      const submissions = checkedView(issue, {
        action: 'read',
        issue: issue.issue,
        view: 'submissions',
      })
      expect(submissions.submissions[0].detail).toMatchObject({
        agentId: issue.submissions[0]?.agentId,
        attempt: 1,
      })
      expect(submissions.submissions[0].repair).toMatchObject({ action: 'repair', revision: 1 })
      expect(JSON.stringify(issue)).toBe(before)
    },
  )

  it('exposes repair only for completed or trusted report-contract evidence', () => {
    const issue = fixture('x')
    const submission = issue.submissions[0]
    if (submission === undefined) throw new Error('Missing repairability fixture.')
    submission.execution = 'failed'
    submission.failureKind = 'report-contract'
    const trusted = checkedView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: submission.attempt,
    })
    expect(trusted.repair).toMatchObject({ action: 'repair', agentId: submission.agentId })
    delete submission.failureKind
    const failed = checkedView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: submission.attempt,
    })
    expect(failed.repair).toBeUndefined()
  })

  it('classifies the repair envelope before paging and always advances', () => {
    const issue: DeliveryIssue = {
      version: 1,
      issue: 'repair-envelope-budget',
      ownerSessionId: 'owner',
      criteria: [{ id: 'criterion', description: 'The page advances.' }],
      runtimeRequired: false,
      createdAt: 0,
      submissions: [],
    }
    const submission: DeliveryIssue['submissions'][number] = {
      agentId: 'budget-agent',
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'captured',
      evidence: [],
      artifact: {
        repositories: [
          {
            root: '/repo',
            relativePath: '',
            base: 'a'.repeat(40),
            tree: 'b'.repeat(40),
            patch: 'c'.repeat(64),
          },
        ],
      },
      report: {
        issue: issue.issue,
        kind: 'implementation',
        state: 'wip',
        criteria: [],
        findings: [],
        reason: 'Retained WIP.',
        failureClass: 'none',
      },
      recordedAt: 1,
    }
    while (Buffer.byteLength(JSON.stringify(submission)) < 30_500) {
      const index = submission.evidence.length
      submission.evidence.push({
        id: `command:${index + 1}`,
        kind: 'command',
        passed: true,
        reference: `artifact://${index}/${'x'.repeat(256)}`,
        sha256: 'd'.repeat(64),
      })
    }
    expect(Buffer.byteLength(JSON.stringify(submission))).toBeLessThanOrEqual(30_720)
    issue.submissions.push(submission)
    const page = checkedView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submissions',
      offset: 0,
      limit: 1,
    })
    expect(page.submissions).toHaveLength(1)
    expect(page.nextOffset).toBeNull()
    expect(page.submissions[0].detail).toMatchObject({ agentId: submission.agentId })
  })

  it('preserves supplementary Unicode when each chunk is encoded independently', () => {
    const issue = fixture('x')
    const submission = issue.submissions[0]
    if (submission === undefined) throw new Error('Missing fixture submission')
    submission.report.reason = '😀'
    const serialized = JSON.stringify(submission)
    const sha256 = createHash('sha256').update(serialized).digest('hex')
    const offset = serialized.indexOf('😀')
    const page = checkedView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: 1,
      offset,
      limit: 1,
      sha256,
    })
    expect(Buffer.from(page.content, 'utf8').toString('utf8')).toBe('😀')
    expect(page.repair).toMatchObject({
      action: 'repair',
      issue: issue.issue,
      agentId: submission.agentId,
      attempt: 1,
      revision: 1,
    })
    expect(page.nextOffset).toBe(offset + 2)
    const invalid = deliveryView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: 1,
      offset: offset + 1,
      limit: 1,
      sha256,
    })
    expect(invalid.ok).toBe(false)
    const boundary = checkedView(issue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: 1,
      offset: offset - 1,
      limit: 2,
      sha256,
    })
    expect(boundary.nextOffset).toBe(offset)
  })

  it('pins exact chunks to a digest and refuses changed, missing, or unknown evidence', () => {
    const issue = fixture('x')
    const submission = issue.submissions[0]
    if (submission === undefined) throw new Error('Missing fixture submission')
    const input = {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: submission.agentId,
      attempt: 1,
    }
    const first = checkedView(issue, { ...input, action: 'read', view: 'submission', limit: 10 })
    expect(first.sha256).toBe(createHash('sha256').update(JSON.stringify(submission)).digest('hex'))
    for (const sha256 of [undefined, '0'.repeat(64)]) {
      const result = deliveryView(issue, {
        action: 'read',
        issue: issue.issue,
        view: 'submission',
        agentId: submission.agentId,
        attempt: 1,
        offset: 10,
        ...(sha256 === undefined ? { limit: 10 } : { sha256 }),
      })
      expect(result.ok).toBe(false)
    }
    const next = checkedView(issue, {
      ...input,
      action: 'read',
      view: 'submission',
      offset: 10,
      limit: 10,
      sha256: first.sha256,
    })
    expect(first.content + next.content).toBe(JSON.stringify(submission).slice(0, 20))
    submission.integration = 'integrated'
    const stale = deliveryView(issue, {
      ...input,
      action: 'read',
      view: 'submission',
      offset: 10,
      sha256: first.sha256,
    })
    expect(stale.ok).toBe(false)
    const unknown = deliveryView(issue, {
      ...input,
      action: 'read',
      view: 'submission',
      attempt: 2,
    })
    expect(unknown.ok).toBe(false)
  })
})
