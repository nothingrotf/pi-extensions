import { describe, expect, it } from 'vite-plus/test'

import { SUBAGENT_EXECUTE_TASK_EVENT } from '../src/index.ts'
import { baseInput, createHarness, latestState, runProbe } from './integration-harness.ts'

describe('subagent Task execution event', () => {
  it('runs a Task for the active tool call and records the child', async () => {
    const harness = await createHarness()
    try {
      const response = JSON.parse(await runProbe(harness, baseInput))
      expect(response.result.content[0].text).toContain('Agent ID:')
      expect(response.result.details).toMatchObject({ status: 'completed' })
      const agentId = response.result.details.agentId
      expect(latestState(harness).records.map((record) => record.agentId)).toContain(agentId)
    } finally {
      await harness.close()
    }
  })

  it('rejects an invalid Task input and a request outside a tool call', async () => {
    const harness = await createHarness()
    try {
      const response = JSON.parse(await runProbe(harness, { ...baseInput, prompt: '' }))
      expect(response.error).toContain('The Task input is invalid at /')

      const responses: string[] = []
      let accepted = false
      harness.pi.events.emit(SUBAGENT_EXECUTE_TASK_EVENT, {
        accept() {
          accepted = true
        },
        input: baseInput,
        respond(value: { error: string }) {
          responses.push(value.error)
        },
        toolCallId: 'no-such-call',
        version: 1,
      })
      expect(accepted).toBe(true)
      expect(responses).toEqual([
        'No active tool call no-such-call can own this Task. Request it from a running tool.',
      ])
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })
})
