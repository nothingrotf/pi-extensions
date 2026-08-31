import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import { type RunRecord, RuntimeStateSchema } from './schema.ts'

const STATE_TYPE = 'pi-subagent-state'
const MAX_RECORDS = 256

export function recentRecords(records: readonly RunRecord[]): RunRecord[] {
  return [...records].sort((left, right) => left.updatedAt - right.updatedAt).slice(-MAX_RECORDS)
}

function decodeState<Input>(data: Input) {
  try {
    return Value.Decode(RuntimeStateSchema, data)
  } catch {
    return undefined
  }
}

export class StateStore {
  private ownerSessionId = ''
  private records = new Map<string, RunRecord>()

  constructor(private readonly pi: ExtensionAPI) {}

  get owner(): string {
    return this.ownerSessionId
  }

  restore(ctx: ExtensionContext): void {
    const ownerSessionId = ctx.sessionManager.getSessionId()
    let restored: ReturnType<typeof decodeState>

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== STATE_TYPE) continue
      const state = decodeState(entry.data)
      if (state?.ownerSessionId === ownerSessionId) restored = state
    }

    this.ownerSessionId = ownerSessionId
    this.records = new Map()
    for (const record of recentRecords(restored?.records ?? [])) {
      if (record.ownerSessionId === ownerSessionId) this.records.set(record.agentId, record)
    }

    const now = Date.now()
    let changed = false
    for (const record of this.records.values()) {
      if (record.status !== 'running') continue
      this.records.set(record.agentId, {
        ...record,
        error: 'Interrupted by session reload.',
        status: 'aborted',
        updatedAt: now,
      })
      changed = true
    }

    if (changed) this.persist()
  }

  ensureOwner(ctx: ExtensionContext): void {
    if (this.ownerSessionId !== ctx.sessionManager.getSessionId()) this.restore(ctx)
  }

  get(agentId: string): RunRecord | undefined {
    return this.records.get(agentId)
  }

  add(record: RunRecord): void {
    if (this.records.size >= MAX_RECORDS) this.prune()
    if (this.records.size >= MAX_RECORDS) {
      throw new Error(`The parent session already contains ${MAX_RECORDS} child records.`)
    }
    this.records.set(record.agentId, record)
    this.persist()
  }

  update(record: RunRecord): void {
    this.records.delete(record.agentId)
    this.records.set(record.agentId, record)
    this.persist()
  }

  all(): readonly RunRecord[] {
    return [...this.records.values()]
  }

  private prune(): void {
    for (const [agentId, record] of this.records) {
      if (record.status === 'running') continue
      this.records.delete(agentId)
      if (this.records.size < MAX_RECORDS) return
    }
  }

  private persist(): void {
    this.pi.appendEntry(STATE_TYPE, {
      ownerSessionId: this.ownerSessionId,
      records: this.all(),
      version: 1,
    })
  }
}
