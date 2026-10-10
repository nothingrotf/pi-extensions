import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vite-plus/test'

import {
  agentId,
  baseInput,
  createHarness,
  initializeHarnessRepository,
  latestState,
  runTask,
} from './integration-harness.ts'

describe('subagent Task integration: nested writers', () => {
  it('resumes a nested child inside an isolated parent workspace', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-self-resume-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-self-resume-profile',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_SELF_RESUME',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The nested resume did not complete.')
      expect(result.content).toContain('nested resume complete')
      const child = latestState(harness).records.find((record) => record.depth === 2)
      expect(child?.runGeneration).toBe(4)
      expect(child?.status).toBe('completed')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('rejects a nested cwd outside the parent workspace', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-cwd-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-cwd-profile',
          prompt: 'NESTED_ESCAPE',
          readonly: true,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The nested cwd test did not complete.')
      expect(result.content).toContain('escapes its workspace root')
      expect(latestState(harness).records.filter((record) => record.depth === 2)).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('integrates a nested writer through its immediate parent workspace', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-writer-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-writer-profile',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_WRITE_ISOLATED',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The nested writer did not complete.')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      const records = latestState(harness).records.filter(
        (record) => record.runId === result.details.runId,
      )
      expect(
        records.map((record) => record.depth ?? 0).sort((left, right) => left - right),
      ).toEqual([1, 2])
      const child = records.find((record) => record.depth === 2)
      const parent = records.find((record) => record.depth === 1)
      expect(child?.isolation?.parentWorkspaceId).toBe(parent?.isolation?.workspaceId)
      expect(child?.isolation?.rootVisibility).toBe('visible')
      expect(parent?.isolation?.rootVisibility).toBe('visible')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('does not apply a foreground writer after a non-isolated parent failure', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-foreground-failure-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-foreground-failure-profile',
          prompt: 'NESTED_WRITE_FAIL',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The parent failure was not reported.')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const descendants = latestState(harness).records.filter(
        (record) => record.runId === result.details.runId && record.depth === 2,
      )
      expect(descendants[0]?.isolation?.rootVisibility).toBe('blocked')
      expect(descendants[0]?.isolation?.integrationStatus).toBe('staged')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('does not publish a successful sibling after another descendant fails', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-sibling-failure-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-sibling-failure-profile',
          prompt: 'NESTED_SIBLING_FAILURE',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed' || !('runId' in result.details)) {
        throw new Error('The mixed descendant failure did not preserve its run identity.')
      }
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const parent = latestState(harness).records.find(
        (record) => record.runId === result.details.runId && record.depth === 1,
      )
      expect(parent?.isolation?.rootVisibility).toBe('pending')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('drains a background nested writer at successful parent closure', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-background-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-background-profile',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_BACKGROUND_WRITE',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('honors cancellation after the parent model stops while descendants drain', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'late-cancel',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      let parentId = ''
      const resultPromise = harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'late-cancel',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_BACKGROUND_BLOCK',
          subagent_type: 'generalPurpose',
        },
        onStarted: (id) => {
          parentId = id
        },
        signal: undefined,
      })
      await harness.state.blockedReady.promise
      expect(
        harness.runtime.listSnapshots().find((entry) => entry.agentId === parentId)?.lastActivity,
      ).toContain('nested-background-result')
      expect(harness.runtime.requestCancel(parentId, 'Cancel during descendant drain')).toBe(true)
      for (const release of harness.state.blocked.splice(0)) release()
      const result = await resultPromise
      expect(result.kind).toBe('failed')
      expect(harness.runtime.getRecord(parentId)?.status).toBe('aborted')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      for (const release of harness.state.blocked.splice(0)) release()
      await harness.close()
    }
  }, 180_000)

  it('does not apply a background descendant after parent failure', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.runtime.registerCapabilityProfile({
        id: 'nested-background-failure-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-background-failure-profile',
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'NESTED_BACKGROUND_FAIL',
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The parent failure was not reported.')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const descendants = latestState(harness).records.filter(
        (record) => record.runId === result.details.runId && record.depth === 2,
      )
      expect(descendants[0]?.isolation?.rootVisibility).toBe('blocked')
      expect(descendants[0]?.status).toBe('aborted')
      expect(descendants[0]?.isolation?.integrationStatus).toBe('not-requested')
      const patchUri = descendants[0]?.isolation?.repositories[0]?.patch.uri
      if (patchUri === undefined) throw new Error('The descendant patch is unavailable.')
      expect(await readFile(fileURLToPath(patchUri), 'utf8')).toContain('isolated.txt')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('rejects a nested resume from another lineage', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      const target = await runTask(harness, { ...baseInput, prompt: 'resume target' })
      const targetId = agentId(target)
      const targetGeneration = latestState(harness).records.find(
        (record) => record.agentId === targetId,
      )?.runGeneration
      harness.runtime.registerCapabilityProfile({
        id: 'nested-resume-profile',
        nested: { maxDepth: 2 },
        registrations: [],
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'nested-resume-profile',
          prompt: `NESTED_RESUME:${targetId}`,
        },
        signal: undefined,
      })
      if (result.kind === 'failed') throw new Error(result.details.error)
      if (result.kind === 'background') throw new Error('The nested owner became background work.')
      expect(result.content).toContain('can resume only its own lineage')
      const targetRecord = latestState(harness).records.find(
        (record) => record.agentId === targetId,
      )
      expect(targetRecord?.runGeneration).toBe(targetGeneration)
    } finally {
      await harness.close()
    }
  })
})
