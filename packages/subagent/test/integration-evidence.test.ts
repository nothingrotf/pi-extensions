import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import { ManifestSchema } from '../src/workspace.ts'
import {
  EvidencePageSchema,
  agentId,
  baseInput,
  createHarness,
  execFileAsync,
  initializeHarnessRepository,
  latestState,
  latestToolDetailsBytes,
  runTask,
  runTaskControl,
} from './integration-harness.ts'

describe('subagent Task integration: evidence and cleanup', () => {
  it('exposes bulk receipt amplification through the actual TaskControl interface', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const result = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'manual', mode: 'worktree' },
        prompt: 'BULK_RECEIPT',
        subagent_type: 'generalPurpose',
      })
      const id = agentId(result)
      const status = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(Buffer.byteLength(status)).toBeLessThan(16 * 1024)
      expect(latestToolDetailsBytes(harness, 'TaskControl')).toBeLessThan(16 * 1024)
      const attempt = harness.runtime.getRecord(id)?.runGeneration
      if (attempt === undefined) throw new Error('The bulk attempt is unavailable.')
      const first = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt,
            limit: 8192,
            section: 'isolation',
          }),
        ),
      )
      expect(first.outcome).toBe('found')
      expect(first.freshness).toBe('current')
      expect(first.total_bytes).toBeGreaterThan(100_000)
      expect(Buffer.byteLength(first.content)).toBeLessThanOrEqual(8192)
      if (first.digest === null || first.next_cursor === null) {
        throw new Error('The bulk evidence did not paginate.')
      }
      const second = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt,
            cursor: first.next_cursor,
            digest: first.digest,
            limit: 8192,
            section: 'isolation',
          }),
        ),
      )
      expect(second.digest).toBe(first.digest)
      expect(second.cursor).toBe(first.next_cursor)
      expect(latestToolDetailsBytes(harness, 'TaskControl')).toBeLessThan(32 * 1024)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('limits the returned final text without truncating the transcript protocol', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, { ...baseInput, prompt: 'LARGE' })
      expect(result).toContain(
        '[Operational output truncated. Use TaskControl evidence for full content.]',
      )
      const id = agentId(result)
      const status = await runTaskControl(harness, { action: 'status', agent_id: id })
      expect(Buffer.byteLength(result)).toBeLessThanOrEqual(8 * 1024)
      expect(latestToolDetailsBytes(harness, 'Task')).toBeLessThan(16 * 1024)
      expect(Buffer.byteLength(status)).toBeLessThan(16 * 1024)
      expect(latestToolDetailsBytes(harness, 'TaskControl')).toBeLessThan(16 * 1024)
      const record = latestState(harness).records.at(-1)
      const output = record?.output ?? ''
      expect(new TextEncoder().encode(output).byteLength).toBeLessThanOrEqual(50 * 1024)
      if (record === undefined) throw new Error('The large-output record is missing.')
      const transcript = await readFile(record.sessionFile, 'utf8')
      if (record.artifact === undefined) throw new Error('The large-output artifact is missing.')
      const artifact = await readFile(new URL(record.artifact.uri), 'utf8')
      const evidence = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            limit: 8192,
            section: 'output',
          }),
        ),
      )
      expect(evidence.content).toContain('😀')
      expect(Buffer.byteLength(evidence.content)).toBeLessThanOrEqual(8192)
      expect(evidence.next_cursor).not.toBeNull()
      if (evidence.digest === null) throw new Error('The evidence digest is unavailable.')
      await harness.session.reload()
      expect(
        latestState(harness).records.find((candidate) => candidate.agentId === id)
          ?.evidenceArtifacts,
      ).toContainEqual(expect.objectContaining({ sha256: evidence.digest }))
      expect(
        await harness.runtime.readEvidence(
          id,
          record.runGeneration ?? 1,
          'output',
          evidence.digest,
        ),
      ).toBeDefined()
      const reloaded = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            limit: 8192,
            section: 'output',
          }),
        ),
      )
      expect(reloaded.digest, JSON.stringify(reloaded)).toBe(evidence.digest)
      await runTask(harness, { ...baseInput, prompt: 'second', resume: id })
      const resumed = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(resumed?.runGeneration).toBeGreaterThan(record.runGeneration ?? 1)
      const retained = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            digest: evidence.digest,
            limit: 8192,
            section: 'output',
          }),
        ),
      )
      expect(retained.content).toBe(evidence.content)
      const wrongAttempt = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: (resumed?.runGeneration ?? 1) + 1,
            limit: 8192,
            section: 'output',
          }),
        ),
      )
      expect(wrongAttempt.outcome).toBe('not-found')
      expect(new TextEncoder().encode(artifact).byteLength).toBeGreaterThan(60 * 1024)
      expect(artifact).not.toContain('[Output truncated at 50 KiB.]')
      expect(new TextEncoder().encode(transcript).byteLength).toBeGreaterThan(60 * 1024)
      expect(transcript).not.toContain('[Output truncated at 50 KiB.]')
      await writeFile(new URL(record.artifact.uri), 'tampered output', 'utf8')
      const tampered = await runTaskControl(harness, {
        action: 'evidence',
        agent_id: id,
        attempt: record.runGeneration ?? 1,
        digest: evidence.digest,
        limit: 8192,
        section: 'output',
      })
      expect(tampered).toContain('failed digest verification')
    } finally {
      await harness.close()
    }
  })

  it('paginates synthesized legacy evidence after reload and rejects digest mismatch', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, { ...baseInput, prompt: 'LARGE' })
      const id = agentId(result)
      const record = harness.runtime.getRecord(id)
      if (record === undefined) throw new Error('The legacy evidence record is unavailable.')
      const { evidenceArtifacts: _evidenceArtifacts, ...legacyRecord } = record
      harness.session.sessionManager.appendCustomEntry('pi-subagent-state', {
        ownerSessionId: harness.session.sessionManager.getSessionId(),
        records: [legacyRecord],
        runs: [],
        version: 5,
      })
      await harness.session.reload()

      const first = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            limit: 4096,
            section: 'output',
          }),
        ),
      )
      expect(first.outcome).toBe('found')
      expect(first.next_cursor).not.toBeNull()
      if (first.digest === null || first.next_cursor === null) {
        throw new Error('The legacy output did not paginate.')
      }
      const second = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            cursor: first.next_cursor,
            digest: first.digest,
            limit: 4096,
            section: 'output',
          }),
        ),
      )
      expect(second.outcome).toBe('found')
      expect(second.digest).toBe(first.digest)
      const mismatch = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt: record.runGeneration ?? 1,
            cursor: first.next_cursor,
            digest: '0'.repeat(64),
            limit: 4096,
            section: 'output',
          }),
        ),
      )
      expect(mismatch.outcome).toBe('not-found')
    } finally {
      await harness.close()
    }
  })

  it('rejects a tampered persisted evidence manifest through TaskControl', async () => {
    const harness = await createHarness()
    try {
      const result = await runTask(harness, { ...baseInput, prompt: 'manifest evidence' })
      const id = agentId(result)
      const record = harness.runtime.getRecord(id)
      if (record === undefined) throw new Error('The evidence record is unavailable.')
      const manifest = record.evidenceArtifacts?.at(-1)
      if (manifest === undefined) throw new Error('The evidence manifest is unavailable.')
      await writeFile(new URL(manifest.uri), '{"tampered":true}', 'utf8')
      const response = await runTaskControl(harness, {
        action: 'evidence',
        agent_id: id,
        attempt: record.runGeneration ?? 1,
        digest: manifest.sha256,
        limit: 8192,
        section: 'gates',
      })
      expect(response).toContain('failed digest verification')
    } finally {
      await harness.close()
    }
  })

  it('cleans an allocated workspace when registration persistence fails', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      let workspace: Parameters<typeof harness.runtime.registerWorkspace>[0] | undefined
      const register = harness.runtime.registerWorkspace.bind(harness.runtime)
      harness.runtime.registerWorkspace = (allocated) => {
        workspace = allocated
        register(allocated)
      }
      const append = harness.pi.appendEntry.bind(harness.pi)
      let injected = false
      harness.pi.appendEntry = (type, data) => {
        if (
          !injected &&
          type === 'pi-subagent-state' &&
          JSON.stringify(data).includes('"lifecycleState":"active"')
        ) {
          injected = true
          throw new Error('Workspace registration persistence failed')
        }
        append(type, data)
      }
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'never dispatched',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(injected).toBe(true)
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The task unexpectedly succeeded.')
      expect(result.details.error).toContain('Workspace registration persistence failed')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      if (workspace === undefined) throw new Error('No workspace was allocated.')
      await expect(readFile(join(workspace.rootWorktree, 'AGENTS.md'))).rejects.toThrow('ENOENT')
      expect(await readFile(join(harness.dir, 'AGENTS.md'), 'utf8')).toContain(
        'PROJECT_CONTEXT_SENTINEL',
      )
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('cleans an allocated workspace when a resumed transcript changes Agent ID', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const initial = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'apply', mode: 'worktree' },
        prompt: 'initial isolated task',
        readonly: false,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(initial)
      const prior = harness.runtime.getRecord(id)
      if (prior === undefined) throw new Error('The initial run is missing.')
      const transcript = await readFile(prior.sessionFile, 'utf8')
      await writeFile(prior.sessionFile, transcript.replace(id, 'changed-transcript-id'))
      let workspace: Parameters<typeof harness.runtime.registerWorkspace>[0] | undefined
      const register = harness.runtime.registerWorkspace.bind(harness.runtime)
      harness.runtime.registerWorkspace = (allocated) => {
        workspace = allocated
        register(allocated)
      }
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          prompt: 'never dispatched',
          resume: id,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The task unexpectedly succeeded.')
      expect(result.details.error).toContain(
        'The resumed transcript returned a different Agent ID.',
      )
      expect(harness.runtime.hasActiveRun()).toBe(false)
      if (workspace === undefined) throw new Error('No workspace was allocated.')
      await expect(readFile(join(workspace.rootWorktree, 'AGENTS.md'))).rejects.toThrow('ENOENT')
      expect(harness.runtime.getRecord(id)?.status).toBe('completed')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('captures unadmitted changes before cleanup when run record persistence fails', async () => {
    const harness = await createHarness()
    const { writeFileSync } = await import('node:fs')
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      let workspace: Parameters<typeof harness.runtime.registerWorkspace>[0] | undefined
      const register = harness.runtime.registerWorkspace.bind(harness.runtime)
      harness.runtime.registerWorkspace = (allocated) => {
        workspace = allocated
        register(allocated)
      }
      const append = harness.pi.appendEntry.bind(harness.pi)
      let injected = false
      harness.pi.appendEntry = (type, data) => {
        if (
          !injected &&
          type === 'pi-subagent-state' &&
          JSON.stringify(data).includes('"status":"running"')
        ) {
          injected = true
          if (workspace === undefined) throw new Error('No workspace was allocated.')
          writeFileSync(join(workspace.rootWorktree, 'unadmitted.txt'), 'retain this change\n')
          throw new Error('Run record persistence failed')
        }
        append(type, data)
      }
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'never dispatched',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(injected).toBe(true)
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The task unexpectedly succeeded.')
      expect(result.details.error).toContain('Run record persistence failed')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      if (workspace === undefined) throw new Error('No workspace was allocated.')
      await expect(readFile(join(workspace.rootWorktree, 'unadmitted.txt'))).rejects.toThrow(
        'ENOENT',
      )
      const refs = await execFileAsync(
        'git',
        ['for-each-ref', '--format=%(refname)', 'refs/pi-subagent'],
        {
          cwd: harness.dir,
        },
      )
      const attemptId = workspace.attemptId
      const ref = refs.stdout.split('\n').find((line) => line.includes(attemptId))
      if (ref === undefined) throw new Error('The captured failure artifact is missing.')
      const artifact = await execFileAsync('git', ['show', `${ref}:unadmitted.txt`], {
        cwd: harness.dir,
      })
      expect(artifact.stdout).toBe('retain this change\n')
      await expect(readFile(join(harness.dir, 'unadmitted.txt'))).rejects.toThrow('ENOENT')
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('retains unadmitted workspace artifacts and cleanup debt when capture fails', async () => {
    const harness = await createHarness()
    const { rmSync } = await import('node:fs')
    try {
      await initializeHarnessRepository(harness)
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      let workspace: Parameters<typeof harness.runtime.registerWorkspace>[0] | undefined
      const register = harness.runtime.registerWorkspace.bind(harness.runtime)
      harness.runtime.registerWorkspace = (allocated) => {
        workspace = allocated
        register(allocated)
      }
      const append = harness.pi.appendEntry.bind(harness.pi)
      let injected = false
      harness.pi.appendEntry = (type, data) => {
        if (
          !injected &&
          type === 'pi-subagent-state' &&
          JSON.stringify(data).includes('"lifecycleState":"active"')
        ) {
          injected = true
          if (workspace === undefined) throw new Error('No workspace was allocated.')
          rmSync(join(workspace.rootWorktree, '.git'), { force: true, recursive: true })
          throw new Error('Workspace registration persistence failed')
        }
        append(type, data)
      }
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          isolation: { integration: 'apply', mode: 'worktree' },
          prompt: 'never dispatched',
          readonly: false,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(injected).toBe(true)
      expect(result.kind).toBe('failed')
      if (result.kind !== 'failed') throw new Error('The task unexpectedly succeeded.')
      expect(result.details.error).toContain('Workspace registration persistence failed')
      expect(harness.runtime.hasActiveRun()).toBe(false)
      if (workspace === undefined) throw new Error('No workspace was allocated.')
      expect(await readFile(join(workspace.rootWorktree, 'AGENTS.md'), 'utf8')).toContain(
        'PROJECT_CONTEXT_SENTINEL',
      )
      const manifest = Value.Decode(
        ManifestSchema,
        JSON.parse(await readFile(workspace.manifestPath, 'utf8')),
      )
      expect(manifest.state).toBe('cleanup-debt')
      expect(
        harness.session.sessionManager
          .getBranch()
          .some(
            (entry) =>
              entry.type === 'custom' &&
              entry.customType === 'pi-subagent-state' &&
              JSON.stringify(entry.data).includes('"lifecycleState":"cleanup-debt"'),
          ),
      ).toBe(true)
    } finally {
      await harness.close()
    }
  }, 180_000)
})
