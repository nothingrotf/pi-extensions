import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Value } from 'typebox/value'

import {
  type ArtifactRef,
  type CoordinationRunState,
  type CoordinationTaskState,
  type CoordinationTaskStateV3,
  type LegacyArtifactRef,
  type RunRecord,
  type RunRecordV3,
  RuntimeStateSchema,
  RuntimeStateV1Schema,
  RuntimeStateV2Schema,
  RuntimeStateV3Schema,
  type RuntimeState,
  type RuntimeStateV3,
} from './schema.ts'

const STATE_TYPE = 'pi-subagent-state'
const MAX_TERMINAL_RECORDS = 256
const MAX_TERMINAL_RUNS = 128

type OwnerContext = Pick<ExtensionContext, 'sessionManager'>

export function recentRecords(records: readonly RunRecord[]): RunRecord[] {
  const ordered = [...records].sort((left, right) => left.updatedAt - right.updatedAt)
  const running = ordered.filter((record) => record.status === 'running')
  const terminal = ordered
    .filter((record) => record.status !== 'running')
    .slice(-MAX_TERMINAL_RECORDS)
  return [...running, ...terminal].sort((left, right) => left.updatedAt - right.updatedAt)
}

export function recentRuns(runs: readonly CoordinationRunState[]): CoordinationRunState[] {
  const ordered = [...runs].sort((left, right) => left.updatedAt - right.updatedAt)
  const running = ordered.filter((run) => run.status === 'running')
  const terminal = ordered.filter((run) => run.status !== 'running').slice(-MAX_TERMINAL_RUNS)
  return [...running, ...terminal].sort((left, right) => left.updatedAt - right.updatedAt)
}

interface DecodedState {
  migrated: boolean
  state: RuntimeState
}

function migrateArtifact(artifact: LegacyArtifactRef, attempt: number): ArtifactRef {
  return { ...artifact, attempt }
}

function migrateRecord(record: RunRecordV3): RunRecord {
  const { artifact, ...rest } = record
  if (artifact === undefined) return rest
  return { ...rest, artifact: migrateArtifact(artifact, record.runGeneration ?? 1) }
}

function migrateTask(task: CoordinationTaskStateV3): CoordinationTaskState {
  const { artifact, ...rest } = task
  if (artifact === undefined) return rest
  return { ...rest, artifact: migrateArtifact(artifact, 1) }
}

function migrateV3(state: RuntimeStateV3): RuntimeState {
  return {
    ownerSessionId: state.ownerSessionId,
    records: state.records.map((record) => migrateRecord(record)),
    runs: (state.runs ?? []).map((run) => ({
      ...run,
      tasks: run.tasks.map((task) => migrateTask(task)),
    })),
    version: 4,
  }
}

function decodeState<Input>(data: Input): DecodedState | undefined {
  try {
    return { migrated: false, state: Value.Decode(RuntimeStateSchema, data) }
  } catch {}
  try {
    return { migrated: true, state: migrateV3(Value.Decode(RuntimeStateV3Schema, data)) }
  } catch {}
  try {
    const legacy = Value.Decode(RuntimeStateV2Schema, data)
    return { migrated: true, state: { ...legacy, records: legacy.records, version: 4 } }
  } catch {}
  try {
    const legacy = Value.Decode(RuntimeStateV1Schema, data)
    return { migrated: true, state: { ...legacy, records: legacy.records, version: 4 } }
  } catch {
    return undefined
  }
}

export class StateStore {
  private ownerSessionId = ''
  private records = new Map<string, RunRecord>()
  private runs = new Map<string, CoordinationRunState>()

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
    this.runs = new Map()
    for (const record of recentRecords(restored?.state.records ?? [])) {
      if (record.ownerSessionId === ownerSessionId) this.records.set(record.agentId, record)
    }
    for (const run of restored?.state.runs ?? []) {
      if (run.ownerSessionId === ownerSessionId) this.runs.set(run.runId, run)
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

    for (const run of this.runs.values()) {
      if (run.status !== 'running') continue
      this.runs.set(run.runId, {
        ...run,
        status: 'aborted',
        tasks: run.tasks.map((task) => {
          if (task.status === 'running') {
            return { ...task, error: 'Interrupted by session reload.', status: 'aborted' }
          }
          if (task.status === 'pending') {
            return { ...task, error: 'Blocked by session reload.', status: 'blocked' }
          }
          return task
        }),
        updatedAt: now,
      })
      changed = true
    }

    const runCount = this.runs.size
    this.pruneRuns()
    if (this.runs.size !== runCount) changed = true
    if (changed) {
      this.prune()
      this.persist()
    }
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
    this.records.set(record.agentId, record)
    this.prune()
    this.persist()
  }

  update(record: RunRecord): void {
    this.records.delete(record.agentId)
    this.records.set(record.agentId, record)
    this.prune()
    this.persist()
  }

  all(): readonly RunRecord[] {
    return [...this.records.values()]
  }

  maxRunGeneration(): number {
    return this.all().reduce((maximum, record) => Math.max(maximum, record.runGeneration ?? 0), 0)
  }

  addRun(run: CoordinationRunState): void {
    this.runs.set(run.runId, run)
    this.pruneRuns()
    this.persist()
  }

  getRun(runId: string): CoordinationRunState | undefined {
    return this.runs.get(runId)
  }

  updateRun(run: CoordinationRunState): void {
    if (!this.runs.has(run.runId))
      throw new Error(`Coordination run "${run.runId}" does not exist.`)
    this.runs.set(run.runId, run)
    this.pruneRuns()
    this.persist()
  }

  private prune(): void {
    const retained = recentRecords(this.all())
    this.records = new Map(retained.map((record) => [record.agentId, record]))
  }

  private pruneRuns(): void {
    this.runs = new Map(recentRuns([...this.runs.values()]).map((run) => [run.runId, run]))
  }

  private persist(): void {
    this.pi.appendEntry(STATE_TYPE, {
      ownerSessionId: this.ownerSessionId,
      records: this.all(),
      runs: [...this.runs.values()],
      version: 4,
    })
  }
}
