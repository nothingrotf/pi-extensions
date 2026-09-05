import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vite-plus/test'

import { SubagentControllerHost } from '../src/controller.ts'
import type { SubagentEvent, SubagentHandle } from '../src/runtime.ts'
import type { TaskInput } from '../src/schema.ts'

async function createHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-controller-lifecycle-'))
  const releases: Array<() => void> = []
  let blocked = false
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerProvider('controller-test', {
    api: 'openai-completions',
    apiKey: 'test-key',
    baseUrl: 'http://localhost:1',
    models: [
      {
        contextWindow: 100_000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: 'worker',
        input: ['text'],
        maxTokens: 8_000,
        name: 'Controller worker',
        reasoning: false,
      },
    ],
    streamSimple: (model) => {
      const stream = createAssistantMessageEventStream()
      const finish = () => {
        const message: AssistantMessage = {
          api: model.api,
          content: [{ text: 'Done', type: 'text' }],
          model: model.id,
          provider: model.provider,
          role: 'assistant',
          stopReason: 'stop',
          timestamp: Date.now(),
          usage: {
            cacheRead: 0,
            cacheWrite: 0,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
            input: 1,
            output: 1,
            totalTokens: 2,
          },
        }
        stream.push({ partial: message, type: 'start' })
        stream.push({ message, reason: 'stop', type: 'done' })
        stream.end()
      }
      if (blocked) releases.push(finish)
      else finish()
      return stream
    },
  })
  const model = modelRuntime.getModel('controller-test', 'worker')
  if (model === undefined) throw new Error('The test model is missing.')
  let host: SubagentControllerHost | undefined
  let context: ExtensionContext | undefined
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(dir, 'agent'),
    cwd: dir,
    extensionFactories: [
      (pi) => {
        host = new SubagentControllerHost(pi)
        pi.on('input', (_event, ctx) => {
          context = ctx
          return { action: 'handled' }
        })
      },
    ],
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    cwd: dir,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(dir, join(dir, 'sessions')),
    thinkingLevel: 'off',
  })
  await session.prompt('Capture controller context')
  if (host === undefined || context === undefined) throw new Error('The test context is missing.')
  const controller = host
  const ctx = context
  await controller.replaceSession(ctx)
  const events: SubagentEvent[] = []
  controller.subscribe(session.sessionId, (event) => events.push(event))
  const release = () => {
    for (const finish of releases.splice(0)) finish()
  }
  return {
    block: () => {
      blocked = true
    },
    close: async () => {
      blocked = false
      release()
      await controller.runtime.shutdown()
      session.dispose()
      await rm(dir, { force: true, recursive: true })
    },
    controller,
    ctx,
    events,
    release,
    releases,
    start: (resume?: string) => {
      const input: TaskInput = {
        description: 'Controller lifecycle',
        model: 'controller-test/worker',
        prompt: 'Complete this task',
        readonly: true,
        subagent_type: 'generalPurpose',
      }
      if (resume !== undefined) input.resume = resume
      return controller.start({ ctx, input })
    },
  }
}

function terminals(events: SubagentEvent[], handle: SubagentHandle) {
  return events.filter(
    (event) =>
      event.type === 'terminal' &&
      event.handle.agentId === handle.agentId &&
      event.handle.ownerSessionId === handle.ownerSessionId &&
      event.handle.ownerGeneration === handle.ownerGeneration &&
      event.handle.runGeneration === handle.runGeneration,
  )
}

