import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import { CapabilityRegistry } from '../src/capabilities.ts'
import { buildTaskGraph } from '../src/graph.ts'
import { RunMailbox } from '../src/mailbox.ts'
import {
  artifactFileStem,
  evaluateGates,
  publishOutputArtifact,
  readArtifact,
  resolveStructuredOutput,
  validateOutputSchema,
} from '../src/output.ts'
import { isReadonlyByDefault, resolveRole } from '../src/roles.ts'
import {
  type CoordinationRunState,
  DeliveryBindingSchema,
  decodeSingleTaskInput,
  SingleTaskInputSchema,
  TaskInputSchema,
  type RunRecord,
} from '../src/schema.ts'
import { recentRecords, recentRuns } from '../src/state.ts'
import {
  createBatchHarness,
  execFileAsync,
  node,
  readonlySchedulerTask,
  trustedTool,
} from './coordination-harness.ts'

describe('coordination finalization', () => {
  it('keeps linked worktree roots separate in one batch', async () => {
    const harness = await createBatchHarness()
    const lifecycle = vi.spyOn(harness.runtime, 'updateWorkspaceLifecycle')
    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-a'), 'HEAD'],
        { cwd: harness.dir },
      )
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-b'), 'HEAD'],
        { cwd: harness.dir },
      )
      const result = await harness.runTasks([
        {
          description: 'Write issue A',
          cwd: '.worktrees/issue-a',
          id: 'issue-a',
          model: 'coordination-test/writer',
          prompt: 'Write shared.txt',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
        {
          description: 'Write issue B',
          cwd: '.worktrees/issue-b',
          id: 'issue-b',
          model: 'coordination-test/writer',
          prompt: 'Write shared.txt',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
      ])
      expect(result.status).toBe('completed')
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-a', 'shared.txt'), 'utf8')).toBe(
        'writer\n',
      )
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-b', 'shared.txt'), 'utf8')).toBe(
        'writer\n',
      )
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('base\n')
      expect(
        result.items.map((item) =>
          item.isolation?.repositories.map((repository) => repository.relativePath),
        ),
      ).toEqual([[''], ['']])
      const parentWorkspaceIds = result.items.map((item) => item.isolation?.parentWorkspaceId)
      expect(parentWorkspaceIds.every((workspaceId) => workspaceId !== undefined)).toBe(true)
      expect(new Set(parentWorkspaceIds).size).toBe(2)
      const aggregateWorkspaces = lifecycle.mock.calls
        .map(([workspace]) => workspace)
        .filter((workspace) => workspace.writerId === `coordination-${result.runId}`)
        .filter(
          (workspace, index, workspaces) =>
            workspaces.findIndex(
              (candidate) => candidate.context.workspaceId === workspace.context.workspaceId,
            ) === index,
        )
      expect(aggregateWorkspaces).toHaveLength(2)
      expect(
        aggregateWorkspaces.map((workspace) =>
          workspace.repositories.map((repository) => repository.relativePath),
        ),
      ).toEqual([[''], ['']])
      expect(aggregateWorkspaces.map((workspace) => workspace.context.logicalCwd).sort()).toEqual(
        [
          await realpath(join(harness.dir, '.worktrees', 'issue-a')),
          await realpath(join(harness.dir, '.worktrees', 'issue-b')),
        ].sort(),
      )
    } finally {
      lifecycle.mockRestore()
      await harness.close()
    }
  }, 180_000)

  it('does not aggregate policy-derived manual isolation tasks', async () => {
    const harness = await createBatchHarness()
    harness.runtime.registerCapability({
      extensions: [],
      id: 'manual-policy',
      roleToolRequirements: [{ isolation: 'manual', role: 'runtime-verifier', tools: [] }],
      tools: [],
      version: '1',
    })
    harness.runtime.registerCapabilityProfile({
      id: 'manual-policy-profile',
      registrations: ['manual-policy'],
    })
    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-a'), 'HEAD'],
        { cwd: harness.dir },
      )
      const issueRoot = await realpath(join(harness.dir, '.worktrees', 'issue-a'))
      await expect(
        harness.runtime.preflight(harness.ctx, [
          {
            capability_profile: 'manual-policy-profile',
            cwd: '.worktrees/issue-a',
            description: 'Verify issue A',
            model: 'coordination-test/writer',
            prompt: 'Write shared.txt',
            readonly: false,
            role: 'runtime-verifier',
            subagent_type: 'generalPurpose',
          },
        ]),
      ).resolves.toEqual([
        {
          isolation: { integration: 'manual', mode: 'worktree' },
          logicalCwd: issueRoot,
          readonly: false,
        },
      ])
      const result = await harness.runTasks([
        {
          capability_profile: 'manual-policy-profile',
          description: 'Verify issue A',
          cwd: '.worktrees/issue-a',
          id: 'issue-a',
          model: 'coordination-test/writer',
          prompt: 'Write shared.txt',
          readonly: false,
          role: 'runtime-verifier',
          subagent_type: 'generalPurpose',
        },
      ])
      expect(result.status).toBe('completed')
      expect(result.items[0]?.isolation?.integration).toBe('manual')
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-a', 'shared.txt'), 'utf8')).toBe(
        'base\n',
      )
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('base\n')
      expect(
        (harness.states().at(-1)?.workspaces ?? []).filter(
          (workspace) => workspace.writerId === `coordination-${result.runId}`,
        ),
      ).toHaveLength(0)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('gives dependent verifiers the joined aggregate candidate', async () => {
    const harness = await createBatchHarness()
    harness.runtime.registerCapability({
      extensions: [],
      id: 'manual-policy',
      roleToolRequirements: [{ isolation: 'manual', role: 'runtime-verifier', tools: [] }],
      tools: [],
      version: '1',
    })
    harness.runtime.registerCapabilityProfile({
      id: 'manual-policy-profile',
      registrations: ['manual-policy'],
    })
    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-a'), 'HEAD'],
        { cwd: harness.dir },
      )
      const result = await harness.runTasks([
        {
          description: 'Write issue A',
          cwd: '.worktrees/issue-a',
          id: 'writer',
          model: 'coordination-test/writer',
          prompt: 'Write shared.txt',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
        {
          description: 'Read issue A candidate',
          cwd: '.worktrees/issue-a',
          id: 'readonly-verifier',
          model: 'coordination-test/writer',
          needs: ['writer'],
          prompt: 'READ_CANDIDATE',
          readonly: true,
          subagent_type: 'explore',
        },
        {
          capability_profile: 'manual-policy-profile',
          description: 'Read issue A manually',
          cwd: '.worktrees/issue-a',
          id: 'manual-verifier',
          model: 'coordination-test/writer',
          needs: ['writer'],
          prompt: 'READ_CANDIDATE',
          readonly: false,
          role: 'runtime-verifier',
          subagent_type: 'generalPurpose',
        },
      ])
      expect(result.status).toBe('completed')
      expect(result.items[1]?.output).toContain('writer')
      expect(result.items[2]?.output).toContain('writer')
      expect(result.items[2]?.isolation?.integration).toBe('manual')
      expect(
        result.items[2]?.isolation?.repositories.map((repository) => repository.relativePath),
      ).toEqual([''])
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-a', 'shared.txt'), 'utf8')).toBe(
        'writer\n',
      )
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('rejects cross-root candidate verification before dispatch', async () => {
    const harness = await createBatchHarness()
    try {
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-a'), 'HEAD'],
        { cwd: harness.dir },
      )
      await execFileAsync(
        'git',
        ['worktree', 'add', '-q', join(harness.dir, '.worktrees', 'issue-b'), 'HEAD'],
        { cwd: harness.dir },
      )
      await expect(
        harness.runTasks([
          {
            description: 'Write issue A',
            cwd: '.worktrees/issue-a',
            id: 'writer',
            model: 'coordination-test/writer',
            prompt: 'Write shared.txt',
            readonly: false,
            subagent_type: 'generalPurpose',
          },
          {
            description: 'Read issue B candidate',
            cwd: '.worktrees/issue-b',
            id: 'verifier',
            model: 'coordination-test/writer',
            needs: ['writer'],
            prompt: 'READ_CANDIDATE',
            readonly: true,
            subagent_type: 'explore',
          },
        ]),
      ).rejects.toThrow('Cross-root candidate verification is unsupported')
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
      expect(harness.states().at(-1)?.runs ?? []).toEqual([])
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-a', 'shared.txt'), 'utf8')).toBe(
        'base\n',
      )
      expect(await readFile(join(harness.dir, '.worktrees', 'issue-b', 'shared.txt'), 'utf8')).toBe(
        'base\n',
      )
    } finally {
      await harness.close()
    }
  }, 180_000)
})

