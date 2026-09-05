import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import {
  AgentSession,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { FreshGoalReviewer, GoalReviewAbortedError } from '../src/reviewer.ts'
import { createGoalLoop } from '../src/state.ts'

const directories = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(respond, refreshModels) {
  const cwd = await mkdtemp(join(tmpdir(), 'goal-reviewer-'))
  directories.push(cwd)
  await mkdir(join(cwd, '.pi'))
  await writeFile(join(cwd, '.pi/settings.json'), JSON.stringify({ retry: { enabled: false } }))
  await writeFile(join(cwd, 'result.txt'), 'verified')
  const provider = `goal-test-${randomUUID()}`
  const runtime = await ModelRuntime.create({
    authPath: join(cwd, 'auth.json'),
    modelsPath: null,
    refreshOnCreate: false,
  })
  const calls = []
  runtime.registerProvider(provider, {
    baseUrl: 'http://127.0.0.1',
    apiKey: 'fixture',
    api: provider,
    models: [
      {
        id: 'fixture',
        name: 'Goal test',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100000,
        maxTokens: 1000,
      },
    ],
    streamSimple(model, context, options) {
      calls.push({
        messages: structuredClone(context.messages),
        tools: context.tools?.map((tool) => ({ name: tool.name })),
      })
      const stream = createAssistantMessageEventStream()
      const message = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: 'stop',
        usage: {
          input: 100,
          output: 20,
          cacheRead: 300,
          cacheWrite: 10,
          totalTokens: 430,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      const run = async () => {
        stream.push({ type: 'start', partial: message })
        const response = await respond({
          context,
          options,
          count: calls.length,
          emit: (type, delta) => stream.push({ type, contentIndex: 0, delta, partial: message }),
        })
        message.content = response.content
        message.stopReason = options.signal?.aborted ? 'aborted' : (response.stopReason ?? 'stop')
        if (message.stopReason === 'error' || message.stopReason === 'aborted') {
          message.errorMessage = 'Fixture interrupted.'
          stream.push({ type: 'error', reason: message.stopReason, error: message })
        } else stream.push({ type: 'done', reason: message.stopReason, message })
        stream.end()
      }
      run().catch((error) => {
        message.stopReason = 'error'
        message.errorMessage = String(error)
        stream.push({ type: 'error', reason: 'error', error: message })
        stream.end()
      })
      return stream
    },
  })
  await runtime.refresh({ allowNetwork: false })
  class FixtureRegistry extends ModelRegistry {
    getRegisteredProviderConfig(providerId) {
      const config = super.getRegisteredProviderConfig(providerId)
      return config !== undefined && refreshModels !== undefined && providerId === provider
        ? { ...config, refreshModels }
        : config
    }
  }
  const registry = new FixtureRegistry(runtime)
  const model = registry.find(provider, 'fixture')
  if (model === undefined) throw new Error('Fixture model was not registered')
  const state = {
    enabled: true,
    mode: 'active',
    goal: {
      id: 'goal-1',
      objective: 'Verify result.txt contains verified.',
      status: 'active',
      tokensUsed: 0,
      timeUsedSeconds: 0,
      createdAt: 0,
      updatedAt: 0,
    },
    loop: createGoalLoop(),
  }
  const ctx = {
    cwd,
    model,
    modelRegistry: registry,
    sessionManager: SessionManager.inMemory(cwd),
    isProjectTrusted: () => true,
  }
  return { calls, request: { ctx, state, checks: [], signal: new AbortController().signal } }
}

function pass() {
  return {
    type: 'text',
    text: JSON.stringify({
      status: 'PASS',
      reason: 'Verified the file.',
      evidence: ['result.txt:1'],
    }),
  }
}

function readResult() {
  return { type: 'toolCall', id: randomUUID(), name: 'read', arguments: { path: 'result.txt' } }
}

describe('fresh reviewer with the Pi SDK', () => {
  test('covers model setup with the review deadline despite overlapping SDK refreshes', async () => {
    const release = Promise.withResolvers()
    const setups = await Promise.all(
      Array.from({ length: 16 }, async () => {
        const started = Promise.withResolvers()
        const signals = []
        const current = await fixture(
          async () => ({ content: [pass()] }),
          async ({ signal }) => {
            signals.push(signal)
            started.resolve()
            await release.promise
            return undefined
          },
        )
        return { current, started, signals }
      }),
    )
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = setups.map(({ current }) => new FreshGoalReviewer(100).review(current.request))
    try {
      await Promise.all(
        setups.map(({ started }, index) =>
          Promise.race([
            started.promise,
            pending[index].then((result) => {
              throw new Error(`Setup was skipped: ${result.reason}`)
            }),
          ]),
        ),
      )
      await delay(50)
      expect(setups.map(({ current }) => current.calls.length)).toEqual(Array(16).fill(0))
      await vi.advanceTimersByTimeAsync(100)
      const results = await Promise.all(pending)
      expect(results.map((result) => result.status)).toEqual(Array(16).fill('PARTIAL'))
      for (const result of results) expect(result.reason).toContain('exceeded')
      for (const { signals } of setups) {
        expect(signals).toHaveLength(1)
        expect(signals[0].aborted).toBe(true)
      }
    } finally {
      release.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await Promise.all(pending)
    }
  }, 15_000)

  test('does not review after a shared catalog refresh fails', async () => {
    const current = await fixture(
      async () => ({ content: [pass()] }),
      async () => {
        throw new Error('Fixture catalog unavailable')
      },
    )
    const result = await new FreshGoalReviewer(2000).review(current.request)
    expect(result.status).toBe('PARTIAL')
    expect(result.reason).toContain('Fixture catalog unavailable')
    expect(current.calls).toHaveLength(0)
  })

  test('reports real tool activity and accumulated usage without review content', async () => {
    const current = await fixture(async ({ count }) =>
      count === 1 ? { content: [readResult()], stopReason: 'toolUse' } : { content: [pass()] },
    )
    const events = []
    const result = await new FreshGoalReviewer(2000).review({
      ...current.request,
      onProgress: (event) => events.push(event),
    })
    expect(result.status, result.reason).toBe('PASS')
    expect(events[0]).toMatchObject({ type: 'reviewer', phase: 'starting-reviewer' })
    expect(events[1]).toMatchObject({ type: 'reviewer', phase: 'reviewing', tokens: 0 })
    expect(events.filter((event) => event.tool === 'read')).toHaveLength(1)
    const toolStart = events.findIndex((event) => event.tool === 'read')
    expect(events[toolStart + 1]).toMatchObject({ tokens: 130 })
    expect(events[toolStart + 1]).not.toHaveProperty('tool')
    expect(events.at(-1)).toMatchObject({ tokens: 260 })
    expect(JSON.stringify(events)).not.toContain('Verified the file')
    expect(JSON.stringify(events)).not.toContain('result.txt')
  })

  test('keeps concurrent tools visible until their final completion', async () => {
    const current = await fixture(async ({ count }) =>
      count === 1
        ? { content: [readResult(), readResult()], stopReason: 'toolUse' }
        : { content: [pass()] },
    )
    const events = []
    const result = await new FreshGoalReviewer(2000).review({
      ...current.request,
      onProgress: (event) => events.push(event),
    })
    expect(result.status, result.reason).toBe('PASS')
    const toolStart = events.findIndex((event) => event.tool === 'read')
    expect(events.slice(toolStart, toolStart + 3).map((event) => event.tool)).toEqual([
      'read',
      'read',
      'read',
    ])
    expect(events[toolStart + 3]).not.toHaveProperty('tool')
    expect(events.slice(toolStart, toolStart + 4).map((event) => event.tokens)).toEqual([
      130, 130, 130, 130,
    ])
  })

  test('cancels stalled model setup and never starts a late prompt', async () => {
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    let setupSignal
    let setups = 0
    const current = await fixture(
      async () => ({ content: [pass()] }),
      async ({ signal }) => {
        setups += 1
        if (setups === 1) {
          setupSignal = signal
          started.resolve()
          await release.promise
        }
        return undefined
      },
    )
    const reviewer = new FreshGoalReviewer(2000)
    const pending = reviewer.review(current.request)
    const assertion = expect(pending).rejects.toBeInstanceOf(GoalReviewAbortedError)
    const fallback = setTimeout(() => release.resolve(), 1500)
    try {
      await started.promise
      const stoppedAt = Date.now()
      await reviewer.cancel()
      await assertion
      expect(Date.now() - stoppedAt).toBeLessThan(500)
      expect(setupSignal.aborted).toBe(true)
      release.resolve()
      await delay(20)
      expect(current.calls).toHaveLength(0)
      expect((await reviewer.review(current.request)).status).toBe('PASS')
      expect(setups).toBe(2)
    } finally {
      clearTimeout(fallback)
      release.resolve()
      await assertion
    }
  })

  test('does not start a late provider after noncooperative prompt preflight times out', async () => {
    const current = await fixture(async () => ({ content: [pass()] }))
    const registry = current.request.ctx.modelRegistry
    const provider = registry.getProvider(current.request.ctx.model.provider)
    if (provider === undefined) throw new Error('Fixture provider missing')
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    let ready = false
    registry.registerProvider({
      ...provider,
      auth: {
        apiKey: {
          name: 'Fixture auth',
          async check() {
            if (!ready) return undefined
            started.resolve()
            await release.promise
            return { type: 'api_key', source: 'fixture' }
          },
          async resolve() {
            return { auth: { apiKey: 'fixture' } }
          },
        },
      },
    })
    await registry.refresh({ allowNetwork: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reviewer = new FreshGoalReviewer(100)
    const pending = reviewer.review({
      ...current.request,
      onProgress: (event) => {
        if (event.phase === 'reviewing') ready = true
      },
    })
    try {
      await Promise.race([
        started.promise,
        pending.then((result) => {
          throw new Error(result.reason)
        }),
      ])
      await vi.advanceTimersByTimeAsync(100)
      const result = await pending
      expect(result.status).toBe('PARTIAL')
      expect(result.reason).toContain('exceeded')
      release.resolve()
      await delay(30)
      expect(current.calls).toHaveLength(0)
      expect(await reviewer.steer('Late steering')).toBe(false)
    } finally {
      release.resolve()
      await vi.advanceTimersByTimeAsync(100)
      await pending
    }
  })

  test('disposes a session that arrives after cancellation during creation', async () => {
    const current = await fixture(async () => ({ content: [pass()] }))
    const controller = new AbortController()
    current.request.ctx.sessionManager.getSessionFile = () => {
      queueMicrotask(() => controller.abort())
      return undefined
    }
    const disposed = vi.spyOn(AgentSession.prototype, 'dispose')
    const reviewer = new FreshGoalReviewer(2000)
    await expect(
      reviewer.review({ ...current.request, signal: controller.signal }),
    ).rejects.toBeInstanceOf(GoalReviewAbortedError)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(current.calls).toHaveLength(0)
    expect(await reviewer.steer('Late steering')).toBe(false)
  })

  test('throttles actual streaming updates and never emits their content', async () => {
    const burst = Promise.withResolvers()
    const release = Promise.withResolvers()
    const current = await fixture(async ({ emit }) => {
      for (let index = 0; index < 100; index += 1) emit('thinking_delta', 'private reasoning')
      burst.resolve()
      await release.promise
      emit('text_delta', 'private text')
      return { content: [pass()] }
    })
    const events = []
    const pending = new FreshGoalReviewer(2000).review({
      ...current.request,
      onProgress: (event) => events.push(event),
    })
    try {
      await burst.promise
      await delay(10)
      expect(events.length).toBeGreaterThanOrEqual(3)
      expect(events.length).toBeLessThanOrEqual(4)
      const firstBurstCount = events.length
      await delay(260)
      release.resolve()
      const result = await pending
      expect(result.status).toBe('PASS')
      expect(events.length).toBe(firstBurstCount + 2)
      expect(events.at(-1)).toMatchObject({ tokens: 130 })
      expect(JSON.stringify(events)).not.toContain('private')
      expect(JSON.stringify(events)).not.toContain('Verified the file')
    } finally {
      release.resolve()
      await pending
    }
  })

  test.each([false, true])(
    'isolates progress callback failures, asynchronous %s',
    async (asynchronous) => {
      const current = await fixture(async () => ({ content: [pass()] }))
      const reviewer = new FreshGoalReviewer(2000)
      const onProgress = () => {
        if (asynchronous) return Promise.reject(new Error('Async UI failed'))
        throw new Error('UI failed')
      }
      expect((await reviewer.review({ ...current.request, onProgress })).status).toBe('PASS')
      expect((await reviewer.review(current.request)).status).toBe('PASS')
    },
  )

  test('does not resolve disabled packages while loading reviewer context', async () => {
    const current = await fixture(async () => ({ content: [pass()] }))
    const cwd = current.request.ctx.cwd
    const executable = join(cwd, 'package-command.cjs')
    await writeFile(
      executable,
      `require('node:fs').writeFileSync(${JSON.stringify(join(cwd, 'package-ran'))}, 'yes')`,
    )
    await writeFile(
      join(cwd, '.pi/settings.json'),
      JSON.stringify({
        packages: [`npm:@goal-fixture/${randomUUID()}`],
        npmCommand: [process.execPath, executable],
        retry: { enabled: false },
      }),
    )
    const result = await new FreshGoalReviewer(2000).review(current.request)
    expect(result.status, result.reason).toBe('PASS')
    await expect(access(join(cwd, 'package-ran'))).rejects.toThrow(Error)
  })

  test('uses fresh context and read-only tools for every review', async () => {
    const current = await fixture(async ({ context }) =>
      context.messages.at(-1)?.role === 'toolResult'
        ? { content: [pass()] }
        : { content: [readResult()], stopReason: 'toolUse' },
    )
    const reviewer = new FreshGoalReviewer(2000)
    const first = await reviewer.review(current.request)
    const second = await reviewer.review(current.request)
    expect(first.status, first.reason).toBe('PASS')
    expect(second.status).toBe('PASS')
    expect(first.usage).toEqual({ input: 200, output: 40, cacheRead: 600, cacheWrite: 20 })
    expect(current.calls).toHaveLength(4)
    expect(current.calls[0].messages).toHaveLength(1)
    expect(current.calls[2].messages).toHaveLength(1)
    expect(current.calls[0].tools.map((tool) => tool.name).sort()).toEqual([
      'find',
      'grep',
      'ls',
      'read',
    ])
  })

  test('consumes live user steering before issuing the final verdict', async () => {
    const started = Promise.withResolvers()
    const release = Promise.withResolvers()
    const current = await fixture(async ({ count }) => {
      if (count === 1) {
        started.resolve()
        await release.promise
        return { content: [pass()] }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'FAIL',
              reason: 'The new requirement is missing.',
              evidence: ['result.txt:1'],
            }),
          },
        ],
      }
    })
    const reviewer = new FreshGoalReviewer(2000)
    const pending = reviewer.review(current.request)
    await Promise.race([
      started.promise,
      pending.then((result) => {
        throw new Error(result.reason)
      }),
    ])
    expect(await reviewer.steer('Also verify cancellation.')).toBe(true)
    release.resolve()
    const result = await pending
    expect(result.status).toBe('FAIL')
    expect(JSON.stringify(current.calls[1].messages)).toContain('Also verify cancellation.')
  })

  test('times out a stalled provider and remains reusable', async () => {
    const started = Promise.withResolvers()
    const current = await fixture(async ({ count, options }) => {
      if (count === 1) {
        started.resolve()
        await new Promise((resolve) =>
          options.signal.addEventListener('abort', resolve, { once: true }),
        )
      }
      return { content: [pass()] }
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reviewer = new FreshGoalReviewer(100)
    const pending = reviewer.review(current.request)
    await Promise.race([
      started.promise,
      pending.then((result) => {
        throw new Error(result.reason)
      }),
    ])
    await vi.advanceTimersByTimeAsync(100)
    const timedOut = await pending
    expect(timedOut.status).toBe('PARTIAL')
    expect(timedOut.reason).toContain('exceeded')
    expect(timedOut.usage.output).toBe(20)
    const next = await reviewer.review(current.request)
    expect(next.status, next.reason).toBe('PASS')
  })

  test('does not reuse a prior PASS after the final provider call fails', async () => {
    const current = await fixture(async ({ count }) =>
      count === 1
        ? { content: [pass(), readResult()], stopReason: 'toolUse' }
        : { content: [], stopReason: 'error' },
    )
    const reviewer = new FreshGoalReviewer(2000)
    const result = await reviewer.review(current.request)
    expect(result.status).toBe('PARTIAL')
    expect(result.reason).toContain('did not finish successfully')
    expect(result.usage.output).toBe(40)
  })

  test('returns usage when an in-flight review is cancelled', async () => {
    const started = Promise.withResolvers()
    const current = await fixture(async ({ options }) => {
      started.resolve()
      await new Promise((resolve) =>
        options.signal.addEventListener('abort', resolve, { once: true }),
      )
      return { content: [] }
    })
    const reviewer = new FreshGoalReviewer(2000)
    const controller = new AbortController()
    const result = reviewer.review({ ...current.request, signal: controller.signal })
    const assertion = expect(result).rejects.toMatchObject({
      usage: { input: 100, output: 20, cacheWrite: 10 },
    })
    await started.promise
    controller.abort()
    await assertion
    await expect(reviewer.steer('Late guidance')).resolves.toBe(false)
  })

  test('serializes review creation and cancels during session initialization', async () => {
    const current = await fixture(async () => ({ content: [pass()] }))
    const reviewer = new FreshGoalReviewer(2000)
    const first = reviewer.review(current.request)
    const stopped = expect(first).rejects.toBeInstanceOf(GoalReviewAbortedError)
    const second = reviewer.review(current.request)
    const concurrent = expect(second).rejects.toThrow('already active')
    await reviewer.cancel()
    await Promise.all([stopped, concurrent])
    expect(current.calls).toHaveLength(0)
  })

  test('bounds cancellation even when a provider ignores abort', async () => {
    const release = Promise.withResolvers()
    const started = Promise.withResolvers()
    const current = await fixture(async () => {
      started.resolve()
      await release.promise
      return { content: [pass()] }
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reviewer = new FreshGoalReviewer(30)
    const pending = reviewer.review(current.request)
    try {
      await Promise.race([
        started.promise,
        pending.then((result) => {
          throw new Error(result.reason)
        }),
      ])
      await vi.advanceTimersByTimeAsync(1030)
      const result = await pending
      expect(result.status).toBe('PARTIAL')
      expect(result.reason).toContain('exceeded')
      expect(current.calls).toHaveLength(1)
    } finally {
      release.resolve()
      await vi.advanceTimersByTimeAsync(1030)
      await pending
    }
  })

  test('aborts before calling a provider when the request is already cancelled', async () => {
    const current = await fixture(async () => ({ content: [pass()] }))
    const reviewer = new FreshGoalReviewer(2000)
    await expect(
      reviewer.review({ ...current.request, signal: AbortSignal.abort() }),
    ).rejects.toBeInstanceOf(GoalReviewAbortedError)
    expect(current.calls).toHaveLength(0)
  })
})
