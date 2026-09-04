export const animationTickMs = 70

export class AnimationClock {
  private value = 0
  private readonly subscribers = new Set<() => void>()
  private timer: ReturnType<typeof setInterval> | undefined

  subscribe(subscriber: () => void): () => void {
    this.subscribers.add(subscriber)
    if (this.timer === undefined) {
      this.timer = setInterval(() => {
        this.value += 1
        for (const notify of this.subscribers) notify()
      }, animationTickMs)
    }
    return () => {
      this.subscribers.delete(subscriber)
      if (this.subscribers.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }

  tick(): number {
    return this.value
  }
}
