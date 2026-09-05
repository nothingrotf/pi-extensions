import type { ExtensionAPI, ExtensionContext, SessionEntry } from '@earendil-works/pi-coding-agent'
import { type StaticDecode, Type } from 'typebox'
import { Value } from 'typebox/value'

import {
  type ArtifactRef,
  type CoordinationRunState,
  type CoordinationTaskState,
  type CoordinationTaskStateV3,
  type LegacyArtifactRef,
  type RunRecord,
  type RunRecordV3,
  type WorkspaceRecord,
  CoordinationRunStateSchema,
  decodeJsonValue,
  GateDefinitionSchema,
  RunRecordSchema,
  WorkspaceRecordSchema,
  RuntimeStateSchema,
  RuntimeStateV1Schema,
  RuntimeStateV2Schema,
  RuntimeStateV3Schema,
  RuntimeStateV4Schema,
  RuntimeStateV5Schema,
  type RuntimeState,
  type RuntimeStateV3,
  type RuntimeStateV4,
  type RuntimeStateV5,
} from './schema.ts'

const STATE_TYPE = 'pi-subagent-state'
const MAX_TERMINAL_RECORDS = 256
const MAX_TERMINAL_RUNS = 128
const CHECKPOINT_INTERVAL = 128
const DeltaVersionSchema = Type.Object({ version: Type.Literal(7) })

const DeltaSchema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  previous: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
  removedRecords: Type.Array(Type.String({ minLength: 1 })),
  removedRuns: Type.Array(Type.String({ minLength: 1 })),
  removedWorkspaces: Type.Array(Type.String({ minLength: 1 })),
  rootStores: Type.Array(Type.String({ minLength: 1 })),
  runs: Type.Array(CoordinationRunStateSchema),
  version: Type.Literal(7),
  workspaces: Type.Array(WorkspaceRecordSchema),
})

const RecordJsonFieldsSchema = Type.Pick(RunRecordSchema, [
  'execution',
  'gateResults',
  'structuredOutput',
])
const RecordsInputSchema = Type.Object({ records: Type.Array(Type.Unknown()) })

type StateDelta = StaticDecode<typeof DeltaSchema>
type StateChange = Partial<Omit<StateDelta, 'ownerSessionId' | 'previous' | 'version'>>

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
    rootStores: [],
    runs: (state.runs ?? []).map((run) => ({
      ...run,
      tasks: run.tasks.map((task) => migrateTask(task)),
    })),
    version: 6,
    workspaces: [],
  }
}

function migrateV4(state: RuntimeStateV4): RuntimeState {
  return {
    ...state,
    rootStores: [],
    runs: state.runs ?? [],
    version: 6,
    workspaces: [],
  }
}

function migrateV5(state: RuntimeStateV5): RuntimeState {
  const records = state.records.map((record) => migrateIsolationAttempts(record))
  const migrated: RuntimeState = {
    ownerSessionId: state.ownerSessionId,
    records,
    rootStores: [],
    runs: state.runs ?? [],
    version: 6,
    workspaces: [],
  }
  return migrated
}

function migrateIsolationAttempts(record: RunRecord): RunRecord {
  if (record.isolationAttempts !== undefined || record.isolation === undefined) return record
  return { ...record, isolationAttempts: [record.isolation] }
}

function decodeSnapshot<Input>(data: Input): DecodedState | undefined {
  try {
    return { migrated: false, state: Value.Decode(RuntimeStateSchema, data) }
  } catch {}
  try {
    return { migrated: true, state: migrateV5(Value.Decode(RuntimeStateV5Schema, data)) }
  } catch {}
  try {
    return { migrated: true, state: migrateV4(Value.Decode(RuntimeStateV4Schema, data)) }
  } catch {}
  try {
    return { migrated: true, state: migrateV3(Value.Decode(RuntimeStateV3Schema, data)) }
  } catch {}
  try {
    const legacy = Value.Decode(RuntimeStateV2Schema, data)
    return {
      migrated: true,
      state: {
        ...legacy,
        records: legacy.records,
        rootStores: [],
        runs: [],
        version: 6,
        workspaces: [],
      },
    }
  } catch {}
  try {
    const legacy = Value.Decode(RuntimeStateV1Schema, data)
    return {
      migrated: true,
      state: {
        ...legacy,
        records: legacy.records,
        rootStores: [],
        runs: [],
        version: 6,
        workspaces: [],
      },
    }
  } catch {
    return undefined
  }
}

function preserveGateJson<Input>(
  gate: StaticDecode<typeof GateDefinitionSchema>,
  input: Input,
): void {
  if (!Value.Check(GateDefinitionSchema, input)) return
  if (gate.type !== 'json-pointer' || input.type !== 'json-pointer') return
  if (gate.op === 'eq' && input.op === 'eq') gate.value = decodeJsonValue(input.value)
  if (gate.op === 'in' && input.op === 'in') {
    gate.values = input.values.map((value) => decodeJsonValue(value))
  }
}

