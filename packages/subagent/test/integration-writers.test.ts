import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import { TaskControlInputSchema } from '../src/index.ts'
import { SubagentRuntime } from '../src/runtime.ts'
import { TaskInputSchema } from '../src/schema.ts'
import { ManifestSchema } from '../src/workspace.ts'
import {
  BatchBindingSchema,
  SingleBindingSchema,
  agentId,
  baseInput,
  createHarness,
  execFileAsync,
  initializeHarnessRepository,
  latestState,
  latestToolDetails,
  linkedWorktree,
  runTask,
  runTaskControl,
} from './integration-harness.ts'

describe('subagent Task integration: writer isolation', () => {
  it('runs a writer in a worktree and applies the captured delta', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const result = await runTask(harness, {
        description: 'Write in isolation',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
      })
      expect(result).toContain('isolated write complete')
      expect(harness.state.childSystemPrompts.at(-1)).toContain('# Workspace identity')
      expect(harness.state.childSystemPrompts.at(-1)).toContain('Synthetic baseline')
      expect(harness.state.childSystemPrompts.at(-1)).toContain('Captured patch readable path:')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      const record = latestState(harness).records.at(-1)
      expect(record?.status).toBe('completed')
      if (record?.execution?.version !== 5) {
        throw new Error('The workspace execution contract is unavailable.')
      }
      const snapshot = record.execution.workspaceIdentity?.snapshot.repositories[0]
      expect(snapshot?.root).toBe(await realpath(harness.dir))
      expect(snapshot?.tree).toBe(record.execution.workspaceIdentity?.baselineTree)
      expect(record?.isolation?.status).toBe('integrated')
      expect(record?.isolation?.repositories[0]?.changedFiles).toEqual([
        { path: 'isolated.txt', status: 'A' },
      ])
      const receipt = record?.toolExecutionReceipts?.find((entry) => entry.tool === 'write')
      if (receipt === undefined) throw new Error('The write execution receipt is unavailable.')
      expect(receipt.status).toBe('success')
      expect(receipt.isError).toBe(false)
      expect(receipt.completedAt).toBeGreaterThanOrEqual(receipt.startedAt)
      expect(await readFile(fileURLToPath(receipt.output.uri), 'utf8')).toContain('isolated.txt')
      expect(latestState(harness).workspaces).toEqual([])
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('records a failed terminal state when artifact publication throws', async () => {
    const harness = await createHarness()
    try {
      await mkdir(join(harness.dir, 'sessions'), { recursive: true })
      await writeFile(join(harness.dir, 'sessions', 'subagent-artifacts'), 'blocker', 'utf8')
      const result = await runTask(harness, {
        description: 'Publish into a blocked artifact directory',
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
      })
      expect(result).toContain('Task failed')
      const id = agentId(result)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.status).toBe('failed')
      expect(record?.error).toContain('EEXIST')
      const canceled = await runTaskControl(harness, {
        action: 'cancel',
        agent_id: id,
        reason: 'Clear the abandoned record.',
      })
      expect(canceled).toContain('"outcome": "already-terminal"')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('resumes a captured attempt that retained nothing after the baseline moved', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const first = await runTask(harness, {
        description: 'Fail without writing',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'RETURN_CORRECTION_FAILURE',
        subagent_type: 'generalPurpose',
      })
      expect(first).toContain('Task failed')
      const id = agentId(first)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.isolation?.status).toBe('captured')
      expect(record?.isolation?.repositories[0]?.changedFiles).toEqual([])

      await writeFile(join(harness.dir, 'moved.txt'), 'baseline moved\n', 'utf8')
      await execFileAsync('git', ['add', 'moved.txt'], { cwd: harness.dir })
      await execFileAsync('git', ['commit', '-q', '-m', 'move baseline'], { cwd: harness.dir })

      const resumed = await runTask(harness, {
        description: 'Resume on the moved baseline',
        prompt: 'RETURN_TOOLS',
        resume: id,
        subagent_type: 'generalPurpose',
      })
      expect(resumed).not.toContain('does not match the captured baseline')
      expect(resumed).toContain('tools:')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('does not integrate a writer whose strict output policy fails', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const result = await runTask(harness, {
        description: 'Reject isolated output',
        isolation: { integration: 'apply', mode: 'worktree' },
        outputSchema: { type: 'object' },
        prompt: 'WRITE_INVALID',
        schemaMode: 'strict',
        subagent_type: 'generalPurpose',
      })
      expect(result).toContain('Task failed')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const record = latestState(harness).records.at(-1)
      expect(record?.status).toBe('failed')
      expect(record?.isolation?.status).toBe('captured')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('registers Task and TaskControl and runs a persistent read-only child', async () => {
    const harness = await createHarness()
    try {
      for (const [name, schema] of Object.entries({
        Task: TaskInputSchema,
        TaskControl: TaskControlInputSchema,
      })) {
        expect(JSON.parse(JSON.stringify(schema))).toHaveProperty('type', 'object')
        expect(harness.session.getToolDefinition(name)?.parameters).toEqual(schema)
      }
      expect(TaskInputSchema.anyOf).toHaveLength(2)
      expect(TaskControlInputSchema.anyOf).toHaveLength(11)
      const batchInput = { tasks: [{ ...baseInput, id: 'child' }] }
      expect(Value.Check(TaskInputSchema, batchInput)).toBe(true)
      expect(Value.Check(TaskInputSchema, { ...baseInput, ...batchInput })).toBe(false)
      expect(Value.Check(TaskInputSchema, { tasks: [] })).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'status' })).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'unknown' })).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'jobs', agent_id: 'child' })).toBe(false)
      expect(Value.Check(TaskInputSchema, baseInput)).toBe(true)
      expect(Value.Check(TaskInputSchema, { ...baseInput, attachments: [] })).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'status', agent_id: 'child' })).toBe(
        true,
      )
      expect(
        Value.Check(TaskControlInputSchema, {
          action: 'steer',
          agent_id: 'child',
          handle: { run_generation: 1 },
          message: 'redirect',
        }),
      ).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'list', limit: 1.5 })).toBe(false)
      expect(Value.Check(TaskControlInputSchema, { action: 'list', limit: 21 })).toBe(false)
      expect(harness.session.getToolDefinition('Task')?.executionMode).toBe('parallel')
      expect(harness.session.getToolDefinition('TaskControl')?.executionMode).toBe('parallel')
      expect(harness.session.getToolDefinition('subagent')).toBeUndefined()

      const result = await runTask(harness, {
        description: baseInput.description,
        prompt: 'RETURN_TOOLS',
        readonly: true,
        subagent_type: 'explore',
      })
      const id = agentId(result)
      expect(Value.Decode(SingleBindingSchema, latestToolDetails(harness, 'Task')).agentId).toBe(id)
      expect(result).toContain(
        'tools:ask_parent,find,grep,ls,notify_parent,read,request_parent,update_progress',
      )
      expect(result).not.toContain('write')
      expect(result).not.toContain('edit')
      expect(result).not.toContain('Task')

      const state = latestState(harness)
      expect(state.ownerSessionId).toBe(harness.session.sessionId)
      expect(state.records.at(-1)?.agentId).toBe(id)
      expect(state.records.at(-1)?.status).toBe('completed')
      expect(state.records.at(-1)?.effort).toBe('medium')
      expect(state.records.at(-1)?.model).toBe('openai-codex/gpt-5.6-sol')
      expect(state.records.at(-1)?.sessionFile).toContain('/sessions/')

      const batchResult = await runTask(harness, {
        tasks: [{ ...baseInput, id: 'bound-child', prompt: 'RETURN_TOOLS' }],
      })
      expect(batchResult).toContain('bound-child: completed')
      const batchBinding = Value.Decode(BatchBindingSchema, latestToolDetails(harness, 'Task'))
      expect(batchBinding.items).toHaveLength(1)
      expect(batchBinding.items[0]?.taskId).toBe('bound-child')
      expect(batchBinding.items[0]?.agentId).toBeDefined()

      const context = await runTask(harness, {
        description: 'Read project context',
        prompt: 'RETURN_CONTEXT',
        subagent_type: 'explore',
      })
      expect(context).toContain('project-context:true')

      const recordCount = latestState(harness).records.length
      const missing = await runTaskControl(harness, {
        action: 'status',
        agent_id: 'missing-child',
      })
      expect(missing).toContain('"outcome": "not-found"')
      expect(latestState(harness).records).toHaveLength(recordCount)
    } finally {
      await harness.close()
    }
  })

  it('checks status, lists active Tasks, queues steering, and reports terminal state', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, baseInput)
      const pending = harness.runtime.run({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'BLOCK' },
        signal: undefined,
      })
      await harness.state.blockedReady.promise
      const running = harness.runtime.listSnapshots().find((snapshot) => snapshot.running)
      if (running === undefined) throw new Error('The blocked Task is missing.')
      const id = running.agentId

      const active = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(active).toContain('"outcome": "found"')
      expect(active).toContain('"activity": "Thinking"')
      expect(active).toContain('"state": "running"')
      expect(active).toContain('"usage": {')
      expect(active).toContain('"isolation": null')
      expect(active).toContain('"evidence": []')

      const listed = await runTaskControl(harness, {
        action: 'list',
        active_only: true,
        limit: 1,
      })
      expect(listed).toContain('"count": 1')
      expect(listed).toContain(`"agent_id": "${id}"`)

      const steered = await runTaskControl(harness, {
        action: 'steer',
        agent_id: id,
        message: 'redirect',
      })
      expect(steered).toContain('"outcome": "queued"')
      expect(steered).toContain('"reason": null')

      for (const release of harness.state.blocked.splice(0)) release()
      const completed = await pending
      expect(completed.kind).toBe('completed')

      const terminal = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(terminal).toContain('"state": "completed"')
      expect(terminal).toContain('"evidence": [')
      expect(terminal).toContain('"output"')
      expect(terminal).not.toContain('child:BLOCK|redirect')

      const late = await runTaskControl(harness, {
        action: 'steer',
        agent_id: id,
        message: 'late',
      })
      expect(late).toContain('"outcome": "rejected"')
      expect(late).toContain('"reason": "terminal"')

      const alreadyTerminal = await runTaskControl(harness, {
        action: 'cancel',
        agent_id: id,
        reason: 'No more work.',
      })
      expect(alreadyTerminal).toContain('"outcome": "already-terminal"')

      const missing = await runTaskControl(harness, {
        action: 'cancel',
        agent_id: 'missing-child',
        reason: 'No more work.',
      })
      expect(missing).toContain('"outcome": "not-found"')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  })

  it('cancels a writer, retains its patch, and does not integrate aborted changes', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        description: 'Write before cancellation',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_THEN_BLOCK',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.blockedReady.promise

      const canceled = await runTaskControl(harness, {
        action: 'cancel',
        agent_id: id,
        reason: 'Operator zero-write stop.',
      })
      expect(canceled).toContain('"outcome": "requested"')
      await harness.state.notification.promise

      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.status).toBe('aborted')
      expect(record?.error).toBe('Operator zero-write stop.')
      expect(record?.isolation?.status).toBe('captured')
      expect(record?.isolation?.repositories[0]?.status).toBe('captured')
      expect(record?.isolation?.repositories[0]?.patch.sha256).toHaveLength(64)

      const status = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(status).toContain('"state": "aborted"')
      expect(status).toContain('"evidence": [')
      expect(status).toContain('"status": "captured"')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  }, 180_000)

  it('writes in place in a linked worktree and captures its base and result trees', async () => {
    const harness = await createHarness()
    let worktree: string | undefined
    try {
      await initializeHarnessRepository(harness)
      worktree = await linkedWorktree(harness)
      const started = await runTask(harness, {
        cwd: worktree,
        description: 'Write in the issue worktree',
        isolation: { mode: 'in-place' },
        prompt: 'WRITE_ISOLATED',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise

      expect(await readFile(join(worktree, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.status).toBe('completed')
      expect(record?.isolation).toBeUndefined()
      expect(record?.execution?.version).toBe(5)
      if (record?.execution?.version !== 5) throw new Error('The execution contract is missing.')
      expect(record.execution.isolation).toEqual({ mode: 'in-place' })
      const receipt = record.inPlace
      expect(receipt?.status).toBe('captured')
      expect(receipt?.worktree).toBe(worktree)
      const repository = receipt?.repositories[0]
      expect(repository?.root).toBe(worktree)
      expect(repository?.baseTree).toBe(
        record.execution.workspaceIdentity?.snapshot.repositories[0]?.tree,
      )
      expect(repository?.resultTree).not.toBe(repository?.baseTree)
      if (repository?.patch.path === undefined) throw new Error('The in-place patch is missing.')
      expect(await readFile(repository.patch.path, 'utf8')).toContain('+isolated content')

      const second = await runTask(harness, {
        cwd: worktree,
        description: 'Reuse the released lease',
        isolation: { mode: 'in-place' },
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
      })
      expect(second).not.toContain('Task failed')
      const status = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(status).toContain('"isolation"')
    } finally {
      await harness.close()
      if (worktree !== undefined) await rm(dirname(worktree), { force: true, recursive: true })
    }
  }, 180_000)

  it('leases an in-place worktree to one writer at a time', async () => {
    const harness = await createHarness()
    let worktree: string | undefined
    try {
      await initializeHarnessRepository(harness)
      worktree = await linkedWorktree(harness)
      const started = await runTask(harness, {
        cwd: worktree,
        description: 'Hold the issue worktree',
        isolation: { mode: 'in-place' },
        prompt: 'WRITE_THEN_BLOCK',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.blockedReady.promise

      const competing = await runTask(harness, {
        cwd: worktree,
        description: 'Compete for the issue worktree',
        isolation: { mode: 'in-place' },
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
      })
      expect(competing).toContain('Task failed')
      expect(competing).toContain(`leased by in-place writer ${id}`)

      for (const release of harness.state.blocked.splice(0)) release()
      await harness.state.notification.promise
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.inPlace?.status).toBe('captured')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
      if (worktree !== undefined) await rm(dirname(worktree), { force: true, recursive: true })
    }
  }, 180_000)

  it('rejects in-place execution in a primary checkout and with an integration mode', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const primary = await runTask(harness, {
        description: 'Write in the primary checkout',
        isolation: { mode: 'in-place' },
        prompt: 'WRITE_ISOLATED',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      expect(primary).toContain('requires a linked Git worktree')
      const integrated = await runTask(harness, {
        description: 'Request an in-place integration',
        isolation: { integration: 'apply', mode: 'in-place' },
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'generalPurpose',
      })
      expect(integrated).toContain('has no integration mode')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('attaches a recovered writer receipt without permitting aborted integration', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        description: 'Recover interrupted writer',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_THEN_BLOCK',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.blockedReady.promise
      const workspace = latestState(harness).workspaces.find(
        (candidate) => candidate.writerId === id,
      )
      if (workspace?.manifestUri === undefined) throw new Error('The writer manifest is missing.')
      const manifest = Value.Decode(
        ManifestSchema,
        JSON.parse(await readFile(workspace.manifestUri, 'utf8')),
      )
      manifest.owner = {
        ...manifest.owner,
        pid: 2_147_483_647,
        startToken: 'dead-process',
      }
      await writeFile(workspace.manifestUri, JSON.stringify(manifest), 'utf8')

      const recovered = new SubagentRuntime(harness.pi)
      recovered.restore({ sessionManager: harness.session.sessionManager })
      await recovered.preflight(harness.context(), [
        { ...baseInput, prompt: 'recovery preflight', readonly: true },
      ])
      const snapshot = recovered.listSnapshots().find((candidate) => candidate.agentId === id)
      expect(snapshot?.status).toBe('aborted')
      expect(snapshot?.isolation?.integrationStatus).toBe('staged')
      expect(snapshot?.isolation?.repositories[0]?.patch.sha256).toHaveLength(64)
      const joined = await recovered.joinStaged(
        id,
        await recovered.rootDestination(harness.context()),
        harness.session.sessionManager.getSessionId(),
      )
      expect(joined.status).toBe('rejected')
      expect(joined.reason).toBe('not-completed')
      expect(joined.receipt).toBeUndefined()
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  }, 180_000)

  it('does not stage a background writer whose capture failed', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        description: 'Break the nested boundary',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_NESTED_BOUNDARY',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.status).toBe('failed')
      expect(record?.error).toContain('could not be captured')
      expect(record?.error).toContain('nested repository boundary')
      expect(record?.isolation?.captureStatus).toBe('failed')
      expect(record?.isolation?.integrationStatus).toBe('not-requested')
      const workspace = latestState(harness).workspaces.find(
        (candidate) => candidate.writerId === id,
      )
      expect(workspace?.lifecycleState).toBe('capture-conflict')
      const joined = await harness.runtime.joinStaged(
        id,
        await harness.runtime.rootDestination(harness.context()),
        harness.session.sessionManager.getSessionId(),
      )
      expect(joined.status).toBe('rejected')
      await expect(readFile(join(harness.dir, 'nested', '.git'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('keeps staged writer receipts intact when a reloaded owner runs recovery', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        description: 'Stage isolated work',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_ISOLATED',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      const staged = latestState(harness).records.find((record) => record.agentId === id)
      expect(staged?.isolation?.captureStatus).toBe('captured')
      expect(staged?.isolation?.integrationStatus).toBe('staged')
      const resultCommit = staged?.isolation?.repositories[0]?.resultCommit
      expect(resultCommit).toHaveLength(40)
      const workspace = latestState(harness).workspaces.find(
        (candidate) => candidate.writerId === id,
      )
      if (workspace?.manifestUri === undefined) throw new Error('The writer manifest is missing.')
      expect(workspace.lifecycleState).toBe('staged')
      const manifest = Value.Decode(
        ManifestSchema,
        JSON.parse(await readFile(workspace.manifestUri, 'utf8')),
      )
      expect(manifest.state).toBe('staged')
      manifest.owner = {
        ...manifest.owner,
        pid: 2_147_483_647,
        startToken: 'dead-process',
      }
      await writeFile(workspace.manifestUri, JSON.stringify(manifest), 'utf8')

      const recovered = new SubagentRuntime(harness.pi)
      recovered.restore({ sessionManager: harness.session.sessionManager })
      await recovered.preflight(harness.context(), [
        { ...baseInput, prompt: 'recovery preflight', readonly: true },
      ])
      const snapshot = recovered.listSnapshots().find((candidate) => candidate.agentId === id)
      expect(snapshot?.isolation?.captureStatus).toBe('captured')
      expect(snapshot?.isolation?.integrationStatus).toBe('staged')
      expect(snapshot?.isolation?.repositories[0]?.resultCommit).toBe(resultCommit)
      const joined = await recovered.joinStaged(
        id,
        await recovered.rootDestination(harness.context()),
        harness.session.sessionManager.getSessionId(),
      )
      expect(joined.status).toBe('joined')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('releases a staged writer execution tree and joins from durable capture', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        description: 'Stage isolated work',
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_ISOLATED',
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      const staged = latestState(harness).records.find((record) => record.agentId === id)
      expect(staged?.isolation?.integrationStatus).toBe('staged')
      const workspace = latestState(harness).workspaces.find(
        (candidate) => candidate.writerId === id,
      )
      if (workspace?.manifestUri === undefined) throw new Error('The writer manifest is missing.')
      expect(workspace.lifecycleState).toBe('staged')
      const manifest = Value.Decode(
        ManifestSchema,
        JSON.parse(await readFile(workspace.manifestUri, 'utf8')),
      )
      expect(manifest.state).toBe('staged')
      await expect(stat(manifest.physicalRoot)).rejects.toThrow(/ENOENT/)

      const joined = await harness.runtime.joinStaged(
        id,
        await harness.runtime.rootDestination(harness.context()),
        harness.session.sessionManager.getSessionId(),
      )
      expect(joined.status).toBe('joined')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      await expect(stat(workspace.manifestUri)).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)
})
