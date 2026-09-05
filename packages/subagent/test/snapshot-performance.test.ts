import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import {
  AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionContext,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import { SubagentControllerHost } from '../src/controller.ts'
import type { SubagentEvent, TaskReceipt } from '../src/runtime.ts'
import { StateStore } from '../src/state.ts'

const HISTORY_TURNS = 3
const ProbeInputSchema = Type.Object({ turn: Type.Number() })

async function createHarness() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-snapshot-performance-'))
  const blocked = new Map<string, () => void>()
  const released = Promise.withResolvers<void>()
  let usageReads = 0
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerProvider('snapshot-test', {
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
        name: 'Snapshot worker',
        reasoning: false,
      },
    ],
    streamSimple: (model, context) => {
      const stream = createAssistantMessageEventStream()
      const turn = context.messages.filter((message) => message.role === 'assistant').length + 1
      const usage = {
        cacheRead: 2,
        cacheWrite: 3,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0.25 },
        input: 5,
        output: 7,
        totalTokens: 17,
      }
      const message: AssistantMessage = {
        api: model.api,
        content:
          turn <= HISTORY_TURNS
            ? [
                {
                  arguments: { turn },
                  id: `probe-${turn}`,
                  name: 'snapshot_probe',
                  type: 'toolCall',
                },
              ]
            : [{ text: 'Done', type: 'text' }],
        model: model.id,
        provider: model.provider,
        role: 'assistant',
        stopReason: turn <= HISTORY_TURNS ? 'toolUse' : 'stop',
        timestamp: Date.now(),
        get usage() {
          usageReads += 1
          return usage
        },
      }
      stream.push({ message, reason: turn <= HISTORY_TURNS ? 'toolUse' : 'stop', type: 'done' })
      stream.end()
      return stream
    },
  })
  const model = modelRuntime.getModel('snapshot-test', 'worker')
  if (model === undefined) throw new Error('The test model is missing.')
  let host: SubagentControllerHost | undefined
  let context: ExtensionContext | undefined
  const loader = new DefaultResourceLoader({
    agentDir: join(dir, 'agent'),
    cwd: dir,
    extensionFactories: [
      (pi) => {
        host = new SubagentControllerHost(pi)
        host.runtime.registerCapability({
          extensions: [],
          id: 'snapshot-probe',
          readonlyTools: ['snapshot_probe'],
          tools: [
            {
              description: 'Hold a child while measuring progress publication.',
              execute: async (_id, input, _signal, onUpdate, ctx) => {
                if (Value.Decode(ProbeInputSchema, input).turn === HISTORY_TURNS) {
                  blocked.set(ctx.sessionManager.getSessionId(), () => {
                    onUpdate?.({ content: [{ text: 'Progress', type: 'text' }], details: {} })
                  })
                  await released.promise
                }
                return { content: [{ text: 'Ready', type: 'text' }], details: {} }
              },
              label: 'Snapshot probe',
              name: 'snapshot_probe',
              parameters: ProbeInputSchema,
            },
          ],
          version: '1',
        })
        host.runtime.registerCapabilityProfile({
          id: 'snapshot-probe',
          registrations: ['snapshot-probe'],
        })
        pi.on('input', (_event, ctx) => {
          context = ctx
          return { action: 'handled' }
        })
      },
    ],
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: dir,
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager: SessionManager.create(dir, join(dir, 'sessions')),
    thinkingLevel: 'off',
  })
  await session.prompt('Capture snapshot context')
  if (host === undefined || context === undefined) throw new Error('The context is missing.')
  const controller = host
  const ctx = context
  await controller.replaceSession(ctx)
  const events: SubagentEvent[] = []
  controller.subscribe(session.sessionId, (event) => events.push(event))
  return {
    blocked,
    close: async () => {
      released.resolve()
      await controller.runtime.shutdown()
      session.dispose()
      await rm(dir, { force: true, recursive: true })
    },
    controller,
    events,
    resetUsageReads: () => {
      usageReads = 0
    },
    start: () =>
      controller.start({
        ctx,
        input: {
          capability_profile: 'snapshot-probe',
          description: 'Snapshot performance',
          model: 'snapshot-test/worker',
          prompt: 'Run the snapshot probe',
          readonly: true,
          subagent_type: 'generalPurpose',
        },
      }),
    usageReads: () => usageReads,
  }
}

describe('snapshot publication work', () => {
  it.each([8, 16, 32])(
    'scales linearly for %i blocked real child sessions',
    async (count) => {
      const harness = await createHarness()
      try {
        const receipts: TaskReceipt[] = []
        for (let index = 0; index < count; index += 1) receipts.push(await harness.start())
        await expect.poll(() => harness.blocked.size).toBe(count)
        const first = receipts[0]
        if (first === undefined) throw new Error('The first receipt is missing.')
        const update = harness.blocked.get(first.handle.agentId)
        if (update === undefined) throw new Error('The blocked child is missing.')
        const snapshots = vi.spyOn(harness.controller.runtime, 'snapshotFor')
        const all = vi.spyOn(StateStore.prototype, 'all')
        const stats = vi.spyOn(AgentSession.prototype, 'getSessionStats')
        const contexts = vi.spyOn(AgentSession.prototype, 'getContextUsage')
        harness.events.length = 0
        harness.resetUsageReads()
        const revision = harness.controller.runtime.currentRevision
        update()
        await expect.poll(() => harness.events.length).toBe(count)
        const work = {
          allScans: all.mock.calls.length,
          contextReads: contexts.mock.calls.length,
          snapshotLookups: snapshots.mock.calls.length,
          statsScans: stats.mock.calls.length,
          usageReads: harness.usageReads(),
        }
        expect(work).toEqual({
          allScans: 0,
          contextReads: count,
          snapshotLookups: count,
          statsScans: 0,
          usageReads: count * (HISTORY_TURNS * 5 + 3),
        })
        expect(harness.controller.runtime.currentRevision).toBe(revision + 1)
        for (const event of harness.events) {
          expect(event).toMatchObject({
            revision: revision + 1,
            snapshot: {
              running: true,
              usage: {
                cacheRead: 6,
                cacheWrite: 9,
                cost: 0.75,
                input: 15,
                output: 21,
                toolCalls: 3,
              },
            },
            type: 'updated',
          })
        }
        contexts.mockClear()
        harness.resetUsageReads()
        expect(harness.controller.snapshot(first.handle)?.agentId).toBe(first.handle.agentId)
        expect(contexts).toHaveBeenCalledTimes(1)
        expect(harness.usageReads()).toBe(HISTORY_TURNS * 5 + 3)
        expect(harness.controller.snapshot({ ...first.handle, runGeneration: -1 })).toBeUndefined()
        expect(contexts).toHaveBeenCalledTimes(1)
        const listed = harness.controller.runtime.listSnapshots()
        expect(listed.map((snapshot) => snapshot.agentId)).toEqual(
          receipts.map((receipt) => receipt.handle.agentId).reverse(),
        )
        expect(contexts).toHaveBeenCalledTimes(count + 1)
      } finally {
        vi.restoreAllMocks()
        await harness.close()
      }
    },
    60_000,
  )
})