function preserveRecordJson<Input>(records: RunRecord[], input: Input): void {
  if (!Value.Check(RecordsInputSchema, input)) return
  for (const [index, record] of records.entries()) {
    const raw = input.records[index]
    if (!Value.Check(RecordJsonFieldsSchema, raw)) continue
    if (record.structuredOutput !== undefined && raw.structuredOutput?.data !== undefined) {
      record.structuredOutput.data = decodeJsonValue(raw.structuredOutput.data)
    }
    const execution = record.execution
    const rawExecution = raw.execution
    if (
      execution !== undefined &&
      execution.version !== 1 &&
      rawExecution !== undefined &&
      rawExecution.version !== 1
    ) {
      if (rawExecution.outputSchema !== undefined) {
        execution.outputSchema = decodeJsonValue(rawExecution.outputSchema)
      }
      for (const [gateIndex, gate] of execution.gates.entries()) {
        preserveGateJson(gate, rawExecution.gates[gateIndex])
      }
    }
    for (const [gateIndex, result] of (record.gateResults ?? []).entries()) {
      preserveGateJson(result.gate, raw.gateResults?.[gateIndex]?.gate)
    }
  }
}

function decodeState<Input>(data: Input): DecodedState | undefined {
  const decoded = decodeSnapshot(data)
  if (decoded === undefined) return undefined
  try {
    preserveRecordJson(decoded.state.records, data)
    return decoded
  } catch {
    return undefined
  }
}

function readHistory(
  branch: readonly SessionEntry[],
  ownerSessionId: string,
  collect?: (state: RuntimeState) => void,
): DecodedState | undefined {
  const previous = new Map<string, string>()
  let restored: DecodedState | undefined
  let records = new Map<string, RunRecord>()
  let runs = new Map<string, CoordinationRunState>()
  let workspaces = new Map<string, WorkspaceRecord>()
  let rootStores = new Set<string>()
  const snapshot = (): RuntimeState => ({
    ownerSessionId,
    records: [...records.values()].sort((left, right) => left.updatedAt - right.updatedAt),
    rootStores: [...rootStores],
    runs: [...runs.values()].sort((left, right) => left.updatedAt - right.updatedAt),
    version: 6,
    workspaces: [...workspaces.values()],
  })
  for (const entry of branch) {
    if (entry.type !== 'custom' || entry.customType !== STATE_TYPE) continue
    let delta: StateDelta | undefined
    if (Value.Check(DeltaVersionSchema, entry.data)) {
      try {
        delta = Value.Decode(DeltaSchema, entry.data)
        preserveRecordJson(delta.records, entry.data)
      } catch {
        throw new Error('The persisted subagent state is invalid.')
      }
    }
    if (delta !== undefined) {
      if (previous.get(delta.ownerSessionId) !== delta.previous) {
        throw new Error('The persisted subagent state journal is disconnected.')
      }
      previous.set(delta.ownerSessionId, entry.id)
      if (delta.ownerSessionId !== ownerSessionId) continue
      for (const id of delta.removedRecords) records.delete(id)
      for (const record of delta.records) records.set(record.agentId, record)
      for (const id of delta.removedRuns) runs.delete(id)
      for (const run of delta.runs) runs.set(run.runId, run)
      for (const id of delta.removedWorkspaces) workspaces.delete(id)
      for (const workspace of delta.workspaces) workspaces.set(workspace.workspaceId, workspace)
      for (const root of delta.rootStores) rootStores.add(root)
    } else {
      const decoded = decodeState(entry.data)
      if (decoded === undefined) throw new Error('The persisted subagent state is invalid.')
      previous.set(decoded.state.ownerSessionId, entry.id)
      if (decoded.state.ownerSessionId !== ownerSessionId) continue
      restored = decoded
      records = new Map(decoded.state.records.map((record) => [record.agentId, record]))
      runs = new Map(decoded.state.runs.map((run) => [run.runId, run]))
      workspaces = new Map(
        decoded.state.workspaces.map((workspace) => [workspace.workspaceId, workspace]),
      )
      rootStores = new Set(decoded.state.rootStores)
    }
    if (collect !== undefined) collect(snapshot())
  }
  return restored === undefined ? undefined : { migrated: restored.migrated, state: snapshot() }
}

export function latestState(
  branch: readonly SessionEntry[],
  ownerSessionId: string,
): RuntimeState | undefined {
  return readHistory(branch, ownerSessionId)?.state
}

