import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager, type CustomEntry } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  deliveryJournalEntryType,
  type DeliveryJournalEvent,
  makeDeliveryJournalEvent,
  readDeliveryJournal,
} from '../src/delivery-journal.ts'
import { deliveryView } from '../src/delivery-views.ts'
import {
  deliveryRepairIdentity,
  type DeliveryIssue,
  type DeliverySubmission,
  recordDelivery,
} from '../src/delivery.ts'

const deliveryCheckpointEntryType = '@nothingrotf/pstack/delivery-v1'
const cleanup: string[] = []

afterEach(async () => {
  for (const path of cleanup.splice(0).reverse()) await rm(path, { force: true, recursive: true })
})

async function manager(ownerSessionId = 'journal-owner'): Promise<SessionManager> {
  const root = await mkdtemp(join(tmpdir(), 'pstack-delivery-journal-'))
  cleanup.push(root)
  const sessionManager = SessionManager.create(root, join(root, 'sessions'), {
    id: ownerSessionId,
  })
  sessionManager.appendMessage({
    role: 'assistant',
    api: 'journal-test',
    provider: 'journal-test',
    model: 'journal-test',
    content: [{ type: 'text', text: 'Persist the journal fixture.' }],
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  })
  return sessionManager
}

function emptyIssue(ownerSessionId: string, issue = 'bounded-growth'): DeliveryIssue {
  return {
    version: 1,
    issue,
    ownerSessionId,
    criteria: [{ id: 'preserved', description: 'The retained record is exact.' }],
    runtimeRequired: false,
    submissions: [],
    createdAt: 1,
  }
}

function submission(
  issue: string,
  agentId: string,
  attempt: number,
  reason: string,
): DeliverySubmission {
  return {
    agentId,
    attempt,
    role: 'feature',
    execution: 'failed',
    integration: 'captured',
    evidence: [],
    report: {
      issue,
      kind: 'implementation',
      state: 'wip',
      criteria: [],
      findings: [],
      reason,
      failureClass: 'execution-contract',
    },
    recordedAt: attempt,
  }
}

function event<Input>(input: Input): DeliveryJournalEvent {
  const parsed = makeDeliveryJournalEvent(input)
  if (!parsed.ok) throw parsed.error
  return parsed.value
}

function customEntries(sessionManager: SessionManager, customType: string): CustomEntry[] {
  return sessionManager
    .getBranch()
    .filter(
      (entry): entry is CustomEntry => entry.type === 'custom' && entry.customType === customType,
    )
}

