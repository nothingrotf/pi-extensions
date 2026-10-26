export interface AwakeTimeoutOptions {
  now?: () => number
  tickMs?: number
}

const DEFAULT_TICK_MS = 15_000
const SUSPENDED_TICK_FACTOR = 4

export function setAwakeTimeout(
  callback: () => void,
  durationMs: number,
  options: AwakeTimeoutOptions = {},
): () => void {
  const now = options.now ?? Date.now
  const tickMs = Math.max(1, Math.min(options.tickMs ?? DEFAULT_TICK_MS, durationMs))
  const suspendedAfterMs = tickMs * SUSPENDED_TICK_FACTOR
  let last = now()
  let elapsed = 0
  let settled = false
  const interval = setInterval(() => {
    const current = now()
    const delta = Math.max(0, current - last)
    last = current
    elapsed += delta > suspendedAfterMs ? tickMs : delta
    if (elapsed < durationMs) return
    settled = true
    clearInterval(interval)
    callback()
  }, tickMs)
  return () => {
    if (settled) return
    settled = true
    clearInterval(interval)
  }
}