export function stateHistory(
  branch: readonly SessionEntry[],
  ownerSessionId: string,
): RuntimeState[] {
  const history: RuntimeState[] = []
  readHistory(branch, ownerSessionId, (state) => history.push(state))
  return history
}

export class StateStore {
  private ownerSessionId = ''
  private records = new Map<string, RunRecord>()
  private rootStores = new Set<string>()
  private runs = new Map<string, CoordinationRunState>()
  private workspaces = new Map<string, WorkspaceRecord>()

  private pins = new Map<string, number>()
  private sessionManager: OwnerContext['sessionManager'] | undefined
  private previous: string | undefined
  private changesSinceCheckpoint = CHECKPOINT_INTERVAL
  private bytesSinceCheckpoint = 0
  private checkpointBytes = 0

  constructor(private readonly pi: Pick<ExtensionAPI, 'appendEntry'>) {}

  get owner(): string {
    return this.ownerSessionId
  }

  restore(ctx: OwnerContext, pinnedRecordIds?: Iterable<string>): void {
    const previous = {
      ownerSessionId: this.ownerSessionId,
      pins: new Map(this.pins),
      records: this.records,
      rootStores: this.rootStores,
      runs: this.runs,
      sessionManager: this.sessionManager,
      workspaces: this.workspaces,
    }
    try {
      this.restoreBranch(ctx, pinnedRecordIds)
    } catch (error) {
      this.ownerSessionId = previous.ownerSessionId
      this.pins = previous.pins
      this.records = previous.records
      this.rootStores = previous.rootStores
      this.runs = previous.runs
      this.sessionManager = previous.sessionManager
      this.workspaces = previous.workspaces
      this.previous = undefined
      throw error
    }
  }

