import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import {
  type CoordinationRunState,
  decodeJsonValue,
  type RunRecord,
  type RuntimeState,
  type WorkspaceRecord,
} from '../src/schema.ts'
import { latestState, stateHistory, StateStore } from '../src/state.ts'

function record(ownerSessionId: string, index: number): RunRecord {
  return {
    agentId: `agent-${index}`,
    background: true,
    createdAt: index,
    description: 'History scaling fixture',
    effort: 'high',
    fast: false,
    model: 'test/model',
    modelSelector: 'test/model:high',
    output: 'x'.repeat(8192),
    ownerSessionId,
    readonly: true,
    sessionFile: `/tmp/agent-${index}.jsonl`,
    status: 'completed',
    subagentType: 'explore',
    updatedAt: index,
  }
}

function storeFor(sessionManager: SessionManager): StateStore {
  return new StateStore({
    appendEntry: (customType, data) => {
      sessionManager.appendCustomEntry(customType, data)
    },
  })
}

function snapshot(ownerSessionId: string, records: RunRecord[]): RuntimeState {
  return { ownerSessionId, records, rootStores: [], runs: [], version: 6, workspaces: [] }
}

function startSession(dir: string, name: string): SessionManager {
  const session = SessionManager.create(dir, join(dir, name))
  session.appendMessage({
    api: 'openai-responses',
    content: [{ text: 'Ready', type: 'text' }],
    model: 'test',
    provider: 'test',
    role: 'assistant',
    stopReason: 'stop',
    timestamp: 0,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  })
  return session
}

function sessionPath(session: SessionManager): string {
  const path = session.getSessionFile()
  if (path === undefined) throw new Error('The history fixture is not persisted.')
  return path
}