describe('read-only coordination scheduling', () => {
  it('starts a dependency-ready task before an unrelated sibling completes', async () => {
    const aStarted = Promise.withResolvers<void>()
    const bStarted = Promise.withResolvers<void>()
    const bRelease = Promise.withResolvers<void>()
    const cStarted = Promise.withResolvers<void>()
    const harness = await createBatchHarness({
      failures: new Set(),
      held: new Map([['b', bRelease.promise]]),
      observed: new Set(),
      started: new Map([
        ['a', aStarted],
        ['b', bStarted],
        ['c', cStarted],
      ]),
    })
    const tasks = [
      readonlySchedulerTask('a'),
      readonlySchedulerTask('b'),
      readonlySchedulerTask('c', ['a']),
    ]
    const pending = harness.runTasks(tasks)
    try {
      await Promise.all([aStarted.promise, bStarted.promise])
      await cStarted.promise
      bRelease.resolve()
      const result = await pending
      expect(result.items.map((item) => item.taskId)).toEqual(['a', 'b', 'c'])
      expect(result.items.map((item) => item.status)).toEqual([
        'completed',
        'completed',
        'completed',
      ])
    } finally {
      bRelease.resolve()
      await pending.catch(() => {})
      await harness.close()
    }
  }, 15_000)

  it('blocks only descendants of a failed task', async () => {
    const aStarted = Promise.withResolvers<void>()
    const bStarted = Promise.withResolvers<void>()
    const cStarted = Promise.withResolvers<void>()
    const observed = new Set<string>()
    const harness = await createBatchHarness({
      failures: new Set(['a']),
      held: new Map(),
      observed,
      started: new Map([
        ['a', aStarted],
        ['b', bStarted],
        ['c', cStarted],
      ]),
    })
    try {
      const result = await harness.runTasks([
        readonlySchedulerTask('a'),
        readonlySchedulerTask('b'),
        readonlySchedulerTask('c', ['a']),
      ])
      expect(await Promise.all([aStarted.promise, bStarted.promise])).toEqual([
        undefined,
        undefined,
      ])
      expect(harness.runtime.hasActiveRun()).toBe(false)
      expect(observed.has('c')).toBe(false)
      expect(harness.runtime.getCoordinationRun(result.runId)?.tasks[2]?.status).toBe('blocked')
      expect(result.items.map((item) => item.taskId)).toEqual(['a', 'b', 'c'])
      expect(result.items.map((item) => item.status)).toEqual(['failed', 'completed', 'blocked'])
      expect(result.items[2]?.error).toBe('Blocked by: a.')
    } finally {
      await harness.close()
    }
  }, 15_000)

  it('drains aborted read-only work before completing the batch', async () => {
    const aStarted = Promise.withResolvers<void>()
    const aRelease = Promise.withResolvers<void>()
    const harness = await createBatchHarness({
      failures: new Set(),
      held: new Map([['a', aRelease.promise]]),
      observed: new Set(),
      started: new Map([['a', aStarted]]),
    })
    const controller = new AbortController()
    const pending = harness.runTasks(
      [
        {
          description: 'Abort a',
          id: 'a',
          model: 'coordination-test/writer',
          prompt: 'SCHEDULER_A',
          readonly: true,
          subagent_type: 'explore',
        },
      ],
      controller.signal,
    )
    try {
      await aStarted.promise
      controller.abort()
      const result = await pending
      expect(result.status).toBe('aborted')
      expect(result.items[0]?.status).toBe('aborted')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      expect(harness.states().at(-1)?.runs?.[0]?.status).toBe('aborted')
    } finally {
      aRelease.resolve()
      await pending.catch(() => {})
      await harness.close()
    }
  }, 15_000)
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

  it.each([
    [{ kind: 'managed' }, undefined, 'Decode'],
    [
      { issue: 'unexpected', kind: 'independent' },
      { kind: 'independent' },
      'Invalid delivery binding',
    ],
  ])(
    'rejects malformed delivery bindings even when TypeBox decode can clean them',
    (delivery, cleaned, expectedBoundaryError) => {
      expect(Value.Check(DeliveryBindingSchema, delivery)).toBe(false)
      if (cleaned === undefined) {
        expect(() => Value.Decode(DeliveryBindingSchema, delivery)).toThrow('Decode')
      } else {
        expect(Value.Decode(DeliveryBindingSchema, delivery)).toEqual(cleaned)
      }
      expect(() =>
        decodeSingleTaskInput({
          delivery,
          description: 'Malformed delivery',
          prompt: 'Do not start.',
          subagent_type: 'explore',
        }),
      ).toThrow(expectedBoundaryError)
    },
  )

  it('keeps the combined Task schema inside its measured context budget', () => {
    const singleBytes = Buffer.byteLength(JSON.stringify(SingleTaskInputSchema), 'utf8')
    const combinedBytes = Buffer.byteLength(JSON.stringify(TaskInputSchema), 'utf8')
    expect(singleBytes).toBeLessThanOrEqual(2_550)
    expect(combinedBytes).toBeLessThanOrEqual(5_600)
    expect(combinedBytes - singleBytes).toBeLessThanOrEqual(3_100)
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

  it('publishes an artifact for a provider call id that exceeds the file name limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'subagent-output-long-'))
    try {
      const taskId = `${randomUUID()}-tool-call_lnpkjbD6H2LC0o3DLx5tsOuW|fc_${'0'.repeat(48)}`
      const artifact = await publishOutputArtifact({
        attempt: 18,
        output: 'candidate',
        runId: randomUUID(),
        sessionFile: join(directory, 'session.jsonl'),
        taskId,
      })
      const name = basename(fileURLToPath(artifact.uri))
      expect(Buffer.byteLength(name, 'utf8')).toBeLessThanOrEqual(200)
      expect(name).not.toContain('|')
      expect(artifact.id).toContain(taskId)
      expect(await readArtifact(artifact)).toBe('candidate')
      expect(artifactFileStem(artifact.id)).toBe(name.slice(0, -'.md'.length))
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