  private restoreBranch(ctx: OwnerContext, pinnedRecordIds?: Iterable<string>): void {
    const ownerSessionId = ctx.sessionManager.getSessionId()
    const restored = readHistory(ctx.sessionManager.getBranch(), ownerSessionId)
    this.sessionManager = ctx.sessionManager
    this.previous = undefined
    this.changesSinceCheckpoint = CHECKPOINT_INTERVAL
    if (this.ownerSessionId !== ownerSessionId || pinnedRecordIds !== undefined) this.pins.clear()
    for (const id of pinnedRecordIds ?? []) this.pin(id)
    this.ownerSessionId = ownerSessionId
    this.records = new Map()
    this.rootStores = new Set(restored?.state.rootStores ?? [])
    this.runs = new Map()
    this.workspaces = new Map()
    for (const record of restored?.state.records ?? []) {
      if (record.ownerSessionId === ownerSessionId) this.records.set(record.agentId, record)
    }
    for (const run of restored?.state.runs ?? []) {
      if (run.ownerSessionId === ownerSessionId) this.runs.set(run.runId, run)
    }
    for (const workspace of restored?.state.workspaces ?? []) {
      this.workspaces.set(workspace.workspaceId, workspace)
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

    if (this.pruneRuns().length > 0) changed = true
    if (this.prune().length > 0) changed = true
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
    const previous = this.records.get(record.agentId)
    this.records.set(record.agentId, record)
    const removed = this.prune()
    this.commit(
      {
        records: this.records.has(record.agentId) ? [record] : [],
        removedRecords: removed.map((item) => item.agentId),
      },
      () => {
        for (const item of removed) this.records.set(item.agentId, item)
        if (previous === undefined) this.records.delete(record.agentId)
        else this.records.set(record.agentId, previous)
      },
    )
  }

  update(record: RunRecord): void {
    this.add(record)
  }

  pin(agentId: string): void {
    this.pins.set(agentId, (this.pins.get(agentId) ?? 0) + 1)
  }

  unpin(agentId: string): void {
    const count = this.pins.get(agentId)
    if (count === undefined) return
    if (count > 1) {
      this.pins.set(agentId, count - 1)
      return
    }
    this.pins.delete(agentId)
    const removed = this.prune()
    if (removed.length > 0) {
      this.commit({ removedRecords: removed.map((record) => record.agentId) }, () => {
        this.pins.set(agentId, count)
        for (const record of removed) this.records.set(record.agentId, record)
      })
    }
  }

  all(): RunRecord[] {
    return [...this.records.values()].sort((left, right) => left.updatedAt - right.updatedAt)
  }

  maxRunGeneration(): number {
    let maximum = 0
    for (const record of this.records.values()) {
      maximum = Math.max(maximum, record.runGeneration ?? 0)
    }
    return maximum
  }

  addRun(run: CoordinationRunState): void {
    const previous = this.runs.get(run.runId)
    this.runs.set(run.runId, run)
    const removed = this.pruneRuns()
    this.commit(
      {
        runs: this.runs.has(run.runId) ? [run] : [],
        removedRuns: removed.map((item) => item.runId),
      },
      () => {
        for (const item of removed) this.runs.set(item.runId, item)
        if (previous === undefined) this.runs.delete(run.runId)
        else this.runs.set(run.runId, previous)
      },
    )
  }

  getRun(runId: string): CoordinationRunState | undefined {
    return this.runs.get(runId)
  }

  updateRun(run: CoordinationRunState): void {
    if (!this.runs.has(run.runId))
      throw new Error(`Coordination run "${run.runId}" does not exist.`)
    this.addRun(run)
  }

  addWorkspace(workspace: WorkspaceRecord): void {
    const previous = this.workspaces.get(workspace.workspaceId)
    this.workspaces.set(workspace.workspaceId, workspace)
    this.commit({ workspaces: [workspace] }, () => {
      if (previous === undefined) this.workspaces.delete(workspace.workspaceId)
      else this.workspaces.set(workspace.workspaceId, previous)
    })
  }

  updateWorkspace(workspace: WorkspaceRecord): void {
    if (workspace.lifecycleState === 'cleaned') {
      const previous = this.workspaces.get(workspace.workspaceId)
      this.workspaces.delete(workspace.workspaceId)
      this.commit({ removedWorkspaces: [workspace.workspaceId] }, () => {
        if (previous !== undefined) this.workspaces.set(workspace.workspaceId, previous)
      })
    } else {
      this.addWorkspace(workspace)
    }
  }

  addRootStore(storeRoot: string): void {
    if (this.rootStores.has(storeRoot)) return
    this.rootStores.add(storeRoot)
    this.commit({ rootStores: [storeRoot] }, () => {
      this.rootStores.delete(storeRoot)
    })
  }

  rootStorePaths(): string[] {
    return [...this.rootStores]
  }

  getWorkspace(workspaceId: string): WorkspaceRecord | undefined {
    return this.workspaces.get(workspaceId)
  }

  unfinishedWorkspaces(): WorkspaceRecord[] {
    return [...this.workspaces.values()]
  }

  private prune(): RunRecord[] {
    if (this.records.size <= MAX_TERMINAL_RECORDS) return []
    const terminal: RunRecord[] = []
    for (const record of this.records.values()) {
      if (record.status !== 'running' && !this.pins.has(record.agentId)) terminal.push(record)
    }
    if (terminal.length <= MAX_TERMINAL_RECORDS) return []
    terminal.sort((left, right) => left.updatedAt - right.updatedAt)
    const removed: RunRecord[] = []
    for (let index = 0; index < terminal.length - MAX_TERMINAL_RECORDS; index += 1) {
      const record = terminal[index]
      if (record === undefined) continue
      this.records.delete(record.agentId)
      removed.push(record)
    }
    return removed
  }

  private pruneRuns(): CoordinationRunState[] {
    if (this.runs.size <= MAX_TERMINAL_RUNS) return []
    const retained = new Set(recentRuns([...this.runs.values()]).map((run) => run.runId))
    const removed: CoordinationRunState[] = []
    for (const run of this.runs.values()) {
      if (retained.has(run.runId)) continue
      this.runs.delete(run.runId)
      removed.push(run)
    }
    return removed
  }

  private commit(change: StateChange, rollback: () => void): void {
    try {
      this.persist(change)
    } catch (error) {
      rollback()
      this.previous = undefined
      throw error
    }
  }

  private persist(change: StateChange = {}): void {
    if (
      this.previous === undefined ||
      (this.changesSinceCheckpoint >= CHECKPOINT_INTERVAL &&
        this.bytesSinceCheckpoint >= this.checkpointBytes)
    ) {
      const checkpoint: RuntimeState = {
        ownerSessionId: this.ownerSessionId,
        records: this.all(),
        rootStores: [...this.rootStores],
        runs: [...this.runs.values()],
        version: 6,
        workspaces: [...this.workspaces.values()],
      }
      this.pi.appendEntry(STATE_TYPE, checkpoint)
      this.checkpointBytes = Buffer.byteLength(JSON.stringify(checkpoint))
      this.bytesSinceCheckpoint = 0
      this.changesSinceCheckpoint = 0
    } else {
      const delta: StateDelta = {
        ownerSessionId: this.ownerSessionId,
        previous: this.previous,
        records: [],
        removedRecords: [],
        removedRuns: [],
        removedWorkspaces: [],
        rootStores: [],
        runs: [],
        version: 7,
        workspaces: [],
        ...change,
      }
      this.pi.appendEntry(STATE_TYPE, delta)
      this.bytesSinceCheckpoint += Buffer.byteLength(JSON.stringify(delta))
      this.changesSinceCheckpoint += 1
    }
    this.previous = this.sessionManager?.getLeafId() ?? undefined
  }
}
