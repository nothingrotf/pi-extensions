import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import {
  type RunRecord,
  RuntimeStateSchema,
  RuntimeStateV1Schema,
  type RuntimeState,
} from './schema.ts'

const STATE_TYPE = 'pi-subagent-state'
const MAX_RECORDS = 256

type OwnerContext = Pick<ExtensionContext, 'sessionManager'>

export function recentRecords(records: readonly RunRecord[]): RunRecord[] {
  return [...records].sort((left, right) => left.updatedAt - right.updatedAt).slice(-MAX_RECORDS)
}

interface DecodedState {
  migrated: boolean
  state: RuntimeState
}

function decodeState<Input>(data: Input): DecodedState | undefined {
  try {
    return { migrated: false, state: Value.Decode(RuntimeStateSchema, data) }
  } catch {}
  try {
    const legacy = Value.Decode(RuntimeStateV1Schema, data)
    return { migrated: true, state: { ...legacy, records: legacy.records, version: 2 } }
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

  restore(ctx: OwnerContext): void {
    const ownerSessionId = ctx.sessionManager.getSessionId()
    let restored: ReturnType<typeof decodeState>

    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== STATE_TYPE) continue
      const decoded = decodeState(entry.data)
      if (decoded === undefined) throw new Error('The persisted subagent state is invalid.')
      if (decoded.state.ownerSessionId === ownerSessionId) restored = decoded
    }

    this.ownerSessionId = ownerSessionId
    this.records = new Map()
    for (const record of recentRecords(restored?.state.records ?? [])) {
      if (record.ownerSessionId === ownerSessionId) this.records.set(record.agentId, record)
    }

    const now = Date.now()
    let changed = restored?.migrated ?? false
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

  ensureOwner(ctx: OwnerContext): void {
    const ownerSessionId = ctx.sessionManager.getSessionId()
    if (this.ownerSessionId.length === 0) {
      this.restore(ctx)
      return
    }
    if (this.ownerSessionId !== ownerSessionId) {
      throw new Error('The extension context does not belong to the active parent session.')
    }
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
      version: 2,
    })
  }
}
