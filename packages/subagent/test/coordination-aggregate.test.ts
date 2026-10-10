import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vite-plus/test'

import { createBatchHarness } from './coordination-harness.ts'

describe('coordination finalization: aggregate fences', () => {
  it('preserves the staged patch when a coordinated join is rejected', async () => {
    const harness = await createBatchHarness()
    const joining = vi.spyOn(harness.runtime, 'joinCoordinated').mockResolvedValue({
      reason: 'invalid-lineage',
      receipt: undefined,
      revision: harness.runtime.currentRevision,
      status: 'rejected',
    })
    try {
      const result = await harness.run()
      const item = result.items[0]
      expect(result.status).toBe('failed')
      expect(item?.isolation?.captureStatus).toBe('captured')
      expect(item?.isolation?.repositories[0]?.patch.sha256).toHaveLength(64)
      expect(harness.states().at(-1)?.runs?.[0]?.tasks[0]?.isolation).toEqual(item?.isolation)
      expect(await readFile(join(harness.dir, 'shared.txt'), 'utf8')).toBe('base\n')
    } finally {
      joining.mockRestore()
      await harness.close()
    }
  }, 180_000)

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
})
