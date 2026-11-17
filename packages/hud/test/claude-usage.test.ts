import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { usageSegment } from '../src/render.ts'
import { fetchUsageForProvider } from '../src/usage.ts'

const theme = { fg: (_color: string, text: string) => text }

describe('Claude usage response compatibility', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'hud-claude-usage-'))
    await writeFile(
      join(directory, 'auth.json'),
      JSON.stringify({ anthropic: { access: 'test-token' } }),
    )
    vi.stubEnv('PI_CODING_AGENT_DIR', directory)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })

  test.each([
    { five_hour: null, seven_day: { utilization: 37, resets_at: null } },
    { seven_day: { utilization: 37 } },
    { five_hour: {}, seven_day: { utilization: 37 } },
  ])('keeps weekly usage without a five-hour limit: %j', async (body) => {
    vi.stubGlobal('fetch', async () => Response.json(body))

    const usage = await fetchUsageForProvider('anthropic', undefined)

    expect(usage?.error).toBeUndefined()
    expect(usage?.windows).toEqual([{ label: 'wk', usedPercent: 37, resetsIn: undefined }])
    expect(usageSegment(theme, usage)).toBe('wk 37%')
  })

  test('accepts null resets and preserves real zero-percent limits', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ five_hour: { utilization: 0, resets_at: null }, seven_day: null }),
    )

    const usage = await fetchUsageForProvider('anthropic', undefined)

    expect(usage?.error).toBeUndefined()
    expect(usageSegment(theme, usage)).toBe('5h 0%')
  })

  test('accepts accounts without quota windows', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ five_hour: null, seven_day: null }))

    const usage = await fetchUsageForProvider('anthropic', undefined)

    expect(usage?.error).toBeUndefined()
    expect(usage?.windows).toEqual([])
    expect(usageSegment(theme, usage)).toBe('')
  })

  test('still rejects malformed quota windows', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ five_hour: null, seven_day: { utilization: { invalid: true } } }),
    )

    const usage = await fetchUsageForProvider('anthropic', undefined)

    expect(usage?.error).toBeDefined()
    expect(usage?.windows).toEqual([])
  })
})
