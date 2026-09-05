import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { expect, it } from 'vite-plus/test'

const execute = promisify(execFile)
const ResultSchema = Type.Object({
  cancelled: Type.Boolean(),
  totalMs: Type.Number(),
  abortDelayMs: Type.Number(),
  sessions: Type.Integer(),
  payloadBytes: Type.Number(),
})

it.skipIf(process.env.SESSION_HISTORY_EVAL !== '1')(
  'measures mid-discovery cancellation on 32 MiB of history',
  async () => {
    const worker = fileURLToPath(new URL('./fixtures/cancellation-worker.ts', import.meta.url))
    const { stdout } = await execute(process.execPath, ['--experimental-transform-types', worker], {
      timeout: 30000,
    })
    const parsed: unknown = JSON.parse(stdout)
    const result = Value.Decode(ResultSchema, parsed)
    expect(result.cancelled).toBe(true)
    expect(result.sessions).toBe(32)
    process.stdout.write(`${JSON.stringify({ cancellation: result })}\n`)
  },
  40000,
)
