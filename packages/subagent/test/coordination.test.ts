import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { describe, expect, it, vi } from 'vite-plus/test'

import { CapabilityRegistry, type CapabilityToolDefinition } from '../src/capabilities.ts'
import { SubagentControllerHost } from '../src/controller.ts'
import { runBatch } from '../src/coordinator.ts'
import { buildTaskGraph } from '../src/graph.ts'
import { RunMailbox } from '../src/mailbox.ts'
import {
  evaluateGates,
  publishOutputArtifact,
  readArtifact,
  resolveStructuredOutput,
  validateOutputSchema,
} from '../src/output.ts'
import { isReadonlyByDefault, resolveRole } from '../src/roles.ts'
import {
  type CoordinationRunState,
  SingleTaskInputSchema,
  TaskInputSchema,
  type RunRecord,
} from '../src/schema.ts'
import { stateHistory } from '../src/state.ts'
import { recentRecords, recentRuns } from '../src/state.ts'

const trustedTool: CapabilityToolDefinition = {
  description: 'Return trusted data.',
  async execute() {
    return { content: [{ text: 'trusted', type: 'text' }], details: {} }
  },
  label: 'Trusted Tool',
  name: 'trusted_tool',
  parameters: Type.Object({}),
}

const node = {
  description: 'Task',
  prompt: 'Prompt',
  subagent_type: 'explore',
}

const execFileAsync = promisify(execFile)

async function createBatchHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-coordination-'))
  await writeFile(join(dir, '.gitignore'), 'agent/\nsessions/\n')
  await writeFile(join(dir, 'shared.txt'), 'base\n')
  await execFileAsync('git', ['init', '-q'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await execFileAsync('git', ['add', '.gitignore', 'shared.txt'], { cwd: dir })
  await execFileAsync('git', ['commit', '-q', '-m', 'base'], { cwd: dir })
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerProvider('coordination-test', {
    api: 'openai-completions',
    apiKey: 'test-key',
    baseUrl: 'http://localhost:1',
    models: [
      {
        contextWindow: 100_000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: 'writer',
        input: ['text'],
        maxTokens: 8_000,
        name: 'Coordination writer',
        reasoning: false,
      },
    ],
    streamSimple: (model, context) => {
      const stream = createAssistantMessageEventStream()
      const wrote = context.messages.some((message) => message.role === 'toolResult')
      const message: AssistantMessage = {
        api: model.api,
        content: wrote
          ? [{ text: 'Done', type: 'text' }]
          : [
              {
                arguments: { content: 'writer\n', path: 'shared.txt' },
                id: 'write-shared',
                name: 'write',
                type: 'toolCall',
              },
            ],
        model: model.id,
        provider: model.provider,
        role: 'assistant',
        stopReason: wrote ? 'stop' : 'toolUse',
        timestamp: Date.now(),
        usage: {
          cacheRead: 0,
          cacheWrite: 0,
          cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
          input: 1,
          output: 1,
          totalTokens: 2,
        },
      }
      stream.push({ partial: message, type: 'start' })
      stream.push({ message, reason: wrote ? 'stop' : 'toolUse', type: 'done' })
      stream.end()
      return stream
    },
  })
  const model = modelRuntime.getModel('coordination-test', 'writer')
  if (model === undefined) throw new Error('The test model is missing.')
  let host: SubagentControllerHost | undefined
  let context: ExtensionContext | undefined
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(dir, 'agent'),
    cwd: dir,
    extensionFactories: [
      (pi) => {
        host = new SubagentControllerHost(pi)
        pi.on('input', (_event, ctx) => {
          context = ctx
          return { action: 'handled' }
        })
      },
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: dir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(dir, join(dir, 'sessions')),
    thinkingLevel: 'off',
  })
  await session.prompt('Capture coordination context')
  if (host === undefined || context === undefined) throw new Error('The test context is missing.')
  await host.replaceSession(context)
  const runtime = host.runtime
  const ctx = context
  const states = () =>
    stateHistory(session.sessionManager.getBranch(), session.sessionManager.getSessionId())
  return {
    close: async () => {
      await runtime.shutdown()
      session.dispose()
      await rm(dir, { force: true, recursive: true })
    },
    ctx,
    dir,
    host,
    run: (signal?: AbortSignal) =>
      runBatch({
        ctx,
        input: {
          tasks: [
            {
              description: 'Write shared file',
              id: 'writer',
              model: 'coordination-test/writer',
              prompt: 'Write shared.txt',
              readonly: false,
              subagent_type: 'generalPurpose',
            },
          ],
        },
        runtime,
        signal,
      }),
    runtime,
    states,
  }
}

