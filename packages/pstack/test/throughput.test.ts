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

function measure(deliveries: readonly unknown[]) {
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
    expect(report.candidate.medianTimeToAcceptanceMs).toBe(660)
    expect(report.candidate.medianUnblockedWallMs).toBe(610)
    expect(report.candidate.medianCorrectiveWorkMs).toBe(110)
    expect(report.candidate.firstPassAcceptanceRate).toBe(0.5)
    expect(report.pilot.comparable).toBe(true)
    expect(report.pilot.descriptiveReductionPercent).toBeCloseTo(40)
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
    expect(report.candidate).toMatchObject({ accepted: 1, blocked: 1, open: 1 })
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
    expect(measure([baseline[0], candidate[0]]).pilot.descriptiveReductionPercent).toBeNull()
    expect(measure([]).candidate.medianTimeToAcceptanceMs).toBeNull()
  })

  it.each([
    '{',
    JSON.stringify({ version: 2, deliveries: [] }),
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
