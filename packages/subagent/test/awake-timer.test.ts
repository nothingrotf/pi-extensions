import { describe, expect, it } from 'vite-plus/test'

import { setAwakeTimeout } from '../src/awake-timer.ts'

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function firedAt(start: number, fired: () => number | undefined): Promise<number> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const at = fired()
    if (at !== undefined) return at - start
    await delay(10)
  }
  throw new Error('The awake timeout never fired.')
}

describe('awake timeout', () => {
  it('fires after the awake duration', async () => {
    const start = Date.now()
    let at: number | undefined
    setAwakeTimeout(() => (at = Date.now()), 100, { tickMs: 20 })
    expect(await firedAt(start, () => at)).toBeGreaterThanOrEqual(95)
  })

  it('does not count a clock jump from system sleep', async () => {
    let offset = 0
    const start = Date.now()
    let at: number | undefined
    setAwakeTimeout(() => (at = Date.now()), 100, {
      now: () => Date.now() + offset,
      tickMs: 20,
    })
    offset = 6 * 60 * 60 * 1000
    expect(await firedAt(start, () => at)).toBeGreaterThanOrEqual(80)
  })

  it('never fires after cancellation', async () => {
    let fired = 0
    const cancel = setAwakeTimeout(() => (fired += 1), 20, { tickMs: 5 })
    cancel()
    await delay(60)
    expect(fired).toBe(0)
  })
})