describe('controller lifecycle', () => {
  it('rejects new work throughout shutdown and resumes only after session restoration', async () => {
    const harness = await createHarness()
    try {
      harness.block()
      await harness.start()
      await expect.poll(() => harness.releases.length).toBe(1)
      let stopped = false
      const stop = harness.controller.stopSession(harness.ctx).then((result) => {
        stopped = true
        return result
      })
      await expect(harness.start()).rejects.toThrow(/shutting down|replacement/i)
      expect(stopped).toBe(false)
      harness.release()
      expect(await stop).toBe(true)
      await expect(harness.start()).rejects.toThrow(/shutting down|replacement/i)
      const replacement = harness.controller.replaceSession(harness.ctx)
      await expect(harness.start()).rejects.toThrow(/shutting down|replacement/i)
      expect(await replacement).toBe(true)
      const next = await harness.start()
      await expect.poll(() => harness.releases.length).toBe(1)
      harness.release()
      expect((await harness.controller.wait(next.handle)).status).toBe('completed')
    } finally {
      await harness.close()
    }
  })

  it('rejects invalidated handles while their original run still drains', async () => {
    const harness = await createHarness()
    try {
      harness.block()
      const receipt = await harness.start()
      await expect.poll(() => harness.releases.length).toBe(1)
      expect(harness.controller.snapshot(receipt.handle)).toBeDefined()
      const stopping = harness.controller.stopSession(harness.ctx)
      expect(harness.controller.snapshot(receipt.handle)).toBeUndefined()
      expect(harness.controller.result(receipt.handle)).toBeUndefined()
      await expect(harness.controller.wait(receipt.handle)).rejects.toThrow('handle is stale')
      harness.release()
      await stopping
    } finally {
      await harness.close()
    }
  })

  it('rejects a receipt from a start overtaken by session replacement', async () => {
    const harness = await createHarness()
    const started = Promise.withResolvers<void>()
    const releaseReceipt = Promise.withResolvers<void>()
    try {
      const run = harness.controller.runtime.run.bind(harness.controller.runtime)
      harness.controller.runtime.run = async (options) => {
        const result = await run(options)
        started.resolve()
        await releaseReceipt.promise
        return result
      }
      const starting = harness.start()
      const rejected = expect(starting).rejects.toThrow(/session changed/i)
      await started.promise
      await harness.controller.stopSession(harness.ctx)
      await harness.controller.replaceSession(harness.ctx)
      releaseReceipt.resolve()
      await rejected
      expect(harness.events.filter((event) => event.type === 'created')).toHaveLength(0)
    } finally {
      releaseReceipt.resolve()
      await harness.close()
    }
  })

  it.each([false, true])(
    'publishes terminal once per run and releases completed subscriptions (immediate: %s)',
    async (immediate) => {
      const harness = await createHarness()
      try {
        if (immediate) {
          const run = harness.controller.runtime.run.bind(harness.controller.runtime)
          harness.controller.runtime.run = async (options) => {
            const result = await run(options)
            if (result.kind === 'background') {
              await harness.controller.runtime.waitFor(result.details.handle)
            }
            return result
          }
        }
        const first = await harness.start()
        const result = await harness.controller.wait(first.handle)
        expect(result.status).toBe('completed')
        expect(terminals(harness.events, first.handle)).toHaveLength(1)
        const snapshots = vi.spyOn(harness.controller.runtime, 'snapshotFor')
        const results = vi.spyOn(harness.controller.runtime, 'resultFor')
        const second = await harness.start()
        await harness.controller.wait(second.handle)
        expect(snapshots).not.toHaveBeenCalledWith(first.handle)
        expect(results).not.toHaveBeenCalledWith(first.handle)
        expect(terminals(harness.events, first.handle)).toHaveLength(1)
        expect(terminals(harness.events, second.handle)).toHaveLength(1)
        expect(harness.controller.result(first.handle)).toEqual(result)
        expect(harness.controller.snapshot(first.handle)).toBeUndefined()
        const resumed = await harness.start(first.handle.agentId)
        expect(resumed.handle.agentId).toBe(first.handle.agentId)
        expect(resumed.handle.runGeneration).not.toBe(first.handle.runGeneration)
        await harness.controller.wait(resumed.handle)
        expect(terminals(harness.events, first.handle)).toHaveLength(1)
        expect(terminals(harness.events, resumed.handle)).toHaveLength(1)
        await harness.controller.stopSession(harness.ctx)
        await harness.controller.replaceSession(harness.ctx)
        const restored = await harness.start(resumed.handle.agentId)
        expect(restored.handle.ownerGeneration).not.toBe(resumed.handle.ownerGeneration)
        await harness.controller.wait(restored.handle)
        expect(terminals(harness.events, resumed.handle)).toHaveLength(1)
        expect(terminals(harness.events, restored.handle)).toHaveLength(1)
      } finally {
        await harness.close()
      }
    },
  )
})
