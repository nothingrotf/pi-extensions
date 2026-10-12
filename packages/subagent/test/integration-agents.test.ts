import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { describe, expect, it } from 'vite-plus/test'

import {
  acquireSubagentController,
  registerSubagent,
  SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT,
  SUBAGENT_CAPABILITY_REGISTRATION_EVENT,
  SUBAGENT_REGISTRATION_EVENT,
} from '../src/index.ts'
import { type TaskInput } from '../src/schema.ts'
import {
  EvidencePageSchema,
  agentId,
  baseInput,
  createHarness,
  execFileAsync,
  initializeHarnessRepository,
  latestState,
  linkedWorktree,
  runTask,
  runTaskControl,
} from './integration-harness.ts'

describe('subagent Task integration: registered agents and preflight', () => {
  it('acquires one controller and keeps registration idempotent', async () => {
    const harness = await createHarness()
    try {
      expect(acquireSubagentController(harness.pi)).toBe(harness.controller)
      expect(registerSubagent(harness.pi)).toBe(harness.runtime)
      const names = harness.pi.getAllTools().map((tool) => tool.name)
      expect(names.filter((name) => name === 'Task')).toEqual(['Task'])
      expect(names.filter((name) => name === 'TaskControl')).toEqual(['TaskControl'])
      expect(names).not.toContain('ask_parent')
      expect(names).not.toContain('notify_parent')
      expect(names).not.toContain('update_progress')
    } finally {
      await harness.close()
    }
  })

  it('documents the controller boundary across physical package copies', async () => {
    const harness = await createHarness()
    const packageRoot = join(import.meta.dirname, '..')
    const copyRoot = await mkdtemp(join(packageRoot, '.physical-copy-'))
    try {
      await cp(join(packageRoot, 'src'), join(copyRoot, 'src'), { recursive: true })
      const moduleUrl = pathToFileURL(join(copyRoot, 'src', 'controller.ts')).href
      const PhysicalControllerSchema = Type.Object(
        { acquireSubagentController: Type.Function([Type.Unknown()], Type.Unknown()) },
        { additionalProperties: true },
      )
      const physical = Value.Decode(PhysicalControllerSchema, await import(moduleUrl))
      const first = acquireSubagentController(harness.pi)
      const second = physical.acquireSubagentController(harness.pi)
      expect(second).not.toBe(first)
    } finally {
      await rm(copyRoot, { force: true, recursive: true })
      await harness.close()
    }
  })

  it('prevents dropping the registered agent mandatory model policy', async () => {
    const harness = await createHarness()
    try {
      harness.runtime.registerCapability({
        id: 'mandatory-model',
        version: '1',
        tools: [],
        extensions: [],
        modelPolicy: {
          status: 'valid',
          enforcement: 'configured',
          roles: [{ role: 'feature', selectors: ['inherit-parent'] }],
        },
      })
      harness.runtime.registerCapabilityProfiles([
        { id: 'mandatory-profile', registrations: ['mandatory-model'] },
        { id: 'unrestricted-profile', registrations: [] },
      ])
      harness.controller.registerAgents('mandatory-agent', [
        {
          name: 'mandatory-agent',
          description: 'Policy fixture',
          effort: 'low',
          readonly: true,
          systemPrompt: 'Policy fixture',
          tools: ['read'],
          capabilityProfile: 'mandatory-profile',
        },
      ])
      const result = await runTask(harness, {
        ...baseInput,
        subagent_type: 'mandatory-agent',
        role: 'feature',
        capability_profile: 'unrestricted-profile',
      })
      expect(result).toContain('mandatory model policies')
      harness.runtime.registerCapabilityProfile({
        id: 'mandatory-nested',
        registrations: ['mandatory-model'],
        nested: { maxDepth: 2 },
      })
      expect(
        await runTask(harness, {
          ...baseInput,
          role: 'feature',
          capability_profile: 'mandatory-nested',
          model: 'inherit-parent',
          prompt: `NESTED_CAPABILITY:${JSON.stringify({
            description: 'Drop inherited policy',
            prompt: 'RETURN_TOOLS',
            subagent_type: 'generalPurpose',
            role: 'feature',
            capability_profile: 'unrestricted-profile',
          })}`,
        }),
      ).toContain('parent mandatory model policies')

      const publication = {
        sourceId: 'hot-policy',
        registrations: [
          {
            id: 'hot-policy',
            version: '1',
            tools: [],
            extensions: [],
            systemPrompt: 'First prompt',
          },
        ],
      }
      harness.pi.events.emit(SUBAGENT_CAPABILITY_REGISTRATION_EVENT, publication)
      harness.runtime.registerCapabilityProfile({
        id: 'hot-profile',
        registrations: ['hot-policy'],
      })
      harness.pi.events.emit(SUBAGENT_CAPABILITY_REGISTRATION_EVENT, {
        ...publication,
        registrations: publication.registrations.map((registration) => ({
          ...registration,
          systemPrompt: 'Refreshed prompt',
          modelPolicy: { status: 'invalid', error: 'REFRESHED_POLICY_ERROR' },
        })),
      })
      expect(
        await runTask(harness, {
          ...baseInput,
          capability_profile: 'hot-profile',
          role: 'feature',
        }),
      ).toContain('REFRESHED_POLICY_ERROR')
    } finally {
      await harness.close()
    }
  })

  it('runs registered agents with display names and freezes their contract for resume', async () => {
    const harness = await createHarness()
    const unregister = harness.controller.registerAgents('integration', [
      {
        description: 'Custom integration agent',
        effort: 'low',
        name: 'Comment Sicko',
        readonly: true,
        systemPrompt: 'CUSTOM_AGENT_SENTINEL',
        tools: ['read', 'bash'],
      },
    ])
    try {
      const unknown = await runTask(harness, {
        ...baseInput,
        subagent_type: 'implementation',
      })
      expect(unknown).toContain(
        'Available built-in and registered extension types: generalPurpose, explore, shell, debug, Comment Sicko.',
      )
      const first = await runTask(harness, {
        ...baseInput,
        prompt: 'RETURN_PROFILE',
        subagent_type: 'Comment Sicko',
      })
      expect(first).toContain(
        'profile:custom;tools:ask_parent,notify_parent,read,request_parent,update_progress',
      )
      const id = agentId(first)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      expect(record?.execution).toMatchObject({
        agentName: 'Comment Sicko',
        agentSource: { id: 'integration', kind: 'extension' },
        readonly: true,
        systemPrompt: 'CUSTOM_AGENT_SENTINEL',
        tools: ['read'],
      })

      unregister()
      const resumed = await runTask(harness, {
        ...baseInput,
        prompt: 'RETURN_PROFILE',
        resume: id,
        subagent_type: 'Comment Sicko',
      })
      expect(resumed).toContain(
        'profile:custom;tools:ask_parent,notify_parent,read,request_parent,update_progress',
      )
    } finally {
      unregister()
      await harness.close()
    }
  })

  it('registers nested capability profiles through the shared event bus', async () => {
    const harness = await createHarness()
    try {
      await runTask(harness, { ...baseInput, prompt: 'context seed' })
      harness.pi.events.emit(SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT, {
        profiles: [{ id: 'pstack-nested', nested: { maxDepth: 2 }, registrations: [] }],
        sourceId: '@nothingrotf/pstack',
      })
      harness.pi.events.emit(SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT, {
        profiles: [{ id: 'pstack-nested', nested: { maxDepth: 2 }, registrations: [] }],
        sourceId: '@nothingrotf/pstack',
      })
      const result = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          capability_profile: 'pstack-nested',
          prompt: 'NESTED_TOOLS',
          readonly: true,
          subagent_type: 'generalPurpose',
        },
        signal: undefined,
      })
      expect(result.kind).toBe('completed')
      if (result.kind !== 'completed') throw new Error('The event profile did not run.')
      expect(result.content).toContain('nested-result:Agent ID:')
    } finally {
      await harness.close()
    }
  })

  it('uses a registered agent background default and permits an explicit override', async () => {
    const harness = await createHarness()
    try {
      harness.pi.events.emit(SUBAGENT_REGISTRATION_EVENT, {
        definitions: [
          {
            description: 'Package agent',
            is_background: true,
            name: 'Comment Sicko',
            readonly: true,
            systemPrompt: 'CUSTOM_AGENT_SENTINEL',
          },
        ],
        sourceId: '@nothingrotf/pstack',
      })
      const background = await runTask(harness, {
        ...baseInput,
        prompt: 'BLOCK',
        subagent_type: 'Comment Sicko',
      })
      const backgroundId = agentId(background)
      expect(background).toBe(`Task started in the background.\nAgent ID: ${backgroundId}`)
      const backgroundRecord = latestState(harness).records.at(-1)
      expect(backgroundRecord?.background).toBe(true)
      expect(backgroundRecord?.execution?.agentSource).toEqual({
        id: '@nothingrotf/pstack',
        kind: 'extension',
      })
      if (backgroundRecord?.execution?.version !== 5) {
        throw new Error('The background execution contract is unavailable.')
      }
      expect(backgroundRecord.execution.backgroundDefault).toBe(true)

      for (const release of harness.state.blocked.splice(0)) release()
      await harness.state.notification.promise

      const started: string[] = []
      const foreground = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          prompt: 'RETURN_PROFILE',
          run_in_background: false,
          subagent_type: 'Comment Sicko',
        },
        onStarted: (agentId) => started.push(agentId),
        signal: undefined,
      })
      expect(foreground.kind).toBe('completed')
      if (foreground.kind !== 'completed') throw new Error('The explicit override did not finish.')
      expect(foreground.content).toContain('profile:custom')
      expect(started).toEqual([foreground.details.agentId])
      expect(latestState(harness).records.at(-1)?.background).toBe(false)

      const resumed = await harness.runtime.run({
        ctx: harness.context(),
        input: {
          ...baseInput,
          prompt: 'RETURN_PROFILE',
          resume: foreground.details.agentId,
          subagent_type: 'Comment Sicko',
        },
        signal: undefined,
      })
      expect(resumed.kind).toBe('completed')
      expect(latestState(harness).records.at(-1)?.background).toBe(false)
    } finally {
      await harness.close()
    }
  })

  it('isolates and stages a mutable agent with a background default', async () => {
    const harness = await createHarness()
    const unregister = harness.controller.registerAgents('mutable-background', [
      {
        description: 'Mutable background agent',
        is_background: true,
        name: 'mutable-background-agent',
        systemPrompt: 'CUSTOM_AGENT_SENTINEL',
      },
    ])
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        ...baseInput,
        prompt: 'WRITE_ISOLATED',
        subagent_type: 'mutable-background-agent',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const staged = latestState(harness).records.find((record) => record.agentId === id)
      expect(staged?.background).toBe(true)
      expect(staged?.isolation?.integrationStatus).toBe('staged')
      const attempt = staged?.runGeneration
      if (attempt === undefined) throw new Error('The staged attempt is unavailable.')
      const beforeJoin = Value.Decode(
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
      if (beforeJoin.digest === null) throw new Error('The staged evidence digest is unavailable.')
      expect(beforeJoin.freshness).toBe('current')

      const joined = await runTaskControl(harness, { action: 'join', agent_id: id })
      expect(joined).toContain('"outcome": "joined"')
      const afterJoin = Value.Decode(
        EvidencePageSchema,
        JSON.parse(
          await runTaskControl(harness, {
            action: 'evidence',
            agent_id: id,
            attempt,
            digest: beforeJoin.digest,
            limit: 8192,
            section: 'isolation',
          }),
        ),
      )
      expect(afterJoin.digest).toBe(beforeJoin.digest)
      expect(afterJoin.freshness).toBe('stale')
      expect(await readFile(join(harness.dir, 'isolated.txt'), 'utf8')).toBe('isolated content\n')
    } finally {
      unregister()
      await harness.close()
    }
  }, 180_000)

  it.each([false, true])(
    'targets an inner linked worktree with background=%s',
    async (background) => {
      const harness = await createHarness()
      try {
        await initializeHarnessRepository(harness)
        await writeFile(join(harness.dir, '.gitignore'), 'agent/\nsessions/\n.worktrees/\n')
        const target = join(harness.dir, '.worktrees', 'candidate')
        await execFileAsync('git', ['worktree', 'add', '-q', '-b', 'candidate', target], {
          cwd: harness.dir,
        })
        await mkdir(join(target, 'src'))
        await writeFile(join(target, 'src', 'base.txt'), 'candidate base\n')
        const result = await runTask(harness, {
          ...baseInput,
          cwd: join(target, 'src'),
          isolation: { mode: 'worktree', integration: 'apply' },
          prompt: 'WRITE_ISOLATED',
          readonly: false,
          run_in_background: background,
          subagent_type: 'generalPurpose',
        })
        const id = agentId(result)
        if (background) {
          await harness.state.notification.promise
          expect(await runTaskControl(harness, { action: 'join', agent_id: id })).toContain(
            '"outcome": "joined"',
          )
        }
        const record = latestState(harness).records.find((entry) => entry.agentId === id)
        expect(record?.status).toBe('completed')
        expect(record?.isolation?.repositories.map((entry) => entry.relativePath)).toEqual([''])
        if (record?.execution?.version !== 5) throw new Error('The execution contract is missing.')
        expect(record.execution.relativeCwd).toBe('src')
        expect(record.execution.workspaceIdentity?.baselineTree).toBe(
          record?.isolation?.repositories[0]?.baselineTree,
        )
        expect(await readFile(join(target, 'src', 'isolated.txt'), 'utf8')).toBe(
          'isolated content\n',
        )
        await expect(readFile(join(harness.dir, 'src', 'isolated.txt'), 'utf8')).rejects.toThrow(
          /ENOENT/,
        )
      } finally {
        await harness.close()
      }
    },
    180_000,
  )

  it('rejects a join when its recorded execution directory disappears', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      await mkdir(join(harness.dir, 'target'))
      await writeFile(join(harness.dir, 'target', 'base.txt'), 'baseline\n')
      const started = await runTask(harness, {
        ...baseInput,
        cwd: 'target',
        prompt: 'WRITE_ISOLATED',
        readonly: false,
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      const receipt = harness.runtime.getRecord(id)?.isolation
      await rm(join(harness.dir, 'target'), { recursive: true })
      const joined = await runTaskControl(harness, { action: 'join', agent_id: id })
      expect(joined).toContain('"outcome": "rejected"')
      expect(joined).toContain('"reason": "invalid-lineage"')
      expect(harness.runtime.getRecord(id)?.isolation).toEqual(receipt)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it.each([undefined, 'omitted-integration', 'apply', 'branch', 'manual'])(
    'enforces registered verifier isolation for %s',
    async (integration) => {
      const harness = await createHarness()
      harness.runtime.registerCapability({
        id: 'verifier-policy',
        version: '1',
        tools: [],
        extensions: [],
        roleToolRequirements: [
          { role: 'runtime verification', tools: ['bash'], isolation: 'manual' },
        ],
      })
      harness.runtime.registerCapabilityProfile({
        id: 'verifier-policy',
        registrations: ['verifier-policy'],
      })
      try {
        await initializeHarnessRepository(harness)
        const input: TaskInput = {
          ...baseInput,
          capability_profile: 'verifier-policy',
          role: 'runtime verification',
          prompt: 'WRITE_ISOLATED',
          readonly: false,
          subagent_type: 'generalPurpose',
        }
        if (integration === 'apply' || integration === 'branch' || integration === 'manual')
          input.isolation = { mode: 'worktree', integration }
        if (integration === 'omitted-integration') input.isolation = { mode: 'worktree' }
        const result = await runTask(harness, input)
        if (integration === 'apply' || integration === 'branch') {
          expect(result).toContain('requires manual writer isolation')
          expect(latestState(harness).records).toHaveLength(0)
        } else {
          const record = latestState(harness).records.find(
            (entry) => entry.agentId === agentId(result),
          )
          expect(record?.status).toBe('completed')
          if (record?.execution?.version !== 5)
            throw new Error('The execution contract is missing.')
          expect(record.execution.isolation).toEqual({ mode: 'worktree', integration: 'manual' })
          expect(record?.isolation?.integrationStatus).toBe('not-requested')
          if (integration === undefined) {
            const resumed = await runTask(harness, {
              ...baseInput,
              prompt: 'verify retained artifacts',
              resume: record.agentId,
              subagent_type: 'generalPurpose',
            })
            expect(resumed).toContain('verify retained artifacts')
            expect(harness.runtime.getRecord(record.agentId)?.isolation?.integration).toBe('manual')
          }
        }
        await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      } finally {
        await harness.close()
      }
    },
    180_000,
  )

  it('lets a registered manual verifier run in place and resume there', async () => {
    const harness = await createHarness()
    harness.runtime.registerCapability({
      extensions: [],
      id: 'verifier-policy',
      roleToolRequirements: [
        { isolation: 'manual', role: 'runtime verification', tools: ['bash'] },
      ],
      tools: [],
      version: '1',
    })
    harness.runtime.registerCapabilityProfile({
      id: 'verifier-policy',
      registrations: ['verifier-policy'],
    })
    let worktree: string | undefined
    try {
      await initializeHarnessRepository(harness)
      worktree = await linkedWorktree(harness)
      const result = await runTask(harness, {
        ...baseInput,
        capability_profile: 'verifier-policy',
        cwd: worktree,
        isolation: { mode: 'in-place' },
        prompt: 'verify in place',
        readonly: false,
        role: 'runtime verification',
        subagent_type: 'generalPurpose',
      })
      const id = agentId(result)
      const record = latestState(harness).records.find((entry) => entry.agentId === id)
      if (record?.execution?.version !== 5) throw new Error('The execution contract is missing.')
      expect(record.execution.isolation).toEqual({ mode: 'in-place' })
      const repository = record.inPlace?.repositories[0]
      expect(repository?.resultTree).toBe(repository?.baseTree)
      const resumed = await runTask(harness, {
        ...baseInput,
        prompt: 'verify the same tree again',
        resume: id,
        subagent_type: 'generalPurpose',
      })
      expect(resumed).toContain('verify the same tree again')
      expect(harness.runtime.getRecord(id)?.inPlace?.status).toBe('captured')
    } finally {
      await harness.close()
      if (worktree !== undefined) await rm(dirname(worktree), { force: true, recursive: true })
    }
  }, 180_000)

  it('retains runtime verifier artifacts without allowing a join', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const started = await runTask(harness, {
        ...baseInput,
        isolation: { integration: 'manual', mode: 'worktree' },
        prompt: 'WRITE_ISOLATED',
        readonly: false,
        run_in_background: true,
        subagent_type: 'generalPurpose',
      })
      const id = agentId(started)
      await harness.state.notification.promise
      const record = latestState(harness).records.find((entry) => entry.agentId === id)
      expect(record?.status).toBe('completed')
      expect(record?.isolation?.integration).toBe('manual')
      expect(record?.isolation?.repositories[0]?.changedFiles).toContainEqual({
        path: 'isolated.txt',
        status: 'A',
      })
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
      const joined = await runTaskControl(harness, { action: 'join', agent_id: id })
      expect(joined).toContain('"outcome": "rejected"')
      expect(joined).toContain('"reason": "not-staged"')
      await expect(readFile(join(harness.dir, 'isolated.txt'), 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      await harness.close()
    }
  }, 180_000)

  it('discovers project agent files from the effective cwd', async () => {
    const harness = await createHarness()
    const nested = join(harness.dir, 'nested')
    const agents = join(nested, '.pi', 'agents')
    await mkdir(agents, { recursive: true })
    await writeFile(join(nested, 'AGENTS.md'), 'ALT_CONTEXT_SENTINEL\n')
    await writeFile(
      join(agents, 'file-agent.md'),
      [
        '---',
        'name: file-agent',
        'description: File integration agent',
        'effort: low',
        'tools:',
        '  - read',
        '  - grep',
        '---',
        'FILE_AGENT_SENTINEL',
      ].join('\n'),
    )
    try {
      const first = await runTask(harness, {
        ...baseInput,
        cwd: 'nested',
        prompt: 'RETURN_PROFILE',
        subagent_type: 'file-agent',
      })
      expect(first).toContain(
        'profile:file;tools:ask_parent,grep,notify_parent,read,request_parent,update_progress',
      )
      const id = agentId(first)
      const record = latestState(harness).records.find((candidate) => candidate.agentId === id)
      const execution = record?.execution
      expect(execution?.version).toBe(5)
      if (execution?.version !== 5) throw new Error('Execution contract v5 is required.')
      expect(execution.logicalCwd).toBe(await realpath(nested))
      expect(execution.agentSource).toMatchObject({ kind: 'project' })

      const changedCwd = await runTask(harness, {
        ...baseInput,
        cwd: '.',
        prompt: 'RETURN_PROFILE',
        resume: id,
        subagent_type: 'file-agent',
      })
      expect(changedCwd).toContain('must preserve the original cwd')
      const changedTools = await runTask(harness, {
        ...baseInput,
        cwd: 'nested',
        prompt: 'RETURN_PROFILE',
        resume: id,
        subagent_type: 'file-agent',
        tools: ['read'],
      })
      expect(changedTools).toContain('must preserve the original tool policy')

      await rm(join(agents, 'file-agent.md'))
      const resumed = await runTask(harness, {
        ...baseInput,
        cwd: 'nested',
        prompt: 'RETURN_PROFILE',
        resume: id,
        subagent_type: 'file-agent',
        tools: ['read', 'grep'],
      })
      expect(resumed).toContain('profile:file')

      await rm(nested, { recursive: true })
      const missingCwd = await runTask(harness, {
        ...baseInput,
        prompt: 'RETURN_PROFILE',
        resume: id,
        subagent_type: 'file-agent',
      })
      expect(missingCwd).toContain('The Task cwd does not exist:')
    } finally {
      await harness.close()
    }
  })

  it('validates cwd, agent files, and tool policies before session creation', async () => {
    const harness = await createHarness()
    const invalidFileDir = join(harness.dir, '.agents', 'agents')
    await mkdir(invalidFileDir, { recursive: true })
    await writeFile(
      join(invalidFileDir, 'broken-agent.md'),
      '---\ndescription: Broken\nunknown: true\n---\nPrompt',
    )
    const plainFile = join(harness.dir, 'plain-file')
    await writeFile(plainFile, 'not a directory')
    try {
      const missing = await runTask(harness, { ...baseInput, cwd: 'missing' })
      expect(missing).toContain('The Task cwd does not exist:')
      const file = await runTask(harness, { ...baseInput, cwd: plainFile })
      expect(file).toContain('The Task cwd is not a directory:')
      const malformed = await runTask(harness, {
        ...baseInput,
        subagent_type: 'broken-agent',
      })
      expect(malformed).toContain('Agent frontmatter is invalid')
      const unknown = await runTask(harness, { ...baseInput, tools: ['unknown'] })
      expect(unknown).toContain('Task tool "unknown" is unknown.')
      const privateTool = await runTask(harness, { ...baseInput, tools: ['ask_parent'] })
      expect(privateTool).toContain('Task tool "ask_parent" is private')
      const duplicate = await runTask(harness, { ...baseInput, tools: ['read', 'read'] })
      expect(duplicate).toContain('Task tool "read" is duplicated.')
      const disallowed = await runTask(harness, { ...baseInput, tools: ['bash'] })
      expect(disallowed).toContain('Task tool "bash" is not permitted by agent "explore".')
    } finally {
      await harness.close()
    }
  })

  it('rejects another managed workspace before allocating an isolated child', async () => {
    const harness = await createHarness()
    try {
      await initializeHarnessRepository(harness)
      const candidate = join(harness.dir, '.git', 'pi-subagent', 'worktrees', 'candidate', 'root')
      await mkdir(candidate, { recursive: true })
      await execFileAsync('git', ['init', '-q'], { cwd: candidate })
      const result = await runTask(harness, {
        ...baseInput,
        cwd: candidate,
        isolation: { mode: 'worktree', integration: 'manual' },
        prompt: 'RETURN_TOOLS',
        subagent_type: 'generalPurpose',
      })
      expect(result).toContain('Task cwd targets Git metadata')
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('replaces a built-in child tool with a declared capability override', async () => {
    const harness = await createHarness()
    try {
      await writeFile(join(harness.dir, 'receipt.txt'), 'native content\n', 'utf8')
      const overridingRead = defineTool({
        description: 'Read a file with a bounded window.',
        async execute() {
          return { content: [{ text: 'bounded read output', type: 'text' }], details: {} }
        },
        label: 'read',
        name: 'read',
        parameters: Type.Object({ path: Type.String() }),
        promptGuidelines: ['BOUNDED_READ_GUIDELINE'],
        promptSnippet: 'BOUNDED_READ_SNIPPET',
      })
      harness.runtime.registerCapability({
        extensions: [],
        id: 'file-access',
        overrides: ['read'],
        readonlyTools: ['read'],
        tools: [overridingRead],
        version: '1',
      })
      harness.runtime.registerCapabilityProfiles([
        { id: 'file-access-profile', optionalRegistrations: ['absent'], registrations: [] },
        { id: 'file-access-active', optionalRegistrations: ['file-access'], registrations: [] },
      ])

      const withoutProvider = await runTask(harness, {
        ...baseInput,
        capability_profile: 'file-access-profile',
        prompt: 'READ_THROUGH_CAPABILITY',
        readonly: true,
      })
      const withProvider = await runTask(harness, {
        ...baseInput,
        capability_profile: 'file-access-active',
        prompt: 'READ_THROUGH_CAPABILITY',
        readonly: true,
      })

      expect(withoutProvider).toContain('native content')
      expect(withProvider).toContain('bounded read output')
      const childPrompt = harness.state.childSystemPrompts.at(-1) ?? ''
      expect(childPrompt).toContain('BOUNDED_READ_GUIDELINE')
      expect(childPrompt).toContain('BOUNDED_READ_SNIPPET')
    } finally {
      await harness.close()
    }
  })

  it('runs codemode scripts only against the Task tool contract', async () => {
    const harness = await createHarness()
    try {
      await writeFile(join(harness.dir, 'receipt.txt'), 'native content\n', 'utf8')
      let probeLoaded = false
      harness.runtime.registerCapability({
        extensions: [
          {
            factory: (pi) => {
              probeLoaded = true
              pi.registerTool({
                description: 'Return a value outside the Task contract.',
                async execute() {
                  return { content: [{ text: 'SECRET_PROBE_REACHED', type: 'text' }], details: {} }
                },
                exposure: 'codemode',
                label: 'Secret Probe',
                name: 'secret_probe',
                parameters: Type.Object({}),
              })
            },
            name: 'secret-probe',
          },
        ],
        id: 'secret-probe',
        tools: [],
        version: '1',
      })
      harness.runtime.registerCapabilityProfiles([
        { id: 'scripted', registrations: ['secret-probe'] },
        { defaultTools: ['codemode'], id: 'scripted-default', registrations: [] },
      ])

      const scripted = await runTask(harness, {
        ...baseInput,
        capability_profile: 'scripted',
        prompt: 'RUN_CODEMODE_SCOPE',
        readonly: false,
        subagent_type: 'generalPurpose',
        tools: ['read', 'codemode'],
      })
      expect(scripted).toContain('"read":"native content\\n"')
      expect(probeLoaded).toBe(true)
      expect(scripted).toContain('"probe":"absent"')
      expect(
        harness.pi
          .getAllTools()
          .filter((tool) => tool.name === 'Task' || tool.name === 'TaskControl')
          .map((tool) => `${tool.name}:${tool.exposure}`)
          .sort(),
      ).toEqual(['Task:model-only', 'TaskControl:model-only'])
      expect(scripted).toContain('"orchestration":[]')
      expect(scripted).not.toContain('SECRET_PROBE_REACHED')
      const receipts = latestState(harness).records.at(-1)?.toolExecutionReceipts ?? []
      expect(receipts.map((receipt) => receipt.tool)).toContain('codemode')
      expect(
        receipts.some(
          (receipt) => receipt.tool === 'read' && receipt.callId.includes('/') && !receipt.isError,
        ),
      ).toBe(true)

      const implicit = await runTask(harness, {
        ...baseInput,
        capability_profile: 'scripted-default',
        prompt: 'RETURN_TOOLS',
      })
      expect(implicit).toContain('tools:')
      expect(implicit).toContain('codemode')
      expect(await runTask(harness, { ...baseInput, prompt: 'RETURN_TOOLS' })).not.toContain(
        'codemode',
      )
    } finally {
      await harness.close()
    }
  })

  it('keeps child codemode in on mode when the global setting is only', async () => {
    const harness = await createHarness()
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-subagent-agent-'))
    const previous = process.env.PI_CODING_AGENT_DIR
    try {
      await writeFile(
        join(agentDir, 'settings.json'),
        JSON.stringify({ codemode: { mode: 'only' } }),
        'utf8',
      )
      process.env.PI_CODING_AGENT_DIR = agentDir
      const result = await runTask(harness, {
        ...baseInput,
        prompt: 'RETURN_TOOLS',
        tools: ['read', 'grep', 'codemode'],
      })
      expect(result).toContain('tools:')
      expect(result).toContain('codemode')
      expect(result).toContain('grep')
      expect(result).toContain('read')
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous
      await harness.close()
      await rm(agentDir, { force: true, recursive: true })
    }
  })

  it('keeps configured MCP servers out of read-only codemode Tasks', async () => {
    const harness = await createHarness()
    const agentDir = await mkdtemp(join(tmpdir(), 'pi-subagent-agent-'))
    const marker = join(agentDir, 'mcp-spawned')
    const previous = process.env.PI_CODING_AGENT_DIR
    try {
      const server = {
        args: ['-e', "require('node:fs').writeFileSync(process.argv[1], '')", marker],
        command: process.execPath,
      }
      await writeFile(
        join(agentDir, 'mcp.json'),
        JSON.stringify({ mcpServers: { probe: server } }),
        'utf8',
      )
      await mkdir(join(harness.dir, '.pi'), { recursive: true })
      await writeFile(
        join(harness.dir, '.pi', 'mcp.json'),
        JSON.stringify({ mcpServers: { project_probe: server } }),
        'utf8',
      )
      process.env.PI_CODING_AGENT_DIR = agentDir

      const declared = await runTask(harness, {
        ...baseInput,
        prompt: 'RETURN_TOOLS',
        readonly: true,
        tools: ['read', 'codemode'],
      })
      expect(declared).toContain('codemode')
      expect(declared).not.toContain('mcp__')
      expect(declared).not.toContain('tool_search')

      const scripted = await runTask(harness, {
        ...baseInput,
        prompt: 'RUN_CODEMODE_MCP_SCOPE',
        readonly: true,
        tools: ['read', 'codemode'],
      })
      expect(scripted).toContain('"mcp":[]')
      expect(scripted).toContain('"search":false')
      await expect(readFile(marker, 'utf8')).rejects.toThrow(/ENOENT/)
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR
      else process.env.PI_CODING_AGENT_DIR = previous
      await harness.close()
      await rm(agentDir, { force: true, recursive: true })
    }
  })

  it('rejects explicitly requested mutable tools in read-only preflight', async () => {
    const harness = await createHarness()
    harness.controller.registerAgents('preflight', [
      {
        name: 'preflight-reviewer',
        description: 'Review the artifact.',
        systemPrompt: 'Read the artifact.',
      },
    ])
    try {
      const result = await runTask(harness, {
        ...baseInput,
        readonly: true,
        subagent_type: 'preflight-reviewer',
        tools: ['read', 'bash'],
      })
      expect(result).toContain('Task tool "bash" is not available in read-only mode')
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })
})
