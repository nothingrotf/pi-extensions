import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { expect, it } from 'vite-plus/test'

const execute = promisify(execFile)
const CacheUsageSchema = Type.Object({
  entries: Type.Integer(),
  estimatedBytes: Type.Number(),
  maximumBytes: Type.Number(),
})
const CacheSchema = Type.Object({
  ...CacheUsageSchema.properties,
  metadata: CacheUsageSchema,
})
const MeasurementSchema = Type.Object({
  mode: Type.String(),
  sessions: Type.Integer(),
  baselineHeap: Type.Number(),
  filledHeap: Type.Number(),
  churnHeap: Type.Number(),
  clearedHeap: Type.Number(),
  retainedDelta: Type.Number(),
  sampledPeakHeap: Type.Number(),
  maximumRssBytes: Type.Number(),
  filledCache: CacheSchema,
  churnCache: CacheSchema,
  clearedCache: CacheSchema,
})

it.skipIf(process.env.SESSION_HISTORY_HEAP !== '1').each(['blocks', 'payloads', 'previews'])(
  'measures retained heap and eviction under %s cache churn',
  async (mode) => {
    const worker = fileURLToPath(new URL('./fixtures/heap-worker.ts', import.meta.url))
    const { stdout } = await execute(
      process.execPath,
      ['--expose-gc', '--experimental-transform-types', worker, mode],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
    )
    const parsed: unknown = JSON.parse(stdout)
    const result = Value.Decode(MeasurementSchema, parsed)
    expect(result.sessions).toBe(32)
    expect(result.filledCache.entries).toBeGreaterThan(0)
    expect(result.filledCache.entries).toBeLessThan(result.sessions)
    expect(result.filledCache.estimatedBytes).toBeLessThanOrEqual(result.filledCache.maximumBytes)
    expect(result.churnCache.estimatedBytes).toBeLessThanOrEqual(result.churnCache.maximumBytes)
    if (mode === 'previews')
      expect(result.retainedDelta).toBeLessThan(result.churnCache.maximumBytes)
    expect(result.churnCache.metadata.estimatedBytes).toBeLessThanOrEqual(
      result.churnCache.metadata.maximumBytes,
    )
    expect(result.clearedCache.metadata.entries).toBe(0)
    expect(result.clearedCache.entries).toBe(0)
    expect(result.clearedCache.estimatedBytes).toBe(0)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  },
  70000,
)
