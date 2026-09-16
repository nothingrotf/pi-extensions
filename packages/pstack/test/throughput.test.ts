import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

import { parseMeasurements, reportThroughput } from '../src/throughput.ts'

const execFileAsync = promisify(execFile)

function accepted(issue: string, cohort: 'baseline' | 'candidate', duration: number) {
  return {
    issue,
    cohort,
    complexity: 'integration',
    implementationModel: 'test/implementation',
    startedAt: 100,
    blockingMs: 0,
    state: 'accepted',
    acceptedAt: 100 + duration,
    correctiveWorkMs: 20,
    firstReviewFindings: 0,
    artifact: `fixture/${issue}/tree`,
    reviewEvidence: `fixture/${issue}/review`,
    checksEvidence: `fixture/${issue}/checks`,
  }
}

function accountedDelivery(issue: string, cohort: 'baseline' | 'candidate', duration: number) {
  return {
    ...accepted(issue, cohort, duration),
    coordinatorModel: 'test/coordinator:medium',
    gates: ['independent-review', 'required-checks'],
    modelUsageEvidence: {
      source: `fixture/${issue}/model-usage`,
      coveredRoles: ['coordinator', 'implementation', 'review', 'retry', 'publication', 'advisory'],
      zeroUsageRoles: ['coordinator', 'review', 'retry', 'publication', 'advisory'],
      entries: [
        {
          agent: `agent/${issue}`,
          attempt: 'attempt-1',
          cacheTokens: 10,
          costUsd: 1,
          endedAt: 200,
          inputTokens: 100,
          model: 'test/implementation:high',
          outputTokens: 50,
          usageRole: 'implementation',
          startedAt: 150,
        },
      ],
    },
    reviewerModel: 'test/reviewer:xhigh',
    scenarios: ['durable-delivery'],
  }
}

function measure(deliveries: readonly object[]) {
  const result = parseMeasurements(JSON.stringify({ version: 1, deliveries }))
  if (!result.ok) throw new Error(result.error)
  return reportThroughput(result.measurements)
}

