import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vite-plus/test'

import { createBatchHarness } from './coordination-harness.ts'

describe('coordination finalization: terminal state', () => {
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
