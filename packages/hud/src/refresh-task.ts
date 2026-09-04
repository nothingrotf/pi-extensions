export class RefreshTask<Value> {
  private active = true
  private pending = false
  private controller: AbortController | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private refreshScheduled = false

  constructor(
    private readonly read: (signal: AbortSignal) => Promise<Value> | null,
    private readonly publish: (value: Value) => void,
    private readonly intervalMs: number,
  ) {}

  request(): void {
    if (!this.active) return
    if (this.controller !== undefined) {
      this.pending = true
      return
    }
    if (!this.refreshScheduled) this.schedule(25, true)
  }

  stop(): void {
    this.active = false
    this.pending = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.refreshScheduled = false
    this.controller?.abort()
    this.controller = undefined
  }

  private schedule(delay: number, refresh = false): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.refreshScheduled = refresh
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.refreshScheduled = false
      this.run().catch(() => undefined)
    }, delay)
    this.timer.unref()
  }

  private async run(): Promise<void> {
    if (!this.active) return
    const controller = new AbortController()
    this.controller = controller
    try {
      const task = this.read(controller.signal)
      if (task === null) {
        this.stop()
        return
      }
      const value = await task
      if (this.active && !controller.signal.aborted) this.publish(value)
    } finally {
      if (this.controller === controller) this.controller = undefined
      if (this.active) {
        const pending = this.pending
        this.pending = false
        this.schedule(pending ? 25 : this.intervalMs, pending)
      }
    }
  }
}
