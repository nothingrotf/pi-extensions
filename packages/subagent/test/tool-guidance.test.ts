import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  contentText,
  getCurrentTools,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionAPI,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import { registerSubagent } from '../src/index.ts'

async function createSession(mode: 'on' | 'only' = 'on') {
  const cwd = await mkdtemp(join(tmpdir(), 'subagent-tool-guidance-'))
  const settingsManager = SettingsManager.inMemory({
    codemode: { mode },
    retry: { enabled: false },
  })
  let runtime: ReturnType<typeof registerSubagent> | undefined
  let extensionApi: ExtensionAPI | undefined
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(cwd, 'agent'),
    cwd,
    extensionFactories: [
      createCodemodeExtension({ models: false }),
      (pi) => {
        extensionApi = pi
        runtime = registerSubagent(pi)
      },
    ],
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager,
  })
  await resourceLoader.reload()
  const faux = fauxProvider({ models: [{ id: 'plain' }], provider: 'tool-guidance-test' })
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerNativeProvider(faux.provider)
  const model = modelRuntime.getModel('tool-guidance-test', 'plain')
  if (model === undefined) throw new Error('The test model was not registered.')
  const { session } = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager,
    tools: ['Task', 'TaskControl', 'codemode', 'write'],
  })
  const activeRuntime = runtime
  const pi = extensionApi
  if (activeRuntime === undefined || pi === undefined)
    throw new Error('The subagent runtime did not initialize.')
  return {
    cwd,
    faux,
    get pi() {
      return extensionApi ?? pi
    },
    get runtime() {
      return runtime ?? activeRuntime
    },
    session,
    async close() {
      await (runtime ?? activeRuntime).shutdown('The tool guidance test closed.')
      session.dispose()
      await rm(cwd, { force: true, recursive: true })
    },
  }
}

function resultText(session: Awaited<ReturnType<typeof createSession>>['session'], callId: string) {
  const result = session.messages.find(
    (message) => message.role === 'toolResult' && message.toolCallId === callId,
  )
  if (result?.role !== 'toolResult') throw new Error(`Missing result for ${callId}.`)
  return {
    isError: result.isError,
    nestedCalls: result.nestedCalls,
    text: result.content.map((part) => (part.type === 'text' ? part.text : '')).join('\n'),
  }
}

const node = { description: 'Inspect', id: 'inspect', prompt: 'Inspect', subagent_type: 'explore' }

