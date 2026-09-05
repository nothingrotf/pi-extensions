import { setImmediate } from 'node:timers/promises'

export const historyLimits = {
  concurrentFiles: 8,
  fileBytes: 32 * 1024 * 1024,
  requestBytes: 128 * 1024 * 1024,
  entries: 100000,
  sessions: 100,
  discoverySessions: 1000,
  milliseconds: 10000,
}

export class WorkLimitError extends Error {
  readonly code = 'WORK_LIMIT_EXCEEDED'
  constructor() {
    super('The history work limit was reached. Narrow the requested sessions or filters.')
  }
}

export class HistoryWork {
  private bytes = 0
  private entries = 0
  private readonly started = performance.now()

  constructor(readonly signal?: AbortSignal) {}

  usage() {
    return { bytesRead: this.bytes, visitedEntries: this.entries }
  }

  check(): void {
    this.signal?.throwIfAborted()
    if (performance.now() - this.started > historyLimits.milliseconds) throw new WorkLimitError()
  }

  read(bytes: number): void {
    this.check()
    this.bytes += bytes
    if (this.bytes > historyLimits.requestBytes) throw new WorkLimitError()
  }

  normalize(entries: number): void {
    this.check()
    this.entries += entries
    if (this.entries > historyLimits.entries) throw new WorkLimitError()
  }

  async yield(): Promise<void> {
    await setImmediate()
    this.check()
  }
}
