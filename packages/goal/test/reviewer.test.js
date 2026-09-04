import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { ModelRegistry, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { FreshGoalReviewer, GoalReviewAbortedError } from '../src/reviewer.ts'
import { createGoalLoop } from '../src/state.ts'

const directories = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(respond) {
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
        const response = await respond({ context, options, count: calls.length })
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
  const registry = new ModelRegistry(runtime)
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
    const current = await fixture(async ({ count, options }) => {
      if (count === 1)
        await new Promise((resolve) =>
          options.signal.addEventListener('abort', resolve, { once: true }),
        )
      return { content: [pass()] }
    })
    const reviewer = new FreshGoalReviewer(100)
    const timedOut = await reviewer.review(current.request)
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
    const current = await fixture(async () => {
      await release.promise
      return { content: [pass()] }
    })
    const reviewer = new FreshGoalReviewer(30)
    const started = Date.now()
    const fallback = setTimeout(() => release.resolve(), 3000)
    try {
      const result = await reviewer.review(current.request)
      expect(result.status).toBe('PARTIAL')
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      clearTimeout(fallback)
      release.resolve()
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
