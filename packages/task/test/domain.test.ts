import { describe, expect, it } from 'vite-plus/test'

import {
  backgroundText,
  completedText,
  decodeTaskState,
  errorDetails,
  resolveAgentName,
  resolveModel,
  type TaskCompletedDetails,
  validateTaskInput,
} from '../src/domain.ts'
import { completionOutcome, decodeAsyncCompletion } from '../src/transport.ts'

const baseInput = {
  description: 'Inspect the workspace',
  prompt: 'Read package.json and report the package name.',
  subagent_type: 'explore',
}

describe('Task domain', () => {
  it('validates the portable local contract', () => {
    expect(validateTaskInput(baseInput)).toEqual({ kind: 'valid' })
    expect(validateTaskInput({ ...baseInput, prompt: ' ' })).toEqual({
      kind: 'invalid',
      error: 'Task prompt cannot be blank.',
    })
    expect(validateTaskInput({ ...baseInput, model: 'auto' })).toEqual({
      kind: 'invalid',
      error: 'Task automatic model selection is not supported by pi-subagents.',
    })
    expect(validateTaskInput({ ...baseInput, attachments: ['image.png'] })).toEqual({
      kind: 'invalid',
      error: 'Task attachments are not supported by pi-subagents.',
    })
    expect(validateTaskInput({ ...baseInput, environment: 'cloud' })).toEqual({
      kind: 'invalid',
      error: 'Task cloud execution is not supported by pi-subagents.',
    })
    expect(
      validateTaskInput({
        ...baseInput,
        machine: { self_hosted_worker: { worker_id: 'worker-1' } },
      }),
    ).toEqual({
      kind: 'invalid',
      error: 'Task remote machine selection is not supported by pi-subagents.',
    })
  })

  it('maps built-in and custom agent names', () => {
    expect(resolveAgentName('generalPurpose', false)).toBe('worker')
    expect(resolveAgentName('unspecified', false)).toBe('worker')
    expect(resolveAgentName('shell', false)).toBe('worker')
    expect(resolveAgentName('explore', false)).toBe('scout')
    expect(resolveAgentName('security-reviewer', false)).toBe('security-reviewer')
    expect(resolveAgentName('security-reviewer', true)).toBe('task-readonly')
  })

  it('maps inherited model selectors to package defaults', () => {
    expect(resolveModel(undefined)).toBeUndefined()
    expect(resolveModel('inherit')).toBeUndefined()
    expect(resolveModel('default')).toBeUndefined()
    expect(resolveModel('auto')).toBe('auto')
    expect(resolveModel('openai/gpt-5.3-codex')).toBe('openai/gpt-5.3-codex')
  })

  it('formats foreground, background, and error results', () => {
    const details: TaskCompletedDetails = {
      status: 'completed',
      agentId: 'run-1',
      runId: 'run-1',
      finalMessage: 'Done',
      toolCallCount: 2,
      durationMs: 50,
    }
    expect(completedText(details)).toBe('Agent ID: run-1\n\nDone')
    expect(backgroundText('run-2')).toBe('Task started in the background.\nAgent ID: run-2')
    expect(errorDetails('failed', 'run-3')).toEqual({
      status: 'error',
      error: 'failed',
      agentId: 'run-3',
    })
  })

  it('decodes persisted pending tasks', () => {
    const state = {
      version: 1,
      pending: [
        {
          completionRunId: 'run-1',
          agentId: 'run-1',
          description: 'Inspect',
          subagentType: 'explore',
          startedAt: 10,
        },
      ],
    }
    expect(decodeTaskState(state)).toEqual(state)
    const pending = Array.from({ length: 257 }, (_, index) => ({
      completionRunId: `run-${index}`,
      agentId: `run-${index}`,
      description: 'Inspect',
      subagentType: 'explore',
      startedAt: index,
    }))
    expect(decodeTaskState({ version: 1, pending })).toEqual({ version: 1, pending })
    expect(decodeTaskState({ version: 2, pending: [] })).toBeNull()
  })

  it('projects async completion payloads', () => {
    const completion = decodeAsyncCompletion({
      runId: 'run-1',
      success: true,
      durationMs: 80,
      results: [
        {
          success: true,
          output: 'Complete',
          model: 'provider/model',
          transcriptPath: '/tmp/transcript.jsonl',
          toolBudget: { toolCount: 4 },
        },
      ],
    })
    expect(completion).not.toBeNull()
    if (completion === null) {
      return
    }
    expect(completionOutcome(completion)).toEqual({
      kind: 'completed',
      runId: 'run-1',
      finalMessage: 'Complete',
      toolCallCount: 4,
      durationMs: 80,
      model: 'provider/model',
      transcriptPath: '/tmp/transcript.jsonl',
    })
    const stopped = decodeAsyncCompletion({
      runId: 'run-2',
      state: 'stopped',
      stopped: true,
      summary: 'Stopped by the parent.',
      results: [{ success: false, stopped: true }],
    })
    expect(stopped).not.toBeNull()
    if (stopped === null) {
      return
    }
    expect(completionOutcome(stopped)).toEqual({
      kind: 'aborted',
      runId: 'run-2',
      error: 'Stopped by the parent.',
    })
  })
})
