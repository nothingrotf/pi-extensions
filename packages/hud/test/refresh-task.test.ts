import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { RefreshTask } from '../src/refresh-task.ts'

describe('background refresh', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('does not postpone refresh indefinitely during a sustained event stream', async () => {
    let reads = 0
    const task = new RefreshTask(
      () => Promise.resolve(++reads),
      () => undefined,
      30_000,
    )
    for (let index = 0; index < 100; index += 1) {
      task.request()
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(reads).toBeGreaterThan(0)
    task.stop()
  })

  test('coalesces event bursts and never overlaps reads', async () => {
    const resolvers: ((value: number) => void)[] = []
    const published: number[] = []
    const task = new RefreshTask(
      () => new Promise<number>((resolve) => resolvers.push(resolve)),
      (value) => published.push(value),
      30_000,
    )
    for (let index = 0; index < 100; index += 1) task.request()
    await vi.advanceTimersByTimeAsync(25)
    expect(resolvers).toHaveLength(1)
    for (let index = 0; index < 100; index += 1) task.request()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(resolvers).toHaveLength(1)
    resolvers[0]?.(1)
    await vi.advanceTimersByTimeAsync(25)
    expect(published).toEqual([1])
    expect(resolvers).toHaveLength(2)
    resolvers[1]?.(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(published).toEqual([1, 2])
    task.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('cancels in-flight work and ignores late results after disposal', async () => {
    let resolveRead: ((value: number) => void) | undefined
    let signal: AbortSignal | undefined
    const published: number[] = []
    const task = new RefreshTask(
      (currentSignal) => {
        signal = currentSignal
        return new Promise<number>((resolve) => {
          resolveRead = resolve
        })
      },
      (value) => published.push(value),
      30_000,
    )
    task.request()
    await vi.advanceTimersByTimeAsync(25)
    task.stop()
    task.stop()
    expect(signal?.aborted).toBe(true)
    resolveRead?.(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(published).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  test('retries failed reads and releases unsupported providers', async () => {
    let reads = 0
    const published: number[] = []
    const task = new RefreshTask(
      () => {
        reads += 1
        if (reads === 1) return Promise.reject(new Error('offline'))
        if (reads === 2) return Promise.resolve(2)
        return null
      },
      (value) => published.push(value),
      100,
    )
    task.request()
    await vi.advanceTimersByTimeAsync(25)
    expect(published).toEqual([])
    await vi.advanceTimersByTimeAsync(100)
    expect(published).toEqual([2])
    await vi.advanceTimersByTimeAsync(100)
    expect(reads).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    task.request()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toBe(3)
  })
})
