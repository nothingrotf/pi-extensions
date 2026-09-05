import { describe, expect, test } from 'vite-plus/test'

import { evaluationCases } from '../evaluation/cases.ts'
import { compareCompaction } from '../evaluation/compare.ts'
import { assistant } from './fixtures.ts'

describe('automatic comparison protocol', () => {
  test('uses identical probes without leaking gold answers and keeps failure denominators fixed', async () => {
    const calls: string[] = []
    let extractions = 0
    const trials = await compareCompaction(
      async (context) => {
        const serialized = JSON.stringify(context)
        expect(serialized).not.toMatch(/\\"answer\\"\s*:/)
        calls.push(serialized)
        if (context.systemPrompt?.startsWith('Extract a conservative semantic state patch')) {
          extractions++
          return assistant('{"upsert":[]}')
        }
        return assistant('{"answers":[]}')
      },
      { signal: new AbortController().signal },
    )
    expect(trials).toHaveLength(evaluationCases.length)
    expect(extractions).toBe(evaluationCases.length)
    expect(calls).toHaveLength(evaluationCases.length * 4)
    for (const trial of trials) {
      const scenario = evaluationCases.find((candidate) => candidate.id === trial.scenario)
      if (!scenario) throw new Error('Unknown evaluation scenario')
      expect(trial.measurements.map((measurement) => measurement.mode)).toEqual([
        'full',
        'deterministic',
        'hybrid',
      ])
      expect(trial.measurements.map((measurement) => measurement.total)).toEqual(
        Array(3).fill(scenario.questions.length),
      )
      for (const measurement of trial.measurements) {
        expect(measurement.correct).toBe(0)
        expect(measurement.invalid).toBe(scenario.questions.length)
        expect(measurement.contextCharacters).toBe(measurement.context.length)
      }
      const baseline = trial.measurements.find(
        (measurement) => measurement.mode === 'deterministic',
      )
      const hybrid = trial.measurements.find((measurement) => measurement.mode === 'hybrid')
      expect(hybrid?.enrichment?.outcome).toBe('applied')
      expect(hybrid?.context).toBe(baseline?.context)
      expect(baseline?.compactionUsage).toBeUndefined()
    }
  })

  test('records failed provider probes rather than dropping cases or claiming success', async () => {
    const trials = await compareCompaction(
      async () => {
        throw new Error('Private provider detail')
      },
      { signal: new AbortController().signal },
    )
    expect(trials).toHaveLength(evaluationCases.length)
    for (const measurement of trials.flatMap((trial) => trial.measurements)) {
      expect(measurement.invalid).toBe(measurement.total)
      expect(measurement.error).toBe('provider_failure')
      expect(JSON.stringify(measurement)).not.toContain('Private provider detail')
    }
  })

  test('validates run limits and cancels explicitly', async () => {
    await expect(
      compareCompaction(async () => assistant('{}'), {
        signal: new AbortController().signal,
        repeats: 6,
      }),
    ).rejects.toThrow('between 1 and 5')
    const controller = new AbortController()
    controller.abort()
    await expect(
      compareCompaction(async () => assistant('{}'), { signal: controller.signal }),
    ).rejects.toThrow(/abort/i)
  })
})
