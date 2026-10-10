import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import { ManifestSchema } from '../src/workspace.ts'
import {
  agentId,
  baseInput,
  createHarness,
  execFileAsync,
  initializeHarnessRepository,
  latestState,
  runTask,
} from './integration-harness.ts'

describe('subagent Task integration: resume and retained capture', () => {
  it('resumes the same transcript and preserves context and ownership', async () => {
    const harness = await createHarness()
    try {
      const first = await runTask(harness, baseInput)
      const id = agentId(first)
      expect(first).toContain('child:first')
      const firstArtifact = latestState(harness).records.find(
        (record) => record.agentId === id,
      )?.artifact
      if (firstArtifact === undefined) throw new Error('The first artifact is missing.')
      harness.runtime.restore(harness.context())

      const second = await runTask(harness, {
        ...baseInput,
        prompt: 'second',
        resume: id,
      })
      expect(agentId(second)).toBe(id)
      expect(second).toContain('child:first|second')
      const secondArtifact = latestState(harness).records.find(
        (record) => record.agentId === id,
      )?.artifact
      expect(secondArtifact?.uri).not.toBe(firstArtifact.uri)
      expect(secondArtifact?.attempt).toBeGreaterThan(firstArtifact.attempt)
      expect(await readFile(new URL(firstArtifact.uri), 'utf8')).toBe('child:first')
      const snapshot = harness.runtime.listSnapshots().find((item) => item.agentId === id)
      expect(snapshot?.endedAt).toBeDefined()
      expect((snapshot?.endedAt ?? 0) - (snapshot?.startedAt ?? 0)).toBe(snapshot?.usage.durationMs)

      const wrongModel = await runTask(harness, {
        ...baseInput,
        model: 'openai-codex/not-fast:high',
        prompt: 'third',
        resume: id,
      })
      expect(wrongModel).toContain('Task failed: A resumed Task must preserve the original model.')
      expect(wrongModel).toContain(`Agent ID: ${id}`)

      const changedMode = await runTask(harness, {
        ...baseInput,
        prompt: 'changed mode',
        resume: id,
        schemaMode: 'strict',
      })
      expect(changedMode).toContain('must preserve the original schema mode')
      const changedGates = await runTask(harness, {
        ...baseInput,
        gates: [{ expected: 'completed', type: 'status' }],
        prompt: 'changed gates',
        resume: id,
      })
      expect(changedGates).toContain('must preserve the original output gates')
      const changedSchema = await runTask(harness, {
        ...baseInput,
        outputSchema: { type: 'string' },
        prompt: 'changed schema',
        resume: id,
      })
      expect(changedSchema).toContain('must preserve the original output schema')
    } finally {
      await harness.close()
    }
  })

  it('reconstructs a failed isolated attempt through the public resume path', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const first = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_AND_FAIL',
        readonly: false,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(first)
      expect(first).toContain('The child reached its output token limit.')
      await expect(readFile(join(harness.dir, 'isolated.txt'))).rejects.toThrow(/ENOENT/)
      const captured = harness.runtime.getRecord(id)?.isolation
      expect(captured?.status).toBe('captured')

      const resumed = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'resume retained work',
        readonly: false,
        resume: id,
        subagent_type: 'generalPurpose',
      })
      expect(resumed).toContain('child:WRITE_AND_FAIL|resume retained work')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      const record = harness.runtime.getRecord(id)
      expect(record?.isolationAttempts).toHaveLength(2)
      expect(record?.isolation?.status).toBe('integrated')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('recaptures a repaired retained workspace before resuming the same owner', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const first = await runTask(harness, {
        ...baseInput,
        isolation: { mode: 'worktree', integration: 'apply' },
        prompt: 'WRITE_RETAINED_BOUNDARY',
        readonly: false,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(first)
      const retained = harness.runtime.getRecord(id)?.isolation
      expect(retained?.captureStatus).toBe('failed')
      if (retained?.retainedPath === undefined)
        throw new Error('The retained workspace is missing.')
      expect(await readFile(join(retained.retainedPath, 'retained.txt'), 'utf8')).toBe(
        'retained product\n',
      )
      await rm(join(retained.retainedPath, 'nested', '.git'), { recursive: true })
      const resumed = await runTask(harness, {
        ...baseInput,
        prompt: 'resume retained work',
        resume: id,
        readonly: false,
        subagent_type: 'generalPurpose',
      })
      expect(resumed).toContain('child:WRITE_RETAINED_BOUNDARY|resume retained work')
      expect(harness.runtime.getRecord(id)?.status).toBe('completed')
      expect(latestState(harness).records).toHaveLength(1)
      expect(
        latestState(harness).workspaces.find(
          (workspace) => workspace.workspaceId === retained.workspaceId,
        ),
      ).toBeUndefined()
      expect(await readFile(join(harness.dir, 'retained.txt'), 'utf8')).toBe('retained product\n')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it.each(['boundary', 'owner', 'git-directory'])(
    'preserves failed retained capture with invalid %s evidence',
    async (scenario) => {
      const harness = await createHarness()
      try {
        await initializeHarnessRepository(harness)
        const first = await runTask(harness, {
          ...baseInput,
          isolation: { mode: 'worktree', integration: 'apply' },
          prompt: 'WRITE_RETAINED_BOUNDARY',
          readonly: false,
          subagent_type: 'generalPurpose',
        })
        const id = agentId(first)
        const retained = harness.runtime.getRecord(id)?.isolation
        if (retained?.retainedPath === undefined || retained.manifestUri === undefined)
          throw new Error('Retained evidence is missing.')
        if (scenario === 'owner') {
          const manifest = Value.Decode(
            ManifestSchema,
            JSON.parse(await readFile(retained.manifestUri, 'utf8')),
          )
          await writeFile(
            retained.manifestUri,
            JSON.stringify({ ...manifest, ownerSessionId: 'foreign-owner' }),
          )
        }
        if (scenario === 'git-directory') {
          await rename(
            join(retained.retainedPath, '.git'),
            join(retained.retainedPath, '.git-private'),
          )
          await writeFile(
            join(retained.retainedPath, '.git'),
            `gitdir: ${join(harness.dir, '.git')}\n`,
          )
        }
        const resumed = await runTask(harness, {
          ...baseInput,
          prompt: 'resume retained work',
          resume: id,
          readonly: false,
          subagent_type: 'generalPurpose',
        })
        expect(resumed).toContain('Task failed:')
        expect(harness.runtime.getRecord(id)?.isolation).toEqual(retained)
        expect(latestState(harness).records).toHaveLength(1)
        expect(await readFile(join(retained.retainedPath, 'retained.txt'), 'utf8')).toBe(
          'retained product\n',
        )
        await expect(readFile(join(harness.dir, 'retained.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      } finally {
        await harness.close()
      }
    },
    180_000,
  )

  it.each([false, true])(
    'resumes verified retained work already adopted in the source with commit=%s',
    async (committed) => {
      const harness = await createHarness()
      try {
        await initializeHarnessRepository(harness)
        const first = await runTask(harness, {
          ...baseInput,
          isolation: { mode: 'worktree', integration: 'manual' },
          prompt: 'WRITE_ISOLATED',
          readonly: false,
          subagent_type: 'generalPurpose',
        })
        const id = agentId(first)
        const captured = harness.runtime.getRecord(id)?.isolation
        const patch = captured?.repositories[0]?.patch
        if (patch === undefined) throw new Error('The captured patch is missing.')
        await execFileAsync('git', ['apply', fileURLToPath(patch.uri)], { cwd: harness.dir })
        if (committed) {
          await execFileAsync('git', ['add', 'isolated.txt'], { cwd: harness.dir })
          await execFileAsync('git', ['commit', '-qm', 'adopt retained patch'], {
            cwd: harness.dir,
          })
        }
        const resumed = await runTask(harness, {
          ...baseInput,
          prompt: 'verify adopted work',
          resume: id,
          readonly: false,
          subagent_type: 'generalPurpose',
        })
        expect(resumed).toContain('child:WRITE_ISOLATED|verify adopted work')
        expect(harness.runtime.getRecord(id)?.status).toBe('completed')
        expect(latestState(harness).records).toHaveLength(1)
        expect(harness.runtime.getRecord(id)?.isolation?.repositories[0]?.baselineTree).toBe(
          captured?.repositories[0]?.resultTree,
        )
        expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
      } finally {
        await harness.close()
      }
    },
    180_000,
  )

  it('keeps retained WIP recoverable when an unrelated source edit blocks resume', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const first = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'WRITE_AND_FAIL',
        readonly: false,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(first)
      const captured = harness.runtime.getRecord(id)?.isolation
      const patch = captured?.repositories[0]?.patch
      if (patch === undefined) throw new Error('Retained WIP evidence is missing.')
      await writeFile(join(harness.dir, 'unrelated.txt'), 'concurrent source edit\n')
      const resumed = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'resume retained work',
        readonly: false,
        resume: id,
        subagent_type: 'generalPurpose',
      })
      expect(resumed).toContain('captured baseline')
      expect(resumed).toContain(patch.uri)
      expect(harness.runtime.getRecord(id)?.isolation).toEqual(captured)
      expect(await readFile(new URL(patch.uri), 'utf8')).toContain('isolated content')
      expect(await readFile(join(harness.dir, 'unrelated.txt'), 'utf8')).toBe(
        'concurrent source edit\n',
      )
      await expect(readFile(join(harness.dir, 'isolated.txt'))).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('recaptures workspace identity when an isolated attempt joins', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const first = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        subagent_type: 'generalPurpose',
        prompt: 'WRITE_ISOLATED',
      })
      const id = agentId(first)
      const firstRecord = latestState(harness).records.find((record) => record.agentId === id)
      if (firstRecord === undefined) throw new Error('The first record is missing.')
      const firstExecution = firstRecord.execution
      if (firstExecution?.version !== 5) throw new Error('The first execution contract is missing.')
      const firstIdentity = firstExecution.workspaceIdentity
      const firstReceipt = firstRecord.toolExecutionReceipts?.find(
        (receipt) => receipt.tool === 'write',
      )
      if (firstIdentity === undefined || firstReceipt === undefined) {
        throw new Error('The first attempt identity or receipt is missing.')
      }
      expect(firstRecord?.isolationAttempts).toHaveLength(1)

      const resumed = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        subagent_type: 'generalPurpose',
        prompt: 'second isolated attempt',
        resume: id,
      })
      expect(resumed).toContain('child:WRITE_ISOLATED|second isolated attempt')
      const resumedRecord = latestState(harness).records.find((record) => record.agentId === id)
      const resumedExecution = resumedRecord?.execution
      if (resumedExecution?.version !== 5)
        throw new Error('The resumed execution contract is missing.')
      expect(resumedRecord?.isolationAttempts).toHaveLength(2)
      expect(resumedExecution.workspaceIdentity?.expectedTree).not.toBe(firstIdentity.expectedTree)
      expect(resumedRecord?.toolExecutionReceipts).toEqual([])
      expect(await readFile(new URL(firstReceipt.output.uri), 'utf8')).toContain('isolated.txt')

      const reviewer = await runTask(harness, {
        description: 'Review the joined candidate',
        prompt: 'RETURN_TOOLS',
        readonly: true,
        subagent_type: 'explore',
      })
      expect(reviewer).toContain(
        'tools:ask_parent,find,grep,ls,notify_parent,read,request_parent,update_progress',
      )
      const reviewerRecord = latestState(harness).records.find(
        (record) => record.agentId === agentId(reviewer),
      )
      const reviewerExecution = reviewerRecord?.execution
      if (reviewerExecution?.version !== 5)
        throw new Error('The reviewer execution contract is missing.')
      expect(reviewerExecution.workspaceIdentity?.expectedTree).toBe(
        resumedExecution.workspaceIdentity?.expectedTree,
      )
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('redacts and bounds current tool receipt output', async () => {
    const harness = await createHarness()
    try {
      await writeFile(
        join(harness.dir, 'receipt.txt'),
        `BODY=${'x'.repeat(60 * 1024)}\nTOKEN=receipt-secret\n`,
        'utf8',
      )
      await runTask(harness, {
        description: 'Read the receipt fixture',
        prompt: 'READ_SECRET_RECEIPT',
        readonly: true,
        subagent_type: 'explore',
      })
      const receipt = latestState(harness).records.at(-1)?.toolExecutionReceipts?.[0]
      if (receipt === undefined) throw new Error('The read receipt is missing.')
      const output = await readFile(new URL(receipt.output.uri), 'utf8')
      expect(output).not.toContain('receipt-secret')
      expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(50 * 1024)
    } finally {
      await harness.close()
    }
  })

  it('rejects foreign ownership without exposing foreign record details', async () => {
    const harness = await createHarness()
    try {
      const first = await runTask(harness, baseInput)
      const id = agentId(first)
      const state = latestState(harness)
      const record = state.records.find((candidate) => candidate.agentId === id)
      if (record === undefined) throw new Error('The child record is missing.')
      harness.pi.appendEntry('pi-subagent-state', {
        ownerSessionId: state.ownerSessionId,
        records: [{ ...record, ownerSessionId: 'foreign-owner' }],
        version: 1,
      })
      harness.runtime.restore({ sessionManager: harness.session.sessionManager })
      const result = await runTask(harness, { ...baseInput, prompt: 'foreign', resume: id })
      expect(result).toContain(
        'Task failed: The requested Agent ID does not belong to the current parent session.',
      )
      expect(result).not.toContain(record.sessionFile)
      expect(result).not.toContain(`Agent ID: ${id}`)
    } finally {
      await harness.close()
    }
  })

  it('rejects role and read-only policy changes during resume', async () => {
    const harness = await createHarness()
    try {
      const mutable = agentId(
        await runTask(harness, { ...baseInput, subagent_type: 'generalPurpose' }),
      )
      const wrongRole = await runTask(harness, {
        ...baseInput,
        prompt: 'wrong role',
        resume: mutable,
        subagent_type: 'shell',
      })
      expect(wrongRole).toContain('A resumed Task must use the original subagent_type.')
      const addReadonly = await runTask(harness, {
        ...baseInput,
        prompt: 'add readonly',
        readonly: true,
        resume: mutable,
        subagent_type: 'generalPurpose',
      })
      expect(addReadonly).toContain('A resumed Task must preserve the original readonly policy.')

      const readonly = agentId(await runTask(harness, { ...baseInput, readonly: true }))
      const removeReadonly = await runTask(harness, {
        ...baseInput,
        prompt: 'remove readonly',
        readonly: false,
        resume: readonly,
      })
      expect(removeReadonly).toContain('A resumed Task must preserve the original readonly policy.')
    } finally {
      await harness.close()
    }
  })

  it('rejects missing transcripts and divergent transcript session IDs', async () => {
    const harness = await createHarness()
    try {
      const missingId = agentId(await runTask(harness, baseInput))
      const missingRecord = latestState(harness).records.find(
        (candidate) => candidate.agentId === missingId,
      )
      if (missingRecord === undefined) throw new Error('The child record is missing.')
      await rm(missingRecord.sessionFile, { force: true })
      const missing = await runTask(harness, {
        ...baseInput,
        prompt: 'missing transcript',
        resume: missingId,
      })
      expect(missing).toContain('The child transcript does not exist:')
      expect(missing).toContain(`Agent ID: ${missingId}`)

      const divergentId = agentId(await runTask(harness, baseInput))
      const divergentRecord = latestState(harness).records.find(
        (candidate) => candidate.agentId === divergentId,
      )
      if (divergentRecord === undefined) throw new Error('The child record is missing.')
      const transcript = await readFile(divergentRecord.sessionFile, 'utf8')
      await writeFile(
        divergentRecord.sessionFile,
        transcript.replace(divergentId, 'different-session-id'),
      )
      const divergent = await runTask(harness, {
        ...baseInput,
        prompt: 'divergent transcript',
        resume: divergentId,
      })
      expect(divergent).toContain('The resumed transcript returned a different Agent ID.')
      expect(divergent).toContain(`Agent ID: ${divergentId}`)
    } finally {
      await harness.close()
    }
  })
})
