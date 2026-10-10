import { getEventListeners } from 'node:events'

import { Type } from 'typebox'
import { describe, expect, it } from 'vite-plus/test'

import {
  baseInput,
  createHarness,
  initializeHarnessRepository,
  latestState,
  registerNestedCapabilities,
  runTask,
} from './integration-harness.ts'

describe('subagent Task integration: nested capabilities', () => {
  it('loads only tools from an explicit capability profile', async () => {
    const harness = await createHarness()
    let extensionRuns = 0
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapability({
        extensions: [
          {
            factory: () => {
              extensionRuns += 1
            },
            hidden: true,
            name: 'trusted-provider-hooks',
          },
        ],
        id: 'trusted-provider',
        tools: [
          {
            description: 'Return trusted data.',
            async execute() {
              return { content: [{ text: 'trusted', type: 'text' }], details: {} }
            },
            label: 'Trusted Echo',
            name: 'trusted_echo',
            parameters: Type.Object({}),
          },
        ],
        version: '1',
      })
      harness.runtime.registerCapabilityProfile({
        id: 'trusted-profile',
        registrations: ['trusted-provider'],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'trusted-profile',
          prompt: 'RETURN_TOOLS',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The capability Task did not complete.')
      expect(result.content).toContain('trusted_echo')
      expect(extensionRuns).toBe(1)
      const readonlyResult = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'trusted-profile',
          prompt: 'RETURN_TOOLS',
          readonly: true,
        },
        signal: undefined,
      })
      expect(readonlyResult.kind).toBe('completed')
      if (readonlyResult.kind !== 'completed') {
        throw new Error('The read-only capability Task did not complete.')
      }
      expect(readonlyResult.content).not.toContain('trusted_echo')
      expect(extensionRuns).toBe(1)
      expect(latestState(harness).records.at(-2)?.execution?.version).toBe(5)
      expect(latestState(harness).records.at(-1)?.execution).toMatchObject({
        capability: { profileId: 'trusted-profile' },
      })
    } finally {
      await harness.close()
    }
  })

  it.each(['leaf', 'branch'])(
    'allows a nested Task to select a narrower capability profile %s',
    async (profile) => {
      const harness = await createHarness()
      try {
        await runTask(harness, { ...baseInput, prompt: 'context seed' })
        registerNestedCapabilities(harness.runtime)
        const result = await harness.runtime.run({
          ctx: harness.context(),
          input: {
            ...baseInput,
            capability_profile: 'owner',
            prompt: `NESTED_CAPABILITY:${JSON.stringify({
              ...baseInput,
              capability_profile: profile,
              prompt: 'RETURN_TOOLS',
              readonly: true,
            })}`,
            readonly: true,
          },
          signal: undefined,
        })
        expect(result.kind).toBe('completed')
        if (result.kind !== 'completed') throw new Error('The capability owner did not complete.')
        expect(result.content).toContain('nested-result:Agent ID:')
        expect(result.content).toContain('approved_read')
        expect(result.content).not.toMatch(/tools:[^\n]*(Task|TaskControl|bash|edit|write)/)
        const child = latestState(harness).records.find(
          (record) => record.runId === result.details.runId && record.depth === 2,
        )
        expect(child?.execution).toMatchObject({
          capability: {
            extensions: [{ id: 'approved', version: '1' }],
            nested: profile === 'leaf' ? { enabled: false } : { enabled: true, maxDepth: 2 },
            profileId: profile,
            registrations: [{ id: 'approved', version: '1' }],
          },
          readonly: true,
        })
      } finally {
        await harness.close()
      }
    },
  )

  it.each([
    {
      profile: 'unapproved',
      readonly: true,
      tools: ['approved_read'],
      error: 'parent capability profile',
    },
    {
      profile: 'other-provider',
      readonly: true,
      tools: ['approved_read'],
      error: 'parent capability profile',
    },
    {
      profile: 'deeper',
      readonly: true,
      tools: ['approved_read'],
      error: 'parent capability profile',
    },
    {
      profile: 'leaf',
      readonly: false,
      tools: ['approved_read'],
      error: 'parent read-only policy',
    },
    { profile: 'leaf', readonly: true, tools: ['read'], error: 'parent tool contract' },
  ])(
    'rejects nested capability expansion $profile readonly=$readonly tools=$tools',
    async ({ profile, readonly, tools, error }) => {
      const harness = await createHarness()
      try {
        await runTask(harness, { ...baseInput, prompt: 'context seed' })
        registerNestedCapabilities(harness.runtime)
        const result = await harness.runtime.run({
          ctx: harness.context(),
          input: {
            ...baseInput,
            capability_profile: 'owner',
            prompt: `NESTED_CAPABILITY:${JSON.stringify({
              ...baseInput,
              capability_profile: profile,
              prompt: 'RETURN_TOOLS',
              readonly,
            })}`,
            readonly: true,
            tools,
          },
          signal: undefined,
        })
        expect(result.kind).toBe('completed')
        if (result.kind !== 'completed') throw new Error('The capability owner did not complete.')
        expect(result.content).toContain(error)
        expect(
          latestState(harness).records.filter((record) => record.runId === result.details.runId),
        ).toHaveLength(1)
      } finally {
        await harness.close()
      }
    },
  )

  it('preserves a narrower nested capability profile when resuming without a profile', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      registerNestedCapabilities(harness.runtime)
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'owner',
          prompt: 'NESTED_SELF_RESUME:leaf',
          readonly: true,
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The capability owner did not complete.')
      expect(result.content).toBe('nested resume complete')
      const child = latestState(harness).records.find(
        (record) => record.runId === result.details.runId && record.depth === 2,
      )
      expect(child?.execution).toMatchObject({
        capability: { profileId: 'leaf', nested: { enabled: false } },
        readonly: true,
      })
    } finally {
      await harness.close()
    }
  })

  it('exposes nested Task below the limit and removes it at the limit', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-profile',
          prompt: 'NESTED_TOOLS',
          readonly: true,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The nested Task did not complete.')
      expect(result.content).toContain('nested-result:Agent ID:')
      expect(result.content).not.toMatch(/tools:[^\n]*Task/)
      expect(result.content).not.toMatch(/tools:[^\n]*(bash|edit|write)/)
      const records = latestState(harness).records.filter(
        (record) => record.runId === result.details.runId,
      )
      expect(
        records.map((record) => record.depth).sort((left, right) => (left ?? 0) - (right ?? 0)),
      ).toEqual([1, 2])
      const nested = records.find((record) => record.depth === 2)
      expect(nested?.execution).toMatchObject({
        capability: { profileId: 'nested-profile', nested: { enabled: true, maxDepth: 2 } },
        readonly: true,
      })
      expect(nested?.parentAgentId).toBe(records.find((record) => record.depth === 1)?.agentId)
      expect(nested?.rootAgentId).toBe(records.find((record) => record.depth === 1)?.agentId)
    } finally {
      await harness.close()
    }
  })

  it('lets a nested owner cancel only its direct child', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-control-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-control-profile',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_CANCEL',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('failed')
      const child = latestState(harness).records.find((record) => record.depth === 2)
      if (child === undefined) throw new Error('The canceled nested child is missing.')
      expect(child.status).toBe('aborted')
      expect(child?.error).toBe('Nested owner stopped the child.')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  }, 180_000)

  it('reports rejected cancellation from the nested control scope', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-cancel-receipt',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const original = harness.runtime.requestCancel.bind(harness.runtime)
      harness.runtime.requestCancel = (id, reason) => {
        if (latestState(harness).records.find((record) => record.agentId === id)?.depth !== 2)
          return original(id, reason)
        harness.state.requests.push(
          harness.state.blockedReady.promise.then(() => {
            for (const release of harness.state.blocked.splice(0)) release()
          }),
        )
        return false
      }
      harness.runtime.integrationStarted = () => true
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-cancel-receipt',
          prompt: 'NESTED_CANCEL',
          readonly: true,
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The parent did not complete.')
      expect(result.content).toContain('integration-started')
      expect(result.content).not.toContain('"status":"requested"')
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  }, 180_000)

  it('preserves completion and releases abort listeners when workspace cleanup fails', async () => {
    const harness = await createHarness()
    const signal = new AbortController().signal
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      const append = harness.pi.appendEntry.bind(harness.pi)
      let injected = false
      harness.pi.appendEntry = (type, data) => {
        if (
          !injected &&
          type === 'pi-subagent-state' &&
          JSON.stringify(data).includes('"lifecycleState":"cleanup-pending"')
        ) {
          injected = true
          throw new Error('Cleanup persistence failed')
        }
        append(type, data)
      }
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          subagent_type: 'generalPurpose',
          readonly: false,
          prompt: 'WRITE_ISOLATED',
          isolation: { mode: 'worktree', integration: 'apply' },
        },
        signal,
      })
      expect(injected).toBe(true)
      expect(getEventListeners(signal, 'abort')).toHaveLength(0)
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The completed result was lost.')
      expect(result.details.isolation?.cleanupDebt).toBe(true)
      expect(harness.runtime.latestResult(result.details.agentId)?.status).toBe('completed')
      expect(harness.runtime.latestResult(result.details.agentId)?.isolation?.cleanupDebt).toBe(
        true,
      )
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('settles and disposes a child when its admission callback throws', async () => {
    const harness = await createHarness()
    let id = ''
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: { ...baseInput, prompt: 'never dispatched' },
        signal: undefined,
        onStarted: (agentId) => {
          id = agentId
          throw new Error('Admission callback failed')
        },
      })
      expect(result.kind).toBe('failed')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      expect(harness.runtime.latestResult(id)?.status).toBe('failed')
      expect(harness.runtime.latestResult(id)?.error).toContain('Admission callback failed')
      await harness.runtime.shutdown()
    } finally {
      await harness.close()
    }
  })

  it('closes more than 256 successful descendants without losing their status', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'many-descendants',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          prompt: 'NESTED_MANY',
          capability_profile: 'many-descendants',
          readonly: true,
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The descendants did not complete.')
      expect(result.content).toBe('All 257 descendants completed.')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      expect(latestState(harness).records.length).toBeLessThanOrEqual(256)
    } finally {
      await harness.close()
    }
  }, 180_000)
})
