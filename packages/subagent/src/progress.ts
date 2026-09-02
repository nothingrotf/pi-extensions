import type { AgentToolUpdateCallback, ExtensionUIContext } from '@earendil-works/pi-coding-agent'

import { type JobProgressDetails, type JobSnapshot, jobTitle, toJobSnapshot } from './jobs.ts'
import type { SubagentRuntime } from './runtime.ts'

const TICK_MS = 1000
const STATUS_KEY = 'subagent'

export interface JobProgressSource {
  listSnapshots: SubagentRuntime['listSnapshots']
  subscribe: SubagentRuntime['subscribe']
}

export interface JobProgressHost {
  hasUI: boolean
  ui: Pick<ExtensionUIContext, 'setStatus'>
}

export class JobProgress {
  private readonly agentIds = new Set<string>()
  private readonly unsubscribe: () => void
  private timer: ReturnType<typeof setInterval> | undefined
  private stopped = false

  constructor(
    private readonly runtime: JobProgressSource,
    private readonly ctx: JobProgressHost,
    private readonly onUpdate: AgentToolUpdateCallback<JobProgressDetails> | undefined,
  ) {
    this.unsubscribe = runtime.subscribe(() => this.publish())
  }

  readonly started = (agentId: string): void => {
    if (this.stopped) return
    this.agentIds.add(agentId)
    if (this.timer === undefined) {
      this.timer = setInterval(() => this.publish(), TICK_MS)
    }
    this.publish()
  }

  jobs(now = Date.now()): JobSnapshot[] {
    const jobs: JobSnapshot[] = []
    for (const snapshot of this.runtime.listSnapshots()) {
      if (this.agentIds.has(snapshot.agentId)) jobs.push(toJobSnapshot(snapshot, now))
    }
    return jobs
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
    if (this.ctx.hasUI) this.ctx.ui.setStatus(STATUS_KEY, undefined)
  }

  private publish(): void {
    if (this.stopped || this.agentIds.size === 0) return
    const jobs = this.jobs()
    const title = jobTitle(jobs)
    if (this.ctx.hasUI) {
      const running = jobs.some((job) => job.status === 'running')
      this.ctx.ui.setStatus(STATUS_KEY, running ? title : undefined)
    }
    this.onUpdate?.({
      content: [{ text: title, type: 'text' }],
      details: { jobs, status: 'progress' },
    })
  }
}
