import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Type } from 'typebox'
import { describe, expect, it } from 'vite-plus/test'

import { CapabilityRegistry, type CapabilityToolDefinition } from '../src/capabilities.ts'
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