describe('coordination finalization', () => {
  it('fences cancellation before aggregate root apply', async () => {
    const harness = await createBatchHarness()
    const controller = new AbortController()
    const update = harness.runtime.updateWorkspaceLifecycle.bind(harness.runtime)
    const lifecycle = vi
      .spyOn(harness.runtime, 'updateWorkspaceLifecycle')
      .mockImplementation(async (workspace, state, visibility) => {
        await update(workspace, state, visibility)
        if (workspace.writerId.startsWith('coordination-') && state === 'integrating') {
          controller.abort()
        }
      })
    try {
      const result = await harness.run(controller.signal)
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('base\n')
      expect(result.status).toBe('aborted')
      expect(harness.states().at(-1)?.runs?.[0]?.status).toBe('aborted')
    } finally {
      lifecycle.mockRestore()
      await harness.close()
    }
  }, 180_000)

  it.each(['integrating', 'cleanup-pending'])(
    'drains aggregate %s before replacing the owner',
    async (pausedState) => {
      const harness = await createBatchHarness()
      const controller = new AbortController()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const update = harness.runtime.updateWorkspaceLifecycle.bind(harness.runtime)
      const lifecycle = vi
        .spyOn(harness.runtime, 'updateWorkspaceLifecycle')
        .mockImplementation(async (workspace, state, visibility) => {
          await update(workspace, state, visibility)
          if (workspace.writerId.startsWith('coordination-') && state === pausedState) {
            entered.resolve()
            await release.promise
          }
        })
      const pending = harness.run(controller.signal)
      let replacement: Promise<boolean> | undefined
      try {
        await entered.promise
        const owner = harness.runtime.ownerSessionId
        if (pausedState === 'cleanup-pending') controller.abort()
        const stopping = harness.host.stopSession(harness.ctx)
        const sessionManager = SessionManager.inMemory(harness.dir)
        let replaced = false
        replacement = harness.host.replaceSession({ sessionManager }).then((result) => {
          replaced = true
          return result
        })
        await new Promise((resolve) => setTimeout(resolve, 25))
        expect(replaced).toBe(false)
        expect(harness.runtime.ownerSessionId).toBe(owner)
        release.resolve()
        const result = await pending
        expect(result.status).toBe(pausedState === 'integrating' ? 'failed' : 'completed')
        expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe(
          pausedState === 'integrating' ? 'base\n' : 'writer\n',
        )
        await stopping
        expect(await replacement).toBe(true)
        expect(harness.runtime.ownerSessionId).toBe(sessionManager.getSessionId())
        expect(harness.runtime.getCoordinationRun(result.runId)).toBeUndefined()
      } finally {
        release.resolve()
        await pending.catch(() => {})
        await replacement
        lifecycle.mockRestore()
        await harness.close()
      }
    },
    180_000,
  )

  it('drains admitted setup and rejects new batches during shutdown', async () => {
    const harness = await createBatchHarness()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const preflight = harness.runtime.preflight.bind(harness.runtime)
    const setup = vi.spyOn(harness.runtime, 'preflight').mockImplementation(async (ctx, inputs) => {
      const policies = await preflight(ctx, inputs)
      entered.resolve()
      await release.promise
      return policies
    })
    const pending = harness.run()
    const rejected = expect(pending).rejects.toThrow('shutting down')
    let shutdown: Promise<void> | undefined
    try {
      await entered.promise
      let stopped = false
      shutdown = harness.runtime.shutdown().then(() => {
        stopped = true
      })
      await expect(harness.run()).rejects.toThrow('shutting down')
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(stopped).toBe(false)
      release.resolve()
      await rejected
      await shutdown
      expect(setup).toHaveBeenCalledTimes(1)
      expect(harness.states().at(-1)?.runs ?? []).toEqual([])
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('base\n')
    } finally {
      release.resolve()
      await pending.catch(() => {})
      await shutdown
      setup.mockRestore()
      await harness.close()
    }
  }, 180_000)

  it('releases coordination completion when setup throws', async () => {
    const harness = await createBatchHarness()
    const failure = new Error('Coordination preflight failed')
    const setup = vi.spyOn(harness.runtime, 'preflight').mockRejectedValue(failure)
    try {
      await expect(harness.run()).rejects.toBe(failure)
      let stopped = false
      const shutdown = harness.runtime.shutdown().then(() => {
        stopped = true
      })
      await vi.waitFor(() => expect(stopped).toBe(true))
      await shutdown
      expect(harness.states().at(-1)?.runs ?? []).toEqual([])
    } finally {
      setup.mockRestore()
      await harness.close()
    }
  }, 180_000)

  it('keeps the apply fence open for the remaining repositories after commit starts', async () => {
    const harness = await createBatchHarness()
    const controller = new AbortController()
    try {
      await harness.runtime.coordinate(harness.ctx, controller.signal, async (lifecycle) => {
        expect(lifecycle.integrationStarted).toBe(false)
        lifecycle.beforeApply()
        expect(lifecycle.integrationStarted).toBe(true)
        controller.abort()
        harness.runtime.invalidateHandles()
        expect(() => lifecycle.beforeApply()).not.toThrow()
      })
      await harness.runtime.shutdown()
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('keeps a successful batch running until aggregate integration and cleanup finish', async () => {
    const harness = await createBatchHarness()
    const update = harness.runtime.updateWorkspaceLifecycle.bind(harness.runtime)
    const observed: Array<{ lifecycle: string; status: string | undefined }> = []
    const lifecycle = vi
      .spyOn(harness.runtime, 'updateWorkspaceLifecycle')
      .mockImplementation(async (workspace, state, visibility) => {
        await update(workspace, state, visibility)
        if (workspace.writerId.startsWith('coordination-')) {
          observed.push({ lifecycle: state, status: harness.states().at(-1)?.runs?.[0]?.status })
        }
      })
    try {
      const result = await harness.run()
      expect(result.status).toBe('completed')
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('writer\n')
      expect(observed.map((entry) => entry.lifecycle)).toEqual([
        'captured',
        'integrating',
        'integrated',
        'cleanup-pending',
        'cleaned',
      ])
      expect(observed.every((entry) => entry.status === 'running')).toBe(true)
      expect(harness.states().at(-1)?.runs?.[0]?.status).toBe(result.status)
    } finally {
      lifecycle.mockRestore()
      await harness.close()
    }
  }, 180_000)

  it.each([
    { aborted: false, failureState: 'captured' },
    { aborted: false, failureState: 'integrating' },
    { aborted: false, failureState: 'cleaned' },
    { aborted: true, failureState: 'integrating' },
  ])(
    'persists terminal state when aggregate finalization throws at $failureState (aborted=$aborted)',
    async ({ aborted, failureState }) => {
      const harness = await createBatchHarness()
      const controller = new AbortController()
      const update = harness.runtime.updateWorkspaceLifecycle.bind(harness.runtime)
      const failure = new Error(`Failed at ${failureState}`)
      const lifecycle = vi
        .spyOn(harness.runtime, 'updateWorkspaceLifecycle')
        .mockImplementation(async (workspace, state, visibility) => {
          if (workspace.writerId.startsWith('coordination-') && state === failureState) {
            if (aborted) controller.abort()
            throw failure
          }
          await update(workspace, state, visibility)
        })
      try {
        await expect(harness.run(controller.signal)).rejects.toBe(failure)
        const runs = harness.states().flatMap((state) => state.runs ?? [])
        expect(runs.at(-1)?.status).toBe(aborted ? 'aborted' : 'failed')
        expect(runs.at(-1)?.tasks[0]?.status).toBe('completed')
        expect(runs.some((run) => run.status === 'completed')).toBe(false)
        expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe(
          failureState === 'cleaned' ? 'writer\n' : 'base\n',
        )
      } finally {
        lifecycle.mockRestore()
        await harness.close()
      }
    },
    180_000,
  )

  it('persists aggregate conflicts as failed without publishing premature completion', async () => {
    const harness = await createBatchHarness()
    const update = harness.runtime.updateWorkspaceLifecycle.bind(harness.runtime)
    const lifecycle = vi
      .spyOn(harness.runtime, 'updateWorkspaceLifecycle')
      .mockImplementation(async (workspace, state, visibility) => {
        if (workspace.writerId.startsWith('coordination-') && state === 'captured') {
          await writeFile(join(harness.dir, 'shared.txt'), 'root\n')
        }
        await update(workspace, state, visibility)
      })
    try {
      const result = await harness.run()
      expect(result.status).toBe('failed')
      expect(result.content).toContain('aggregate: failed')
      expect(result.items[0]?.status).toBe('completed')
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('root\n')
      const runs = harness.states().flatMap((state) => state.runs ?? [])
      expect(runs.at(-1)?.status).toBe(result.status)
      expect(runs.some((run) => run.status === 'completed')).toBe(false)
      expect(harness.runtime.getCoordinationRun(result.runId)?.status).toBe(result.status)
    } finally {
      lifecycle.mockRestore()
      await harness.close()
    }
  }, 180_000)
})

describe('coordination primitives', () => {
  it('preserves legacy local Task role aliases', () => {
    expect(resolveRole('general-purpose', false).name).toBe('generalPurpose')
    expect(resolveRole('general_purpose', false).name).toBe('generalPurpose')
    expect(resolveRole('unspecified', false).name).toBe('generalPurpose')
    expect(resolveRole('bash', false).name).toBe('shell')
    expect(resolveRole('bash', true).name).toBe('readonly')
    expect(resolveRole('explore', true).name).toBe('explore')
    expect(isReadonlyByDefault('explore')).toBe(true)
    expect(isReadonlyByDefault('generalPurpose')).toBe(false)
  })

  it('builds declared-order waves and rejects graph defects', () => {
    const graph = buildTaskGraph([
      { ...node, id: 'a' },
      { ...node, id: 'b' },
      { ...node, id: 'c', needs: ['a', 'b'] },
    ])
    expect(graph.waves.map((wave) => wave.map((item) => item.id))).toEqual([['a', 'b'], ['c']])
    expect(() =>
      buildTaskGraph([
        { ...node, id: 'a' },
        { ...node, id: 'a' },
      ]),
    ).toThrow('occurs more than once')
    expect(() => buildTaskGraph([{ ...node, id: 'a', needs: ['missing'] }])).toThrow(
      'unknown Task ID',
    )
    expect(() => buildTaskGraph([{ ...node, id: 'a', needs: ['a'] }])).toThrow(
      'cannot depend on itself',
    )
  })

  it('routes and consumes correlated messages inside one mailbox', () => {
    const mailbox = new RunMailbox(['left', 'right', 'third'])
    const left = mailbox.endpoint('left')
    const right = mailbox.endpoint('right')
    const third = mailbox.endpoint('third')
    const request = left.send('right', 'question', undefined)
    expect(right.receive()).toEqual([request])
    expect(right.receive()).toEqual([])
    expect(() => third.send('left', 'forged', request.id)).toThrow(
      'does not match this conversation',
    )
    const reply = right.send('left', 'answer', request.id)
    expect(left.receive()).toEqual([reply])
    expect(() => left.send('left', 'self', undefined)).toThrow('cannot send to itself')
    expect(() => left.send('outside', 'no', undefined)).toThrow('is not active')
    expect(() => left.send('right', 'no', 'unknown')).toThrow('does not exist in this run')
    mailbox.close('right')
    expect(() => left.send('right', 'late', undefined)).toThrow('is not active')
  })

  it('bounds mailbox correlation history after messages are consumed', () => {
    const mailbox = new RunMailbox(['left', 'right'])
    const left = mailbox.endpoint('left')
    const right = mailbox.endpoint('right')
    const first = left.send('right', 'first', undefined)
    right.receive()
    for (let index = 0; index < 1_000; index += 1) {
      left.send('right', `message-${index}`, undefined)
      right.receive()
    }
    expect(() => right.send('left', 'late reply', first.id)).toThrow('does not exist in this run')
  })

  it('retains every active record beyond the terminal history target', () => {
    const records: RunRecord[] = Array.from({ length: 257 }, (_value, index) => ({
      agentId: `agent-${index}`,
      background: true,
      createdAt: index,
      description: 'Active child',
      effort: 'off',
      fast: false,
      model: 'provider/model',
      modelSelector: 'provider/model:off',
      ownerSessionId: 'owner',
      readonly: true,
      sessionFile: `/tmp/agent-${index}.jsonl`,
      status: 'running',
      subagentType: 'explore',
      updatedAt: index,
    }))
    expect(recentRecords(records)).toHaveLength(257)
  })

  it('bounds terminal coordination history without limiting active runs', () => {
    const active: CoordinationRunState[] = Array.from({ length: 129 }, (_value, index) => ({
      createdAt: index,
      ownerSessionId: 'owner',
      runId: `active-${index}`,
      status: 'running',
      tasks: [],
      updatedAt: index,
    }))
    const terminal: CoordinationRunState[] = Array.from({ length: 129 }, (_value, index) => ({
      createdAt: index,
      ownerSessionId: 'owner',
      runId: `terminal-${index}`,
      status: 'completed',
      tasks: [],
      updatedAt: index,
    }))
    expect(recentRuns(active)).toHaveLength(129)
    expect(recentRuns(terminal)).toHaveLength(128)
    expect(recentRuns(terminal).some((run) => run.runId === 'terminal-0')).toBe(false)
  })

  it('keeps the combined Task schema inside its measured context budget', () => {
    const singleBytes = Buffer.byteLength(JSON.stringify(SingleTaskInputSchema), 'utf8')
    const combinedBytes = Buffer.byteLength(JSON.stringify(TaskInputSchema), 'utf8')
    expect(singleBytes).toBeLessThanOrEqual(2_500)
    expect(combinedBytes).toBeLessThanOrEqual(5_000)
    expect(combinedBytes - singleBytes).toBeLessThanOrEqual(2_500)
  })

  it('validates structured output and deterministic gates', () => {
    const schema = {
      additionalProperties: false,
      properties: { count: { type: 'integer' }, ok: { type: 'boolean' } },
      required: ['count', 'ok'],
      type: 'object',
    }
    validateOutputSchema(schema)
    const structured = resolveStructuredOutput(
      '```json\n{"count":2,"ok":true}\n```',
      schema,
      'strict',
    )
    expect(structured?.status).toBe('valid')
    const gates = evaluateGates(
      [
        { type: 'schema-valid' },
        { op: 'eq', path: '/ok', type: 'json-pointer', value: true },
        { op: 'in', path: '/count', type: 'json-pointer', values: [1, 2, 3] },
      ],
      'completed',
      structured,
      undefined,
    )
    expect(gates.every((gate) => gate.passed)).toBe(true)
    expect(resolveStructuredOutput('{"count":"bad"}', schema, 'permissive')?.status).toBe('invalid')
    expect(resolveStructuredOutput('1', { enum: [1], type: 'string' }, 'strict')?.status).toBe(
      'invalid',
    )
    expect(
      resolveStructuredOutput('{"right":2,"left":1}', { enum: [{ left: 1, right: 2 }] }, 'strict')
        ?.status,
    ).toBe('valid')
    expect(() => validateOutputSchema({ minLength: 1, type: 'string' })).toThrow(
      'keyword "minLength" is unsupported',
    )
  })

  it('publishes and verifies complete output artifacts atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subagent-output-'))
    try {
      const artifact = await publishOutputArtifact({
        attempt: 1,
        output: 'first\nsecond',
        runId: 'run',
        sessionFile: join(directory, 'session.jsonl'),
        taskId: 'task',
      })
      expect(artifact.byteLength).toBe(12)
      expect(artifact.lineCount).toBe(2)
      expect(artifact.sha256).toHaveLength(64)
      const repeated = await publishOutputArtifact({
        attempt: 1,
        output: 'replacement',
        runId: 'run',
        sessionFile: join(directory, 'session.jsonl'),
        taskId: 'task',
      })
      expect(repeated.uri).not.toBe(artifact.uri)
      expect(await readArtifact(artifact)).toBe('first\nsecond')
      expect(await readArtifact(repeated)).toBe('replacement')
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('fails closed for changed capability registrations', () => {
    const registry = new CapabilityRegistry()
    registry.registerCapability({
      extensions: [],
      id: 'provider',
      tools: [trustedTool],
      version: '1',
    })
    registry.registerProfile({ id: 'profile', registrations: ['provider'] })
    const resolved = registry.resolve('profile')
    expect(resolved.tools).toEqual(['trusted_tool'])
    expect(() =>
      registry.resolveContract(
        {
          ...resolved.contract,
          registrations: [{ id: 'provider', version: '2' }],
        },
        false,
      ),
    ).toThrow('unavailable or changed')
    expect(() =>
      registry.registerCapability({
        extensions: [],
        id: 'bad',
        tools: [{ ...trustedTool, name: 'Task' }],
        version: '1',
      }),
    ).toThrow('reserved name')
    expect(registry.resolve('profile', true).tools).toEqual([])
  })
})
