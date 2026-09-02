import type {
  AgentToolUpdateCallback,
  EventBus,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'

import { type JobProgressDetails, type JobSnapshot, jobTitle, toJobSnapshot } from './jobs.ts'
import type { SubagentRuntime } from './runtime.ts'

const TICK_MS = 1000

export interface JobProgressSource {
  listSnapshots: SubagentRuntime['listSnapshots']
  subscribe: SubagentRuntime['subscribe']
}

export const WORKING_MESSAGE_EVENT = 'hud:working-message'

let workingMessageOwner: symbol | undefined

export interface JobProgressHost {
  events?: Pick<EventBus, 'emit'> | undefined
  hasUI: boolean
  ui: Pick<ExtensionUIContext, 'setWorkingMessage'>
}

export class JobProgress {
  private readonly token = Symbol('job-progress')
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
    this.setWorkingMessage(undefined)
  }

  private setWorkingMessage(message: string | undefined): void {
    if (!this.ctx.hasUI) return
    if (message === undefined) {
      if (workingMessageOwner !== this.token) return
      workingMessageOwner = undefined
    } else {
      workingMessageOwner = this.token
    }
    this.ctx.ui.setWorkingMessage(message)
    this.ctx.events?.emit(WORKING_MESSAGE_EVENT, message ?? null)
  }

  private publish(): void {
    if (this.stopped || this.agentIds.size === 0) return
    const jobs = this.jobs()
    const title = jobTitle(jobs)
    const running = jobs.some((job) => job.status === 'running')
    this.setWorkingMessage(
      running ? `${title[0]?.toUpperCase() ?? ''}${title.slice(1)}` : undefined,
    )
    this.onUpdate?.({
      content: [{ text: title, type: 'text' }],
      details: { jobs, status: 'progress' },
    })
  }
}