describe('StateStore history', () => {
  it(
    'rolls back failed appends and pruning before later mutations can persist ghost records',
    { timeout: 60_000 },
    () => {
      const session = SessionManager.inMemory()
      let fail = false
      const store = new StateStore({
        appendEntry: (customType, data) => {
          if (fail) {
            fail = false
            throw new Error('Injected append failure')
          }
          session.appendCustomEntry(customType, data)
        },
      })
      store.restore({ sessionManager: session })
      for (let index = 0; index < 256; index += 1) {
        store.add({ ...record(session.getSessionId(), index), output: 'small' })
      }
      const before = store.all()
      fail = true
      expect(() =>
        store.add({ ...record(session.getSessionId(), 256), status: 'running' }),
      ).toThrow('Injected append failure')
      expect(store.get('agent-256')).toBeUndefined()
      fail = true
      expect(() => store.add(record(session.getSessionId(), 257))).toThrow(
        'Injected append failure',
      )
      expect(store.all()).toEqual(before)
      fail = true
      expect(() => store.update(record(session.getSessionId(), 0))).toThrow(
        'Injected append failure',
      )
      expect(store.all()).toEqual(before)
      const run: CoordinationRunState = {
        createdAt: 0,
        ownerSessionId: session.getSessionId(),
        runId: 'run',
        status: 'running',
        tasks: [],
        updatedAt: 0,
      }
      fail = true
      expect(() => store.addRun(run)).toThrow('Injected append failure')
      expect(store.getRun(run.runId)).toBeUndefined()
      store.addRun({ ...run, status: 'completed' })
      fail = true
      expect(() => store.updateRun(run)).toThrow('Injected append failure')
      expect(store.getRun(run.runId)?.status).toBe('completed')
      store.addRootStore('/tmp/after-failure')
      const restored = storeFor(session)
      restored.restore({ sessionManager: session })
      expect(restored.all()).toEqual(before)
      expect(restored.getRun(run.runId)?.status).toBe('completed')
      expect(restored.rootStorePaths()).toEqual(['/tmp/after-failure'])
    },
  )

  it('round-trips special JSON keys in checkpoints and deltas through real JSONL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'subagent-json-history-'))
    try {
      const session = startSession(dir, 'session')
      const store = storeFor(session)
      store.restore({ sessionManager: session })
      const data = decodeJsonValue(
        JSON.parse('{"__proto__":{"constructor":null},"constructor":null,"toString":false}'),
      )
      const source: RunRecord = {
        ...record(session.getSessionId(), 1),
        execution: {
          agentDescription: '',
          agentName: 'explore',
          agentSource: { kind: 'bundled' },
          cwd: '/tmp',
          effort: 'high',
          fast: false,
          gates: [{ op: 'eq', path: '', type: 'json-pointer', value: data }],
          model: 'test/model',
          modelSelector: 'test/model:high',
          outputSchema: data,
          readonly: true,
          schemaMode: 'strict',
          systemPrompt: 'Test',
          tools: [],
          version: 2,
        },
        gateResults: [
          { gate: { op: 'in', path: '', type: 'json-pointer', values: [data] }, passed: true },
        ],
        structuredOutput: { data, mode: 'strict', source: 'caller', status: 'valid' },
      }
      store.add(source)
      store.update({ ...source, updatedAt: 2 })
      const reopened = SessionManager.open(sessionPath(session))
      const history = stateHistory(reopened.getBranch(), reopened.getSessionId())
      expect(history).toHaveLength(2)
      for (const state of history) {
        expect(state.records[0]).toMatchObject({
          execution: source.execution,
          gateResults: source.gateResults,
          structuredOutput: source.structuredOutput,
        })
        expect(JSON.stringify(state.records[0]?.structuredOutput?.data)).toBe(JSON.stringify(data))
      }
      const restored = storeFor(reopened)
      restored.restore({ sessionManager: reopened })
      expect(restored.get(source.agentId)?.structuredOutput?.data).toEqual(data)
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('rejects unsupported codec values hidden under special JSON keys in old state', () => {
    for (const ownerSessionId of ['foreign', 'owner']) {
      const session = SessionManager.inMemory()
      const data = Object.fromEntries([['constructor', Symbol('invalid')]])
      session.appendCustomEntry('pi-subagent-state', {
        ...snapshot(ownerSessionId, []),
        records: [
          {
            ...record(ownerSessionId, 1),
            structuredOutput: { data, mode: 'strict', source: 'caller', status: 'valid' },
          },
        ],
      })
      session.appendCustomEntry('pi-subagent-state', snapshot(session.getSessionId(), []))
      expect(() => storeFor(session).restore({ sessionManager: session })).toThrow(
        'The persisted subagent state is invalid.',
      )
    }
  })

  it.each([1, 2, 3, 4, 5, 6])('restores v%i snapshots before journaling updates', (version) => {
    const session = SessionManager.inMemory()
    const source = record(session.getSessionId(), 1)
    session.appendCustomEntry('pi-subagent-state', {
      ...snapshot(session.getSessionId(), [source]),
      version,
    })
    const store = storeFor(session)
    store.restore({ sessionManager: session })
    store.update({ ...source, output: 'updated', updatedAt: 2 })
    expect(latestState(session.getBranch(), session.getSessionId())?.records).toEqual(store.all())
    const restored = storeFor(session)
    restored.restore({ sessionManager: session })
    expect(restored.get(source.agentId)?.output).toBe('updated')
  })

  it('restores active branches without leaking abandoned or foreign state', () => {
    const session = SessionManager.inMemory()
    const store = storeFor(session)
    store.restore({ sessionManager: session })
    const source = record(session.getSessionId(), 1)
    store.add(source)
    const fork = session.getLeafId()
    if (fork === null) throw new Error('The branch fixture has no leaf.')
    store.update({ ...source, output: 'abandoned' })
    session.branch(fork)
    store.restore({ sessionManager: session })
    store.update({ ...source, output: 'selected' })
    session.appendCustomEntry('pi-subagent-state', snapshot('foreign', [record('foreign', 2)]))
    store.update({ ...source, output: 'after foreign' })
    const restored = storeFor(session)
    restored.restore({ sessionManager: session })
    expect(restored.all()).toEqual([{ ...source, output: 'after foreign' }])
    expect(stateHistory(session.getBranch(), session.getSessionId())).toHaveLength(3)
    expect(() => restored.ensureOwner({ sessionManager: SessionManager.inMemory() })).toThrow(
      'The extension context does not belong to the active parent session.',
    )
  })

  it('rejects disconnected and malformed deltas instead of silently losing updates', () => {
    const session = SessionManager.inMemory()
    const store = storeFor(session)
    store.restore({ sessionManager: session })
    store.add(record(session.getSessionId(), 1))
    store.add(record(session.getSessionId(), 2))
    const delta = session.getLeafEntry()
    if (delta?.type !== 'custom') throw new Error('The delta fixture is missing.')
    const disconnected = SessionManager.inMemory()
    disconnected.appendCustomEntry('pi-subagent-state', delta.data)
    expect(() => storeFor(disconnected).restore({ sessionManager: disconnected })).toThrow(
      'The persisted subagent state journal is disconnected.',
    )
    session.appendCustomEntry('pi-subagent-state', {
      ownerSessionId: session.getSessionId(),
      previous: delta.id,
      records: 'invalid',
      version: 7,
    })
    expect(() => store.restore({ sessionManager: session })).toThrow(
      'The persisted subagent state is invalid.',
    )
  })

  it('still rejects corruption in superseded and foreign snapshots', () => {
    for (const foreign of [false, true]) {
      const session = SessionManager.inMemory()
      session.appendCustomEntry('pi-subagent-state', {
        ownerSessionId: foreign ? 'foreign' : session.getSessionId(),
        records: 'invalid',
        version: 6,
      })
      session.appendCustomEntry('pi-subagent-state', snapshot(session.getSessionId(), []))
      expect(() => storeFor(session).restore({ sessionManager: session })).toThrow(
        'The persisted subagent state is invalid.',
      )
    }
  })

  it('retains refcounted pins beyond terminal caps across checkpoints and restore', () => {
    const session = SessionManager.inMemory()
    const store = storeFor(session)
    store.restore({ sessionManager: session })
    const ids = Array.from({ length: 300 }, (_value, index) => `agent-${index}`)
    for (const id of ids) store.pin(id)
    store.pin('agent-0')
    for (let index = 0; index < 600; index += 1) {
      store.add({ ...record(session.getSessionId(), index), output: 'small' })
    }
    expect(store.all()).toHaveLength(556)
    store.unpin('agent-0')
    expect(store.get('agent-0')).toBeDefined()
    const restored = storeFor(session)
    restored.restore({ sessionManager: session }, ids)
    expect(restored.all()).toEqual(store.all())
    store.unpin('agent-0')
    expect(store.get('agent-0')).toBeUndefined()
    for (const id of ids.slice(1)) store.unpin(id)
    expect(store.all()).toHaveLength(256)
    expect(latestState(session.getBranch(), session.getSessionId())?.records).toEqual(store.all())
  }, 60_000)

  it(
    'journals workspace deletion, roots, run pruning, and reload interruptions',
    { timeout: 60_000 },
    () => {
      const session = SessionManager.inMemory()
      let fail = false
      const store = new StateStore({
        appendEntry: (customType, data) => {
          if (fail) {
            fail = false
            throw new Error('Injected append failure')
          }
          session.appendCustomEntry(customType, data)
        },
      })
      store.restore({ sessionManager: session })
      const workspace: WorkspaceRecord = {
        attemptId: 'attempt',
        createdAt: 0,
        lifecycleState: 'active',
        logicalCwd: '/tmp',
        parentWorkspaceId: 'parent',
        relativeCwd: '',
        repositoryIds: [],
        rootVisibility: 'pending',
        rootWorkspaceId: 'root',
        scopeId: 'scope',
        spawnOrdinal: 0,
        updatedAt: 0,
        version: 6,
        workspaceId: 'workspace',
        writerId: 'writer',
      }
      fail = true
      expect(() => store.addWorkspace(workspace)).toThrow('Injected append failure')
      expect(store.getWorkspace(workspace.workspaceId)).toBeUndefined()
      store.addWorkspace(workspace)
      fail = true
      expect(() => store.addRootStore('/tmp/failed-root')).toThrow('Injected append failure')
      expect(store.rootStorePaths()).toEqual([])
      store.addRootStore('/tmp/root-store')
      store.addRootStore('/tmp/root-store')
      fail = true
      expect(() => store.updateWorkspace({ ...workspace, lifecycleState: 'cleaned' })).toThrow(
        'Injected append failure',
      )
      expect(store.getWorkspace(workspace.workspaceId)).toEqual(workspace)
      store.updateWorkspace({ ...workspace, lifecycleState: 'cleaned' })
      for (let index = 0; index < 130; index += 1) {
        store.addRun({
          createdAt: index,
          ownerSessionId: session.getSessionId(),
          runId: `run-${index}`,
          status: 'completed',
          tasks: [],
          updatedAt: index,
        })
      }
      const run: CoordinationRunState = {
        createdAt: 200,
        ownerSessionId: session.getSessionId(),
        runId: 'running',
        status: 'running',
        tasks: [
          { needs: [], status: 'running', taskId: 'active' },
          { needs: ['active'], status: 'pending', taskId: 'waiting' },
        ],
        updatedAt: 200,
      }
      store.addRun(run)
      store.updateRun({ ...run, updatedAt: 201 })
      store.add({ ...record(session.getSessionId(), 1), status: 'running' })
      const restored = storeFor(session)
      restored.restore({ sessionManager: session })
      expect(restored.get('agent-1')?.status).toBe('aborted')
      expect(restored.getRun('running')).toMatchObject({
        status: 'aborted',
        tasks: [{ status: 'aborted' }, { status: 'blocked' }],
      })
      expect(restored.getRun('run-0')).toBeUndefined()
      expect(restored.getRun('run-1')).toBeUndefined()
      expect(restored.getRun('run-2')).toBeUndefined()
      expect(restored.rootStorePaths()).toEqual(['/tmp/root-store'])
      expect(restored.unfinishedWorkspaces()).toEqual([])
      expect(latestState(session.getBranch(), session.getSessionId())?.runs).toHaveLength(128)
    },
  )

  it(
    'bounds persisted history amplification using real SessionManager JSONL',
    { timeout: 60_000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'subagent-history-'))
      try {
        const baseline = startSession(dir, 'baseline')
        const compact = startSession(dir, 'compact')
        const store = storeFor(compact)
        store.restore({ sessionManager: compact })
        const records = Array.from({ length: 128 }, (_value, index) =>
          record(baseline.getSessionId(), index),
        )
        const baselineStart = performance.now()
        for (let index = 0; index < records.length; index += 1) {
          baseline.appendCustomEntry(
            'pi-subagent-state',
            snapshot(baseline.getSessionId(), records.slice(0, index + 1)),
          )
        }
        const baselineMs = performance.now() - baselineStart
        const compactStart = performance.now()
        for (let index = 0; index < records.length; index += 1) {
          store.add(record(compact.getSessionId(), index))
        }
        const compactMs = performance.now() - compactStart
        const baselineBytes = (await stat(sessionPath(baseline))).size
        const compactBytes = (await stat(sessionPath(compact))).size
        process.stdout.write(
          `history measurement: baseline=${baselineBytes} bytes/${baselineMs.toFixed(1)}ms compact=${compactBytes} bytes/${compactMs.toFixed(1)}ms\n`,
        )
        expect(compactBytes).toBeLessThan(baselineBytes / 10)
        const reopenBaselineStart = performance.now()
        const baselineReopened = SessionManager.open(sessionPath(baseline))
        storeFor(baselineReopened).restore({ sessionManager: baselineReopened })
        const baselineRestoreMs = performance.now() - reopenBaselineStart
        const reopenCompactStart = performance.now()
        const reopened = SessionManager.open(sessionPath(compact))
        const restored = storeFor(reopened)
        restored.restore({ sessionManager: reopened })
        const compactRestoreMs = performance.now() - reopenCompactStart
        process.stdout.write(
          `history reopen+restore: baseline=${baselineRestoreMs.toFixed(1)}ms compact=${compactRestoreMs.toFixed(1)}ms\n`,
        )
        expect(restored.all()).toEqual(store.all())
        expect((await readFile(sessionPath(compact), 'utf8')).split('\n')).toHaveLength(131)
        const retainedSlots = (session: SessionManager) =>
          session.getBranch().reduce((count, entry) => {
            if (entry.type !== 'custom' || entry.customType !== 'pi-subagent-state') return count
            return count + JSON.stringify(entry.data).split('"agentId"').length - 1
          }, 0)
        expect(retainedSlots(baseline)).toBe(8256)
        expect(retainedSlots(compact)).toBe(128)
      } finally {
        await rm(dir, { force: true, recursive: true })
      }
    },
  )
})
