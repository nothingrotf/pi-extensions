import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { AnimationClock, animationTickMs } from '../src/animation-clock.ts'

describe('AnimationClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('starts at tick zero', () => {
    expect(new AnimationClock().tick()).toBe(0)
  })

  test('advances in seventy millisecond steps', () => {
    const clock = new AnimationClock()
    const unsubscribe = clock.subscribe(() => undefined)
    vi.advanceTimersByTime(animationTickMs - 1)
    expect(clock.tick()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(clock.tick()).toBe(1)
    vi.advanceTimersByTime(animationTickMs * 3)
    expect(clock.tick()).toBe(4)
    unsubscribe()
  })

  test('notifies every subscriber after each tick', () => {
    const clock = new AnimationClock()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = clock.subscribe(first)
    const stopSecond = clock.subscribe(second)
    vi.advanceTimersByTime(animationTickMs * 2)
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(2)
    stopFirst()
    stopSecond()
  })

  test('stops after the last subscriber leaves', () => {
    const clock = new AnimationClock()
    const stopFirst = clock.subscribe(() => undefined)
    const stopSecond = clock.subscribe(() => undefined)
    stopFirst()
    vi.advanceTimersByTime(animationTickMs)
    expect(clock.tick()).toBe(1)
    stopSecond()
    vi.advanceTimersByTime(animationTickMs * 4)
    expect(clock.tick()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('continues its phase after a later subscription', () => {
    const clock = new AnimationClock()
    const stop = clock.subscribe(() => undefined)
    vi.advanceTimersByTime(animationTickMs * 2)
    stop()
    const stopLater = clock.subscribe(() => undefined)
    vi.advanceTimersByTime(animationTickMs * 3)
    expect(clock.tick()).toBe(5)
    stopLater()
  })

  test('unsubscribes idempotently', () => {
    const clock = new AnimationClock()
    const stop = clock.subscribe(() => undefined)
    stop()
    stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