describe('delivery event journal', () => {
  it('retains only each new submission and replays exact records after reopen', async () => {
    const sessionManager = await manager()
    const owner = sessionManager.getSessionId()
    const issue = emptyIssue(owner)
    let head = sessionManager.appendCustomEntry(deliveryCheckpointEntryType, issue)
    const records = [
      submission(issue.issue, 'worker-one', 1, `first-marker:${'a'.repeat(1024)}`),
      submission(issue.issue, 'worker-two', 1, `second-marker:${'b'.repeat(1024)}`),
      submission(issue.issue, 'worker-three', 1, `third-marker:${'c'.repeat(1024)}`),
    ]
    for (const record of records) {
      head = sessionManager.appendCustomEntry(
        deliveryJournalEntryType,
        event({
          version: 1,
          kind: 'record',
          ownerSessionId: owner,
          issue: issue.issue,
          previous: head,
          submission: record,
        }),
      )
    }

    const journalEntries = customEntries(sessionManager, deliveryJournalEntryType)
    expect(JSON.stringify(journalEntries[1]?.data)).not.toContain('first-marker')
    expect(JSON.stringify(journalEntries[2]?.data)).not.toContain('second-marker')
    const legacySnapshots: DeliveryIssue[] = []
    let legacy = issue
    for (const record of records) {
      const next = recordDelivery(legacy, record)
      if (!next.ok) throw next.error
      legacy = next.value
      legacySnapshots.push(legacy)
    }
    const journalBytes = journalEntries.reduce(
      (total, entry) => total + Buffer.byteLength(JSON.stringify(entry.data)),
      0,
    )
    const snapshotBytes = legacySnapshots.reduce(
      (total, checkpoint) => total + Buffer.byteLength(JSON.stringify(checkpoint)),
      0,
    )
    expect(journalBytes).toBeLessThan(snapshotBytes)

    sessionManager.appendCompaction('Keep the current delivery checkpoint.', head, 100)
    const compacted = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!compacted.ok) throw compacted.error
    expect(compacted.value.issues.get(issue.issue)?.submissions).toEqual(records)

    const path = sessionManager.getSessionFile()
    if (path === undefined) throw new Error('The journal fixture did not persist.')
    const reopened = SessionManager.open(path)
    const replayed = readDeliveryJournal(reopened.getBranch(), owner)
    if (!replayed.ok) throw replayed.error
    expect(replayed.value.issues.get(issue.issue)?.submissions).toEqual(records)
    expect(replayed.value.heads.get(issue.issue)).toBe(head)
  })

  it('replays pinned report repairs without replacing original evidence', async () => {
    const sessionManager = await manager()
    const owner = sessionManager.getSessionId()
    const issue = emptyIssue(owner, 'repair-replay')
    const intended: DeliverySubmission['report'] = {
      issue: issue.issue,
      kind: 'implementation',
      state: 'candidate',
      criteria: [{ id: 'preserved', result: 'pass', evidence: ['command:1'] }],
      findings: [],
      reason: `The immutable evidence establishes the candidate. ${'proof '.repeat(600)}`,
      failureClass: 'none',
    }
    const retained: DeliverySubmission = {
      agentId: 'repair-worker',
      attempt: 1,
      role: 'feature',
      execution: 'completed',
      integration: 'captured',
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
      evidence: [
        {
          id: 'command:1',
          kind: 'command',
          passed: true,
          reference: 'artifact://command',
          sha256: 'd'.repeat(64),
          status: 'success',
        },
      ],
      intendedReport: intended,
      report: { ...intended, state: 'wip', reason: 'The report alias was invalid.' },
      recordedAt: 1,
    }
    const checkpoint = sessionManager.appendCustomEntry(deliveryCheckpointEntryType, {
      ...issue,
      submissions: [retained],
    })
    const identity = deliveryRepairIdentity(retained)
    const repaired = sessionManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'repair',
        ownerSessionId: owner,
        issue: issue.issue,
        previous: checkpoint,
        agentId: retained.agentId,
        attempt: retained.attempt,
        revision: 1,
        recordedAt: 25,
        report: intended,
        ...identity,
      }),
    )
    const replayed = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!replayed.ok) throw replayed.error
    const firstIssue = replayed.value.issues.get(issue.issue)
    if (firstIssue === undefined) throw new Error('Missing first repaired issue.')
    const firstPage = deliveryView(firstIssue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: retained.agentId,
      attempt: retained.attempt,
    })
    if (!firstPage.ok) throw firstPage.error
    await new Promise((resolve) => setTimeout(resolve, 5))
    const replayedAgain = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!replayedAgain.ok) throw replayedAgain.error
    const secondIssue = replayedAgain.value.issues.get(issue.issue)
    if (secondIssue === undefined) throw new Error('Missing second repaired issue.')
    const secondPage = deliveryView(secondIssue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: retained.agentId,
      attempt: retained.attempt,
    })
    if (!secondPage.ok) throw secondPage.error
    const firstPayload = JSON.parse(firstPage.value.text)
    const secondPayload = JSON.parse(secondPage.value.text)
    expect(firstPayload.nextOffset).not.toBeNull()
    expect(secondPayload.sha256).toBe(firstPayload.sha256)
    const continuation = deliveryView(secondIssue, {
      action: 'read',
      issue: issue.issue,
      view: 'submission',
      agentId: retained.agentId,
      attempt: retained.attempt,
      offset: firstPayload.nextOffset,
      sha256: firstPayload.sha256,
    })
    expect(continuation.ok).toBe(true)
    expect(secondIssue.submissions[0]?.reportCorrections?.[0]?.recordedAt).toBe(
      firstIssue.submissions[0]?.reportCorrections?.[0]?.recordedAt,
    )
    const submission = firstIssue.submissions[0]
    expect(submission?.report).toEqual(retained.report)
    expect(submission?.reportCorrections?.[0]?.report).toEqual(intended)
    expect(replayed.value.heads.get(issue.issue)).toBe(repaired)
  })

  it('replays legacy checkpoints before linked record events', async () => {
    const sessionManager = await manager()
    const owner = sessionManager.getSessionId()
    const base = emptyIssue(owner, 'legacy-migration')
    const legacyRecord = submission(base.issue, 'legacy-worker', 1, 'legacy-record')
    const legacyResult = recordDelivery(base, legacyRecord)
    if (!legacyResult.ok) throw legacyResult.error
    const checkpoint = sessionManager.appendCustomEntry(
      deliveryCheckpointEntryType,
      legacyResult.value,
    )
    const currentRecord = submission(base.issue, 'journal-worker', 1, 'journal-record')
    const current = sessionManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: owner,
        issue: base.issue,
        previous: checkpoint,
        submission: currentRecord,
      }),
    )

    const replayed = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!replayed.ok) throw replayed.error
    expect(replayed.value.issues.get(base.issue)?.submissions).toEqual([
      legacyRecord,
      currentRecord,
    ])
    expect(replayed.value.heads.get(base.issue)).toBe(current)
  })

  it.each([
    {
      name: 'corrupt owned event',
      data: { ownerSessionId: 'journal-owner', version: 1, kind: 'record' },
    },
    {
      name: 'legacy-shaped hybrid event',
      data: emptyIssue('journal-owner', 'corrupt-current'),
    },
  ])('fails closed for a $name without appending migration state', async ({ data }) => {
    const sessionManager = await manager()
    sessionManager.appendCustomEntry(
      deliveryCheckpointEntryType,
      emptyIssue(sessionManager.getSessionId(), 'corrupt-current'),
    )
    sessionManager.appendCustomEntry(deliveryJournalEntryType, data)
    const before = sessionManager.getEntries()

    const replayed = readDeliveryJournal(sessionManager.getBranch(), sessionManager.getSessionId())
    expect(replayed.ok).toBe(false)
    expect(sessionManager.getEntries()).toEqual(before)
  })

  it('scopes replay to the selected branch and owner', async () => {
    const sessionManager = await manager()
    const owner = sessionManager.getSessionId()
    sessionManager.appendCustomEntry(deliveryCheckpointEntryType, {
      ownerSessionId: 'another-owner',
      version: 'corrupt-foreign-checkpoint',
    })
    sessionManager.appendCustomEntry(deliveryJournalEntryType, {
      ownerSessionId: 'another-owner',
      version: 'corrupt-foreign-event',
    })
    const issue = emptyIssue(owner, 'branch-scope')
    const checkpoint = sessionManager.appendCustomEntry(deliveryCheckpointEntryType, issue)
    const abandoned = submission(issue.issue, 'abandoned-worker', 1, 'abandoned-branch')
    sessionManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: owner,
        issue: issue.issue,
        previous: checkpoint,
        submission: abandoned,
      }),
    )
    sessionManager.branch(checkpoint)
    const selected = submission(issue.issue, 'selected-worker', 1, 'selected-branch')
    sessionManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: owner,
        issue: issue.issue,
        previous: checkpoint,
        submission: selected,
      }),
    )

    const replayed = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!replayed.ok) throw replayed.error
    expect(replayed.value.issues.get(issue.issue)?.submissions).toEqual([selected])
  })

  it('rejects duplicate submissions and dangling event links', async () => {
    const duplicateManager = await manager('duplicate-owner')
    const duplicateOwner = duplicateManager.getSessionId()
    const duplicateIssue = emptyIssue(duplicateOwner, 'duplicate')
    let head = duplicateManager.appendCustomEntry(deliveryCheckpointEntryType, duplicateIssue)
    const record = submission(duplicateIssue.issue, 'worker', 1, 'once')
    head = duplicateManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: duplicateOwner,
        issue: duplicateIssue.issue,
        previous: head,
        submission: record,
      }),
    )
    duplicateManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: duplicateOwner,
        issue: duplicateIssue.issue,
        previous: head,
        submission: record,
      }),
    )
    const duplicate = readDeliveryJournal(duplicateManager.getBranch(), duplicateOwner)
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.message).toContain('already recorded')

    const danglingManager = await manager('dangling-owner')
    const danglingOwner = danglingManager.getSessionId()
    const danglingIssue = emptyIssue(danglingOwner, 'dangling')
    danglingManager.appendCustomEntry(deliveryCheckpointEntryType, danglingIssue)
    danglingManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: danglingOwner,
        issue: danglingIssue.issue,
        previous: 'missing-entry',
        submission: submission(danglingIssue.issue, 'worker', 1, 'dangling'),
      }),
    )
    const dangling = readDeliveryJournal(danglingManager.getBranch(), danglingOwner)
    expect(dangling.ok).toBe(false)
    if (!dangling.ok) expect(dangling.error.message).toContain('disconnected')
  })

  it('refreshes integration idempotently without changing immutable evidence', async () => {
    const sessionManager = await manager()
    const owner = sessionManager.getSessionId()
    const issue = emptyIssue(owner, 'immutable-refresh')
    let head = sessionManager.appendCustomEntry(deliveryCheckpointEntryType, issue)
    const original = submission(issue.issue, 'worker', 1, 'immutable-record')
    head = sessionManager.appendCustomEntry(
      deliveryJournalEntryType,
      event({
        version: 1,
        kind: 'record',
        ownerSessionId: owner,
        issue: issue.issue,
        previous: head,
        submission: original,
      }),
    )
    const integrations: readonly DeliverySubmission['integration'][] = ['integrated', 'integrated']
    for (const integration of integrations) {
      head = sessionManager.appendCustomEntry(
        deliveryJournalEntryType,
        event({
          version: 1,
          kind: 'refresh',
          ownerSessionId: owner,
          issue: issue.issue,
          previous: head,
          agentId: original.agentId,
          attempt: original.attempt,
          integration,
        }),
      )
    }

    const replayed = readDeliveryJournal(sessionManager.getBranch(), owner)
    if (!replayed.ok) throw replayed.error
    const refreshed = replayed.value.issues.get(issue.issue)?.submissions[0]
    expect(refreshed).toEqual({ ...original, integration: 'integrated' })
    expect(refreshed?.recordedAt).toBe(original.recordedAt)
    expect(replayed.value.heads.get(issue.issue)).toBe(head)
    const refreshData = customEntries(sessionManager, deliveryJournalEntryType).at(-1)?.data
    expect(Object.keys(refreshData ?? {}).sort()).toEqual([
      'agentId',
      'attempt',
      'integration',
      'issue',
      'kind',
      'ownerSessionId',
      'previous',
      'version',
    ])
  })
})
