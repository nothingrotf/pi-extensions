import { createHash, randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vite-plus/test'

import { evaluationCases } from '../evaluation/cases.ts'
import { compareCompaction, type ComparisonTrial } from '../evaluation/compare.ts'

const live = process.env.COMPACT_EVAL_LIVE === '1'

test.skipIf(!live)(
  'compares synthetic full, deterministic, and hybrid contexts with a real provider',
  async () => {
    const provider = process.env.COMPACT_EVAL_PROVIDER ?? process.env.PI_PROVIDER
    const modelId = process.env.COMPACT_EVAL_MODEL ?? process.env.PI_MODEL
    if (!provider || !modelId)
      throw new Error('Set COMPACT_EVAL_PROVIDER and COMPACT_EVAL_MODEL for live evaluation.')
    const runtime = await ModelRuntime.create({ allowModelNetwork: false })
    const model = runtime.getModel(provider, modelId)
    if (!model) throw new Error(`Evaluation model is unavailable: ${provider}/${modelId}`)
    const repeats = Number(process.env.COMPACT_EVAL_REPEATS ?? '1')
    const path =
      process.env.COMPACT_EVAL_OUTPUT ?? join(tmpdir(), `compact-evaluation-${randomUUID()}.json`)
    const trials: ComparisonTrial[] = []
    const report = {
      version: 1,
      createdAt: new Date().toISOString(),
      provider,
      model: model.id,
      repeats,
      corpusHash: createHash('sha256').update(JSON.stringify(evaluationCases)).digest('hex'),
      methodology:
        'Synthetic fixed-choice continuation probes. One model for extraction and all probes. Fixed gold answers never sent to the model. Same retained boundary and character budget. Rotating probe order. No recall tools. Full context is a control, not an assumption of perfect answers. Token counts and cost are provider-reported. Zero cost does not imply free inference.',
      trials,
    }
    process.stdout.write(`Live compact evaluation: ${provider}/${model.id}; report: ${path}\n`)
    await compareCompaction(
      (context, signal) =>
        runtime.complete(model, context, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
          maxTokens: Math.min(4096, model.maxTokens),
          cacheRetention: 'none',
          sessionId: randomUUID(),
        }),
      {
        signal: AbortSignal.timeout(1_100_000),
        repeats,
        timeoutMs: 45_000,
        onTrial(trial) {
          trials.push(trial)
          writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
          process.stdout.write(
            `${trial.scenario}: ${trial.measurements.map((measurement) => `${measurement.mode}=${measurement.correct}/${measurement.total} invalid=${measurement.invalid} enrichment=${measurement.enrichment?.outcome ?? 'none'}`).join(' ')}\n`,
          )
        },
      },
    )
    expect(trials).toHaveLength(evaluationCases.length * repeats)
    expect(
      trials.flatMap((trial) => trial.measurements).filter((measurement) => measurement.error),
    ).toEqual([])
  },
  1_200_000,
)