describe('subagent tool contract recovery', () => {
  it.each([
    { tasks: [{ ...node, run_in_background: true }] },
    { run_in_background: true, tasks: [node] },
  ])(
    'rejects malformed batches with actionable guidance and no child allocation: %j',
    async (input) => {
      const harness = await createSession()
      try {
        harness.faux.setResponses([
          fauxAssistantMessage(fauxToolCall('Task', input, { id: 'invalid-batch' }), {
            stopReason: 'toolUse',
          }),
          fauxAssistantMessage(fauxToolCall('TaskControl', { action: 'list' }, { id: 'list' }), {
            stopReason: 'toolUse',
          }),
          fauxAssistantMessage(fauxText('done')),
        ])
        await harness.session.prompt('Run the batch, then inspect existing Tasks.')
        const failed = resultText(harness.session, 'invalid-batch')
        expect(failed.isError).toBe(true)
        expect(failed.text).toContain('run_in_background belongs only to a single Task')
        expect(failed.text).toContain('The graph scheduler owns batch execution')
        expect(resultText(harness.session, 'list').isError).toBe(false)
        expect(harness.runtime.listSnapshots()).toHaveLength(0)
      } finally {
        await harness.close()
      }
    },
  )

  it('explains nested schema failures without replaying earlier script effects', async () => {
    const harness = await createSession()
    try {
      const input = { tasks: [{ ...node, run_in_background: true }] }
      harness.faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall(
            'codemode',
            {
              code: `await tools.write({ path: 'retained.txt', content: 'retained' }); return await tools.Task(${JSON.stringify(input)})`,
            },
            { id: 'invalid-schema' },
          ),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(fauxText('done')),
      ])
      await harness.session.prompt('Attempt an invalid batch in a script.')
      const rejected = resultText(harness.session, 'invalid-schema')
      expect(rejected.isError).toBe(true)
      expect(rejected.text).toContain('run_in_background belongs only to a single Task')
      expect(await readFile(join(harness.cwd, 'retained.txt'), 'utf8')).toBe('retained')
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it('keeps delegation depth and private intercom boundaries for nested scripts', async () => {
    const harness = await createSession('only')
    harness.runtime.registerCapabilityProfile({
      id: 'nested',
      registrations: [],
      nested: { maxDepth: 2 },
    })
    const parentDispatch = {
      description: 'Parent child',
      prompt: 'PARENT_CHILD',
      readonly: true,
      run_in_background: true,
      subagent_type: 'generalPurpose',
      capability_profile: 'nested',
      tools: ['read', 'codemode'],
    }
    const leafDispatch = {
      description: 'Leaf child',
      prompt: 'LEAF_CHILD',
      readonly: true,
      run_in_background: true,
      subagent_type: 'explore',
      tools: ['read', 'codemode'],
    }
    const respond = (context: TranscriptContext) => {
      const prompts = context.messages
        .filter((message) => message.role === 'user')
        .map((message) => contentText(message.content))
      const tools = getCurrentTools(context.messages).map((tool) => tool.name)
      if (prompts.some((prompt) => prompt.includes('LEAF_CHILD'))) {
        expect(tools).not.toContain('Task')
        expect(tools).not.toContain('TaskControl')
        return fauxAssistantMessage(fauxText('Leaf completed.'))
      }
      const parent = prompts.some((prompt) => prompt.includes('PARENT_CHILD'))
      const scriptId = parent ? 'nested-script' : 'root-script'
      const waitId = parent ? 'nested-wait' : 'root-wait'
      if (
        context.messages.some(
          (message) => message.role === 'toolResult' && message.toolCallId === waitId,
        )
      )
        return fauxAssistantMessage(fauxText('done'))
      if (
        context.messages.some(
          (message) => message.role === 'toolResult' && message.toolCallId === scriptId,
        )
      )
        return fauxAssistantMessage(
          fauxToolCall('TaskControl', { action: 'wait' }, { id: waitId }),
          { stopReason: 'toolUse' },
        )
      expect(tools).toEqual(expect.arrayContaining(['Task', 'TaskControl']))
      const dispatch = parent ? leafDispatch : parentDispatch
      return fauxAssistantMessage(
        fauxToolCall(
          'codemode',
          {
            code: `const started = await tools.Task(${JSON.stringify(dispatch)}); const privateTools = ['request_parent', 'ask_parent', 'receive_peers'].filter(name => name in tools); if (privateTools.length > 0) throw new Error('Private tools leaked'); return started`,
          },
          { id: scriptId },
        ),
        { stopReason: 'toolUse' },
      )
    }
    try {
      harness.faux.setResponses(Array.from({ length: 24 }, () => respond))
      await harness.session.prompt('Exercise nested background delegation.')
      expect(resultText(harness.session, 'root-script').isError).toBe(false)
      expect(resultText(harness.session, 'root-wait').isError).toBe(false)
      const snapshots = harness.runtime.listSnapshots()
      expect(snapshots).toHaveLength(2)
      expect(snapshots.every((snapshot) => snapshot.status === 'completed')).toBe(true)
    } finally {
      await harness.close()
    }
  })

  it('preserves model-policy enforcement for a background script dispatch', async () => {
    const harness = await createSession()
    try {
      harness.runtime.registerCapability({
        id: 'restricted-model',
        version: '1',
        tools: [],
        extensions: [],
        modelPolicy: {
          status: 'valid',
          enforcement: 'configured',
          roles: [{ role: 'feature', selectors: ['inherit-parent'] }],
        },
      })
      harness.runtime.registerCapabilityProfile({
        id: 'restricted',
        registrations: ['restricted-model'],
      })
      const dispatch = {
        description: 'Rejected model',
        prompt: 'Do not run',
        subagent_type: 'explore',
        run_in_background: true,
        capability_profile: 'restricted',
        role: 'feature',
        model: 'tool-guidance-test/plain:high',
      }
      harness.faux.setResponses([
        fauxAssistantMessage(
          fauxToolCall(
            'codemode',
            { code: `return await tools.Task(${JSON.stringify(dispatch)})` },
            { id: 'policy' },
          ),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(fauxText('done')),
      ])
      await harness.session.prompt('Attempt a disallowed selector from a script.')
      const rejected = resultText(harness.session, 'policy')
      expect(rejected.isError).toBe(true)
      expect(rejected.text).toContain('outside configured selectors')
      expect(rejected.nestedCalls?.calls).toMatchObject([{ name: 'Task', status: 'error' }])
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  it.each(['Task', 'TaskControl'])(
    'does not reactivate an inactive %s for scripts',
    async (tool) => {
      const harness = await createSession('only')
      try {
        harness.faux.setResponses([fauxAssistantMessage(fauxText('initialized'))])
        await harness.session.prompt('Initialize the session.')
        harness.pi.setActiveTools(harness.pi.getActiveTools().filter((name) => name !== tool))
        const input =
          tool === 'Task'
            ? {
                description: 'Inactive',
                prompt: 'Do not run',
                subagent_type: 'explore',
                run_in_background: true,
              }
            : { action: 'list' }
        harness.faux.setResponses([
          fauxAssistantMessage(
            fauxToolCall(
              'codemode',
              { code: `return await tools.${tool}(${JSON.stringify(input)})` },
              { id: 'inactive' },
            ),
            { stopReason: 'toolUse' },
          ),
          fauxAssistantMessage(fauxText('done')),
        ])
        await harness.session.prompt('Attempt the inactive tool.')
        const rejected = resultText(harness.session, 'inactive')
        expect(rejected.isError).toBe(true)
        expect(rejected.text).toContain(`${tool} is inactive in this session`)
        expect(harness.pi.getActiveTools()).not.toContain(tool)
        expect(harness.runtime.listSnapshots()).toHaveLength(0)
      } finally {
        await harness.close()
      }
    },
  )

  it.each(['Task', 'TaskControl'])(
    'preserves %s deactivation before the first prompt',
    async (tool) => {
      const harness = await createSession('only')
      try {
        harness.pi.setActiveTools(
          harness.pi.getActiveTools().filter((name) => name !== tool && name !== 'write'),
        )
        const input =
          tool === 'Task'
            ? {
                description: 'Inactive',
                prompt: 'Do not run',
                subagent_type: 'explore',
                run_in_background: true,
              }
            : { action: 'list' }
        harness.faux.setResponses([
          (context) => {
            const declarations = getCurrentTools(context.messages).map((entry) => entry.name)
            expect(declarations).not.toContain(tool)
            expect(declarations).not.toContain('write')
            return fauxAssistantMessage(
              fauxToolCall(
                'codemode',
                { code: `return await tools.${tool}(${JSON.stringify(input)})` },
                { id: 'inactive-startup' },
              ),
              { stopReason: 'toolUse' },
            )
          },
          fauxAssistantMessage(fauxText('done')),
        ])
        await harness.session.prompt('Attempt a tool disabled before initialization.')
        const rejected = resultText(harness.session, 'inactive-startup')
        expect(rejected.isError).toBe(true)
        expect(rejected.text).toContain(`${tool} is inactive in this session`)
        expect(harness.pi.getActiveTools()).not.toContain(tool)
        expect(harness.pi.getActiveTools()).not.toContain('write')
        expect(harness.runtime.listSnapshots()).toHaveLength(0)
      } finally {
        await harness.close()
      }
    },
  )

  it('honors deactivation before the first prompt after a native reload', async () => {
    const harness = await createSession('only')
    try {
      harness.faux.setResponses([fauxAssistantMessage(fauxText('initialized'))])
      await harness.session.prompt('Initialize before reload.')
      await harness.session.reload()
      harness.pi.setActiveTools(
        harness.pi.getActiveTools().filter((name) => name !== 'Task' && name !== 'write'),
      )
      harness.faux.setResponses([
        (context) => {
          const declarations = getCurrentTools(context.messages).map((entry) => entry.name)
          expect(declarations).not.toContain('Task')
          expect(declarations).not.toContain('write')
          expect(declarations).toContain('TaskControl')
          return fauxAssistantMessage(
            fauxToolCall(
              'codemode',
              {
                code: "return await tools.Task({ description: 'Inactive after reload', prompt: 'Do not run', subagent_type: 'explore', run_in_background: true })",
              },
              { id: 'reload-script' },
            ),
            { stopReason: 'toolUse' },
          )
        },
        fauxAssistantMessage(
          fauxToolCall('TaskControl', { action: 'wait' }, { id: 'reload-wait' }),
          { stopReason: 'toolUse' },
        ),
        fauxAssistantMessage(fauxText('done')),
      ])
      await harness.session.prompt('Verify the restored tool contract.')
      expect(
        harness.session.messages
          .filter((message) => message.role === 'assistant' && message.stopReason === 'error')
          .map((message) => (message.role === 'assistant' ? message.errorMessage : '')),
      ).toEqual([])
      expect(resultText(harness.session, 'reload-script').isError).toBe(true)
      expect(resultText(harness.session, 'reload-script').text).toContain('Task is inactive')
      expect(resultText(harness.session, 'reload-wait').isError).toBe(false)
      expect(harness.runtime.listSnapshots()).toHaveLength(0)
    } finally {
      await harness.close()
    }
  })

  const modes: ('on' | 'only')[] = ['on', 'only']
  const blocked = [
    {
      call: `tools.Task(${JSON.stringify({ ...node, id: undefined, run_in_background: false })})`,
      reason: 'Nested Task calls require a single dispatch',
    },
    {
      call: `tools.Task(${JSON.stringify({ ...node, id: undefined })})`,
      reason: 'Nested Task calls require a single dispatch',
    },
    {
      call: `tools.Task(${JSON.stringify({ tasks: [node] })})`,
      reason: 'Nested Task calls require a single dispatch',
    },
    {
      call: "tools.TaskControl({ action: 'wait' })",
      reason: 'Call TaskControl wait directly',
    },
  ]

  for (const mode of modes) {
    it.each(blocked)(
      `rejects blocking orchestration in codemode ${mode}: $call`,
      async (blockedCall) => {
        const harness = await createSession(mode)
        try {
          harness.faux.setResponses([
            fauxAssistantMessage(
              fauxToolCall(
                'codemode',
                {
                  code: `await tools.write({ path: 'retained.txt', content: 'retained' }); return await ${blockedCall.call}`,
                },
                { id: 'invalid-script' },
              ),
              { stopReason: 'toolUse' },
            ),
            fauxAssistantMessage(
              fauxToolCall('TaskControl', { action: 'list' }, { id: 'direct' }),
              {
                stopReason: 'toolUse',
              },
            ),
            fauxAssistantMessage(fauxText('done')),
          ])
          await harness.session.prompt('Run the script, then inspect Tasks directly.')
          const failed = resultText(harness.session, 'invalid-script')
          expect(failed.isError).toBe(true)
          expect(failed.text).toContain(blockedCall.reason)
          expect(failed.text).toContain('Earlier script calls may have run')
          expect(resultText(harness.session, 'direct').isError).toBe(false)
          expect(await readFile(join(harness.cwd, 'retained.txt'), 'utf8')).toBe('retained')
          expect(harness.runtime.listSnapshots()).toHaveLength(0)
        } finally {
          await harness.close()
        }
      },
    )

    it(`dispatches a background Task and inspects it through codemode ${mode}`, async () => {
      const harness = await createSession(mode)
      const dispatch = {
        description: 'Read-only child',
        prompt: 'CHILD_COMPLETE',
        readonly: true,
        run_in_background: true,
        subagent_type: 'explore',
      }
      const respond = (context: TranscriptContext) => {
        const child = context.messages.some(
          (message) =>
            message.role === 'user' && contentText(message.content).includes('CHILD_COMPLETE'),
        )
        if (child) return fauxAssistantMessage(fauxText('Child completed.'))
        expect(getCurrentTools(context.messages).map((tool) => tool.name)).toEqual(
          expect.arrayContaining(['Task', 'TaskControl']),
        )
        if (
          context.messages.some(
            (message) => message.role === 'toolResult' && message.toolCallId === 'wait',
          )
        )
          return fauxAssistantMessage(fauxText('done'))
        if (
          context.messages.some(
            (message) => message.role === 'toolResult' && message.toolCallId === 'script',
          )
        )
          return fauxAssistantMessage(
            fauxToolCall('TaskControl', { action: 'wait' }, { id: 'wait' }),
            {
              stopReason: 'toolUse',
            },
          )
        return fauxAssistantMessage(
          fauxToolCall(
            'codemode',
            {
              code: `const started = await tools.Task(${JSON.stringify(dispatch)}); const listed = await tools.TaskControl({ action: 'list' }); return { started, listed }`,
            },
            { id: 'script' },
          ),
          { stopReason: 'toolUse' },
        )
      }
      try {
        harness.faux.setResponses(Array.from({ length: 12 }, () => respond))
        await harness.session.prompt('Dispatch a child and wait directly.')
        const script = resultText(harness.session, 'script')
        expect(script.isError).toBe(false)
        expect(script.text).toContain('Agent ID:')
        expect(script.text).toContain('Read-only child')
        expect(resultText(harness.session, 'wait').isError).toBe(false)
        const snapshots = harness.runtime.listSnapshots()
        expect(snapshots).toHaveLength(1)
        expect(snapshots[0]?.status).toBe('completed')
        const message = harness.session.messages.find(
          (entry) => entry.role === 'toolResult' && entry.toolCallId === 'script',
        )
        if (message?.role !== 'toolResult') throw new Error('Missing codemode result.')
        expect(message.nestedCalls?.calls.map((call) => call.name)).toEqual(['Task', 'TaskControl'])
        expect(message.nestedCalls?.calls.every((call) => call.status === 'ok')).toBe(true)
      } finally {
        await harness.close()
      }
    })
  }
})