describe('delivery throughput evidence', () => {
  it('compares matched accepted samples using wall time rather than summed agent effort', () => {
    const report = measure([
      accepted('b1', 'baseline', 1000),
      accepted('b2', 'baseline', 1200),
      accepted('c1', 'candidate', 600),
      {
        ...accepted('c2', 'candidate', 720),
        firstReviewFindings: 2,
        correctiveWorkMs: 200,
        blockingMs: 100,
      },
    ])
    expect(report.baseline.medianTimeToAcceptanceMs).toBe(1100)
    expect(report.baseline.p90TimeToAcceptanceMs).toBe(1200)
    expect(report.baseline.p90TimeToAcceptanceSampleSize).toBe(2)
    expect(report.candidate.medianTimeToAcceptanceMs).toBe(660)
    expect(report.candidate.medianUnblockedWallMs).toBe(610)
    expect(report.candidate.medianCorrectiveWorkMs).toBe(110)
    expect(report.candidate.firstPassAcceptanceRate).toBe(0.5)
    expect(report.pilot.comparable).toBe(true)
    expect(report.pilot.descriptiveReductionPercent).toBeNull()
    expect(report.modelUsage).toMatchObject({
      accepted: { deliveries: 4, observedCostUsd: null },
      blocked: { deliveries: 0, observedCostUsd: null },
      open: { deliveries: 0, observedCostUsd: null },
    })
    expect(report.byImplementationModel).toHaveLength(2)
  })

  it('keeps blocked and unfinished work visible without reporting it as approval', () => {
    const report = measure([
      accepted('b1', 'baseline', 1000),
      accepted('b2', 'baseline', 1200),
      accepted('c1', 'candidate', 600),
      {
        issue: 'c2',
        cohort: 'candidate',
        complexity: 'integration',
        implementationModel: 'test/implementation',
        startedAt: 100,
        blockingMs: 50,
        state: 'blocked',
        observedAt: 500,
      },
      {
        issue: 'c3',
        cohort: 'candidate',
        complexity: 'integration',
        implementationModel: 'test/other',
        startedAt: 100,
        blockingMs: 0,
        state: 'open',
        observedAt: 500,
      },
    ])
    expect(report.candidate).toMatchObject({
      accepted: 1,
      blocked: 1,
      blockedRate: 1 / 3,
      incomplete: 2,
      incompleteRate: 2 / 3,
      open: 1,
      total: 3,
    })
    expect(report.pilot.minimumTwoCandidatesAccepted).toBe(false)
    expect(report.pilot.descriptiveReductionPercent).toBeNull()
    expect(
      report.byImplementationModel.find((group) => group.implementationModel === 'test/other')
        ?.medianTimeToAcceptanceMs,
    ).toBeNull()
  })

  it('does not conflate different complexity mixes or single-issue samples', () => {
    const baseline = [accepted('b1', 'baseline', 1000), accepted('b2', 'baseline', 1200)]
    const candidate = [
      accepted('c1', 'candidate', 600),
      { ...accepted('c2', 'candidate', 700), complexity: 'bounded' },
    ]
    expect(measure([...baseline, ...candidate]).pilot.descriptiveReductionPercent).toBeNull()
    expect(
      measure([
        accepted('single-baseline', 'baseline', 1000),
        accepted('single-candidate', 'candidate', 600),
      ]).pilot.descriptiveReductionPercent,
    ).toBeNull()
    expect(measure([]).candidate.medianTimeToAcceptanceMs).toBeNull()
  })

  it('derives P2 session telemetry and classifications from tool evidence', () => {
    const delivery = (issue: string, cohort: 'baseline' | 'candidate', duration: number) => ({
      ...accepted(issue, cohort, duration),
      correctionEvidence: [
        {
          classification: 'omitted-requirement',
          startedAt: 200,
          endedAt: 300,
        },
      ],
      gates: ['independent-review', 'required-checks'],
      scenarios: ['durable-delivery'],
      sessionEvidence: {
        source: `fixture/${issue}/session`,
        attempts: [
          {
            requestedAt: 100,
            executionStartedAt: 150,
            sessionSetupMs: 30,
            workspaceSetupMs: 20,
            events: [
              { at: 160, kind: 'read', target: 'docs/contract.md' },
              { at: 170, kind: 'read', target: 'docs/contract.md' },
              { at: 180, kind: 'compaction' },
              { at: 200, kind: 'edit' },
              { at: 220, kind: 'runtime-preflight', outcome: 'failed' },
            ],
          },
          {
            events: [{ at: 225, kind: 'runtime-preflight', outcome: 'failed' }],
          },
        ],
      },
    })
    const result = parseMeasurements(
      JSON.stringify({
        version: 2,
        deliveries: [
          delivery('b1', 'baseline', 1000),
          delivery('b2', 'baseline', 1200),
          delivery('c1', 'candidate', 600),
          delivery('c2', 'candidate', 700),
        ],
      }),
    )
    if (!result.ok) throw new Error(result.error)
    const report = reportThroughput(result.measurements)
    expect(report.sessionEvidence).toMatchObject({
      attempts: 8,
      compactions: 4,
      medianPreparationDurationMs: 50,
      medianSessionSetupMs: 30,
      medianTimeToFirstEditMs: 50,
      medianWorkspaceSetupMs: 20,
      repeatedReads: 4,
      withinAttemptRepeatedReads: 4,
      crossAttemptRepeatedReads: 0,
      runtimePreflightFailures: 8,
      runtimePreflightFailuresAfterModelStart: 4,
      runtimePreflightFailuresWithoutModelStart: 4,
    })
    expect(report.byCorrectionClassification).toContainEqual({
      classification: 'omitted-requirement',
      count: 4,
    })
    expect(report.pilot).toMatchObject({
      comparable: true,
      gatesMatch: true,
      scenariosMatch: true,
      operationalEvidenceAvailable: false,
      descriptiveReductionPercent: null,
    })
    expect(report.limitations).toContain('No delivery ledger evidence was supplied.')
    expect(report.limitations).toContain('No operational pilot evidence was supplied.')
    expect(report.contextRecommendations).toEqual([
      'Reuse an accepted owner and API inventory only when policy permits. Keep every explicitly mandated reading.',
      'Put open criteria and their necessary sources in the correction brief. Keep every explicitly mandated reading.',
    ])
  })

  it('withholds a version 2 comparison when gates or scenarios differ', () => {
    const delivery = (
      issue: string,
      cohort: 'baseline' | 'candidate',
      scenarios: readonly string[],
    ) => ({
      ...accepted(issue, cohort, 1000),
      gates: ['independent-review'],
      scenarios,
    })
    const result = parseMeasurements(
      JSON.stringify({
        version: 2,
        deliveryLedgerEvidence: 'fixture/delivery-ledger',
        operationalPilotEvidence: 'fixture/pilot',
        deliveries: [
          delivery('b1', 'baseline', ['durable-delivery']),
          delivery('b2', 'baseline', ['durable-delivery']),
          delivery('c1', 'candidate', ['durable-delivery']),
          delivery('c2', 'candidate', ['other-scenario']),
        ],
      }),
    )
    if (!result.ok) throw new Error(result.error)
    const report = reportThroughput(result.measurements)
    expect(report.pilot).toMatchObject({
      comparable: false,
      gatesMatch: true,
      scenariosMatch: false,
      descriptiveReductionPercent: null,
    })
  })

  it('counts repeated reads across attempts only within the same delivery', () => {
    const delivery = (issue: string, attempts: readonly object[]) => ({
      ...accepted(issue, 'candidate', 100),
      gates: ['required-checks'],
      scenarios: ['durable-delivery'],
      sessionEvidence: { source: `fixture/${issue}/session`, attempts },
    })
    const result = parseMeasurements(
      JSON.stringify({
        version: 2,
        deliveries: [
          delivery('same-delivery', [
            { events: [{ at: 110, kind: 'read', target: 'docs/contract.md' }] },
            { events: [{ at: 120, kind: 'read', target: 'docs/contract.md' }] },
          ]),
          delivery('different-delivery', [
            { events: [{ at: 110, kind: 'read', target: 'docs/contract.md' }] },
          ]),
        ],
      }),
    )
    if (!result.ok) throw new Error(result.error)
    expect(reportThroughput(result.measurements).sessionEvidence).toMatchObject({
      crossAttemptRepeatedReads: 1,
      repeatedReads: 0,
      withinAttemptRepeatedReads: 0,
    })
  })

  it('reports complete evidenced model usage and withholds savings for reviewer mismatch', () => {
    const baseline = [
      accountedDelivery('b1', 'baseline', 1000),
      accountedDelivery('b2', 'baseline', 1200),
    ]
    const candidate = [
      accountedDelivery('c1', 'candidate', 600),
      { ...accountedDelivery('c2', 'candidate', 700), reviewerModel: 'test/other-reviewer:xhigh' },
    ]
    const result = parseMeasurements(
      JSON.stringify({
        version: 3,
        deliveryLedgerEvidence: 'fixture/delivery-ledger',
        operationalPilotEvidence: 'fixture/pilot',
        deliveries: [...baseline, ...candidate],
      }),
    )
    if (!result.ok) throw new Error(result.error)
    const report = reportThroughput(result.measurements)
    expect(report.modelUsage).toMatchObject({
      accountingComplete: true,
      costPerAcceptedDeliveryUsd: 1,
      declaredRoles: [
        'coordinator',
        'implementation',
        'review',
        'retry',
        'publication',
        'advisory',
      ],
      totalObservedCostUsd: 4,
      usageEntriesWithKnownCost: 4,
      usageEntriesWithUnknownCost: 0,
    })
    expect(report.modelUsage.accepted).toMatchObject({ deliveries: 4, observedCostUsd: 4 })
    expect(report.modelUsage.blocked).toMatchObject({ deliveries: 0, observedCostUsd: null })
    expect(report.modelUsage.open).toMatchObject({ deliveries: 0, observedCostUsd: null })
    expect(report.pilot).toMatchObject({
      comparisonProfileMixMatches: false,
      comparable: false,
      descriptiveReductionPercent: null,
    })
  })

  it('keeps unknown costs and incomplete cohorts out of cost per accepted delivery', () => {
    const missingCost = {
      ...accountedDelivery('c1', 'candidate', 600),
      modelUsageEvidence: {
        source: 'fixture/c1/model-usage',
        coveredRoles: [
          'coordinator',
          'implementation',
          'review',
          'retry',
          'publication',
          'advisory',
        ],
        entries: [
          {
            agent: 'agent/c1',
            attempt: 'attempt-1',
            cacheTokens: 10,
            endedAt: 200,
            inputTokens: 100,
            model: 'test/implementation:high',
            outputTokens: 50,
            usageRole: 'implementation',
            startedAt: 150,
          },
        ],
      },
    }
    const blockedAccounting = accountedDelivery('c2', 'candidate', 700)
    const openAccounting = accountedDelivery('c3', 'candidate', 800)
    const blocked = {
      issue: 'c2',
      cohort: 'candidate',
      complexity: 'integration',
      implementationModel: 'test/implementation',
      startedAt: 100,
      blockingMs: 0,
      state: 'blocked',
      observedAt: 700,
      coordinatorModel: blockedAccounting.coordinatorModel,
      gates: blockedAccounting.gates,
      modelUsageEvidence: blockedAccounting.modelUsageEvidence,
      reviewerModel: blockedAccounting.reviewerModel,
      scenarios: blockedAccounting.scenarios,
    }
    const open = {
      issue: 'c3',
      cohort: 'candidate',
      complexity: 'integration',
      implementationModel: 'test/implementation',
      startedAt: 100,
      blockingMs: 0,
      state: 'open',
      observedAt: 800,
      coordinatorModel: openAccounting.coordinatorModel,
      gates: openAccounting.gates,
      reviewerModel: openAccounting.reviewerModel,
      scenarios: openAccounting.scenarios,
    }
    const result = parseMeasurements(
      JSON.stringify({
        version: 3,
        deliveries: [
          accountedDelivery('b1', 'baseline', 1000),
          accountedDelivery('b2', 'baseline', 1200),
          missingCost,
          blocked,
          open,
        ],
      }),
    )
    if (!result.ok) throw new Error(result.error)
    const report = reportThroughput(result.measurements)
    expect(report.modelUsage).toMatchObject({
      accountingComplete: false,
      costPerAcceptedDeliveryUsd: null,
      deliveriesWithoutAccounting: 1,
      totalObservedCostUsd: 3,
      usageEntriesWithKnownCost: 3,
      usageEntriesWithUnknownCost: 1,
    })
    expect(report.modelUsage).toMatchObject({
      accepted: { deliveries: 3, observedCostUsd: 2 },
      blocked: { deliveries: 1, observedCostUsd: 1 },
      open: { deliveries: 1, observedCostUsd: null },
    })
    expect(report.limitations).toContain('Model usage accounting does not cover every delivery.')
    expect(report.limitations).toContain('Some model usage costs are unknown.')
  })

  it('reports tokens and costs by cohort without treating partial role coverage as complete', () => {
    const partial = accountedDelivery('partial', 'candidate', 600)
    partial.modelUsageEvidence.coveredRoles = ['implementation']
    partial.modelUsageEvidence.zeroUsageRoles = []
    const parsed = parseMeasurements(
      JSON.stringify({
        version: 3,
        deliveries: [accountedDelivery('baseline', 'baseline', 900), partial],
      }),
    )
    if (!parsed.ok) throw new Error(parsed.error)
    const report = reportThroughput(parsed.measurements)
    expect(report.modelUsageByCohort.baseline).toMatchObject({
      accountingComplete: true,
      costPerAcceptedDeliveryUsd: 1,
      tokens: { input: 100, output: 50, cache: 10 },
    })
    expect(report.modelUsageByCohort.candidate).toMatchObject({
      accountingComplete: false,
      costPerAcceptedDeliveryUsd: null,
      tokens: { input: 100, output: 50, cache: 10 },
    })
    expect(report.modelUsage.tokens).toEqual({ input: 200, output: 100, cache: 20 })
  })

  it('does not equate empty or unobserved role accounting with complete free delivery', () => {
    for (const empty of [true, false]) {
      const delivery = accountedDelivery(`coverage-${empty}`, 'candidate', 600)
      if (empty) delivery.modelUsageEvidence.entries = []
      delivery.modelUsageEvidence.zeroUsageRoles = []
      const parsed = parseMeasurements(JSON.stringify({ version: 3, deliveries: [delivery] }))
      if (!parsed.ok) throw new Error(parsed.error)
      const usage = reportThroughput(parsed.measurements).modelUsage
      expect(usage.accountingComplete).toBe(false)
      expect(usage.costPerAcceptedDeliveryUsd).toBeNull()
      if (empty) expect(usage.totalObservedCostUsd).toBeNull()
    }
  })

  it.each([['implementation'], ['review', 'review'], ['unrecognized']])(
    'rejects contradictory or invalid zero-usage role declarations %j',
    (...zeroUsageRoles) => {
      const delivery = accountedDelivery('invalid-zero-usage', 'candidate', 600)
      delivery.modelUsageEvidence.zeroUsageRoles = zeroUsageRoles
      expect(parseMeasurements(JSON.stringify({ version: 3, deliveries: [delivery] })).ok).toBe(
        false,
      )
    },
  )

  it('rejects one agent attempt counted under different delivery sources', () => {
    const first = accountedDelivery('first', 'baseline', 900)
    const second = accountedDelivery('second', 'candidate', 600)
    second.modelUsageEvidence.entries = first.modelUsageEvidence.entries
    expect(parseMeasurements(JSON.stringify({ version: 3, deliveries: [first, second] })).ok).toBe(
      false,
    )
  })

  it('rejects corrupt and duplicate model usage accounting', () => {
    const corruptAccounting = accountedDelivery('corrupt', 'candidate', 100)
    const corrupt = {
      ...corruptAccounting,
      modelUsageEvidence: {
        ...corruptAccounting.modelUsageEvidence,
        entries: corruptAccounting.modelUsageEvidence.entries.map((entry) => ({
          ...entry,
          costUsd: -1,
        })),
      },
    }
    const duplicateAccounting = accountedDelivery('duplicate', 'candidate', 100)
    const duplicate = {
      ...duplicateAccounting,
      modelUsageEvidence: {
        ...duplicateAccounting.modelUsageEvidence,
        entries: duplicateAccounting.modelUsageEvidence.entries.flatMap((entry) => [entry, entry]),
      },
    }
    expect(parseMeasurements(JSON.stringify({ version: 3, deliveries: [corrupt] })).ok).toBe(false)
    expect(parseMeasurements(JSON.stringify({ version: 3, deliveries: [duplicate] })).ok).toBe(
      false,
    )
  })

  it.each([
    '{',
    JSON.stringify({
      version: 1,
      deliveries: [{ ...accepted('bad', 'baseline', 50), reviewEvidence: '' }],
    }),
    JSON.stringify({
      version: 1,
      deliveries: [{ ...accepted('bad', 'baseline', 50), acceptedAt: 90 }],
    }),
    JSON.stringify({
      version: 1,
      deliveries: [{ ...accepted('bad', 'baseline', 50), blockingMs: 100 }],
    }),
    JSON.stringify({
      version: 1,
      deliveries: [{ ...accepted('bad', 'baseline', 50), correctiveWorkMs: 40, blockingMs: 20 }],
    }),
    JSON.stringify({
      version: 1,
      deliveries: [accepted('same', 'baseline', 100), accepted('same', 'candidate', 50)],
    }),
    JSON.stringify({
      version: 2,
      deliveries: [
        {
          ...accepted('repeated-gate', 'baseline', 100),
          gates: ['required-checks', 'required-checks'],
          scenarios: ['durable-delivery'],
        },
      ],
    }),
    JSON.stringify({
      version: 2,
      deliveries: [
        {
          ...accepted('pre-start-tool', 'baseline', 100),
          gates: ['required-checks'],
          scenarios: ['durable-delivery'],
          sessionEvidence: {
            source: 'fixture/session',
            attempts: [
              {
                executionStartedAt: 110,
                events: [{ at: 109, kind: 'edit' }],
              },
            ],
          },
        },
      ],
    }),
  ])('rejects invalid or contradictory evidence before reporting %s', (text) => {
    expect(parseMeasurements(text).ok).toBe(false)
  })

  it('executes the real CLI and fails invalid input without a success report', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pstack-throughput-'))
    const path = join(directory, 'measurements.json')
    const cli = fileURLToPath(new URL('../src/throughput-cli.ts', import.meta.url))
    try {
      await writeFile(
        path,
        JSON.stringify({ version: 1, deliveries: [accepted('fixture', 'candidate', 100)] }),
      )
      const result = await execFileAsync('bun', [cli, path])
      expect(result.stderr).toBe('')
      expect(result.stdout).toContain('"candidateIssuesAccepted": 1')
      expect(result.stdout).toContain('"descriptiveReductionPercent": null')
      await writeFile(
        path,
        JSON.stringify({
          version: 2,
          deliveries: [
            {
              ...accepted('telemetry', 'candidate', 100),
              gates: ['required-checks'],
              scenarios: ['durable-delivery'],
              sessionEvidence: {
                source: 'fixture/session',
                attempts: [
                  {
                    requestedAt: 100,
                    executionStartedAt: 110,
                    events: [
                      { at: 120, kind: 'read', target: 'docs/contract.md' },
                      { at: 130, kind: 'read', target: 'docs/contract.md' },
                      { at: 140, kind: 'edit' },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      )
      const telemetryResult = await execFileAsync('bun', [cli, path])
      expect(telemetryResult.stdout).toContain('"repeatedReads": 1')
      expect(telemetryResult.stdout).toContain('"medianTimeToFirstEditMs": 30')
      const accounting = accountedDelivery('accounted', 'candidate', 100)
      await writeFile(path, JSON.stringify({ version: 3, deliveries: [accounting] }))
      const accountingResult = await execFileAsync('bun', [cli, path])
      expect(accountingResult.stdout).toContain('"totalObservedCostUsd": 1')
      expect(accountingResult.stdout).toContain('"p90TimeToAcceptanceMs": 100')
      const missingAccounting = {
        ...accepted('missing-accounting', 'candidate', 100),
        gates: ['required-checks'],
        scenarios: ['durable-delivery'],
      }
      await writeFile(path, JSON.stringify({ version: 3, deliveries: [missingAccounting] }))
      const missingAccountingResult = await execFileAsync('bun', [cli, path])
      expect(missingAccountingResult.stdout).toContain('"deliveriesWithoutAccounting": 1')
      expect(missingAccountingResult.stdout).toContain('"costPerAcceptedDeliveryUsd": null')
      const corrupt = {
        ...accounting,
        modelUsageEvidence: {
          ...accounting.modelUsageEvidence,
          entries: accounting.modelUsageEvidence.entries.map((entry) => ({
            ...entry,
            costUsd: -1,
          })),
        },
      }
      await writeFile(path, JSON.stringify({ version: 3, deliveries: [corrupt] }))
      await expect(execFileAsync('bun', [cli, path])).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'Measurements do not match a supported delivery schema.\n',
      })
      const duplicate = {
        ...accounting,
        modelUsageEvidence: {
          ...accounting.modelUsageEvidence,
          entries: accounting.modelUsageEvidence.entries.flatMap((entry) => [entry, entry]),
        },
      }
      await writeFile(path, JSON.stringify({ version: 3, deliveries: [duplicate] }))
      await expect(execFileAsync('bun', [cli, path])).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'Model usage accounting cannot repeat an agent attempt.\n',
      })
      await writeFile(path, 'secret-malformed-input')
      await expect(execFileAsync('bun', [cli, path])).rejects.toMatchObject({
        code: 1,
        stdout: '',
        stderr: 'Measurements must contain valid JSON.\n',
      })
      await expect(execFileAsync('bun', [cli])).rejects.toMatchObject({ code: 2 })
      await expect(execFileAsync('bun', [cli, join(directory, 'missing')])).rejects.toMatchObject({
        code: 1,
        stdout: '',
      })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })
})
