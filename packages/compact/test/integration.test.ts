import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type AssistantMessage,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import compact from '../src/index.ts'
import { assistant, user } from './fixtures.ts'

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function harness(
  overflow = false,
  semanticResponse = true,
  ui?: Partial<ExtensionUIContext>,
) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-compact-test-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const manager = SessionManager.create(dir, dir)
  const first = manager.appendMessage(user('Original requirement: preserve transactional safety.'))
  for (let i = 0; i < 8; i++) {
    manager.appendMessage(assistant(`Recorded finding ${i}: ${'Evidence details. '.repeat(300)}`))
    manager.appendMessage(user(`Continue phase ${i}. Preserve the transaction boundary.`))
  }
  manager.appendMessage(assistant('Most recent reply.', overflow ? 10 : 25_000))
  const requests: string[] = []
  const events: string[] = []
  const failures: string[] = []
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: join(dir, 'models.json'),
    modelsStorePath: join(dir, 'models-store.json'),
    allowModelNetwork: false,
  })
  runtime.registerProvider('compact-test', {
    api: 'compact-test',
    apiKey: 'fixture',
    baseUrl: 'http://127.0.0.1/unused',
    models: [
      {
        id: 'scripted',
        name: 'Scripted test',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 30_000,
        maxTokens: 4000,
      },
    ],
    streamSimple(model, context) {
      requests.push(JSON.stringify(context))
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'text', text: 'Finished after compaction.' }],
        stopReason: 'stop',
        timestamp: 10,
        usage: {
          input: 10,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 11,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      if (context.systemPrompt?.startsWith('Extract a conservative semantic state patch')) {
        message.content = [
          {
            type: 'text',
            text: semanticResponse
              ? JSON.stringify({
                  upsert: [
                    {
                      id: 'transaction-safety',
                      kind: 'constraint',
                      status: 'active',
                      text: 'Preserve transactional safety.',
                      supersedes: [],
                      evidence: [
                        {
                          source: first,
                          quote: 'Original requirement: preserve transactional safety.',
                        },
                      ],
                    },
                  ],
                })
              : 'invalid semantic response',
          },
        ]
      }
      const stream = createAssistantMessageEventStream()
      if (overflow && requests.length === 1) {
        message.stopReason = 'error'
        message.errorMessage = 'Your input exceeds the context window of this model'
        message.content = []
        stream.push({ type: 'error', reason: 'error', error: message })
      } else {
        stream.push({ type: 'start', partial: message })
        stream.push({ type: 'done', reason: 'stop', message })
      }
      stream.end()
      return stream
    },
  })
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true, reserveTokens: 8000, keepRecentTokens: 1000 },
    retry: { enabled: false },
  })
  const observer: ExtensionFactory = (pi) => {
    pi.on('session_compact', (event) => {
      events.push(`${event.reason}:${event.fromExtension}`)
    })
    pi.on('session_compact_failed', (event) => {
      failures.push(event.reason)
    })
  }
  const extensionFactories: ExtensionFactory[] = [compact, observer]
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    extensionFactories,
  })
  await loader.reload()
  const model = runtime.getModel('compact-test', 'scripted')
  if (!model) throw new Error('Fixture model missing')
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager,
    tools: ['compact_recall'],
  })
  cleanup.push(() => session.dispose())
  await session.bindExtensions({
    mode: ui ? 'rpc' : 'print',
    uiContext: { ...session.extensionRunner.getUIContext(), ...ui },
    onError: (error) => {
      throw new Error(error.error)
    },
  })
  return { dir, first, session, manager, requests, events, failures, settingsManager }
}

describe('native Pi compaction integration', () => {
  test('replaces the manual summarizer without a model call and persists recallable evidence', async () => {
    const h = await harness()
    const original = h.manager.getEntries()
    const result = await h.session.compact('transactional safety')
    expect(h.requests).toHaveLength(0)
    expect(h.events).toEqual(['manual:true'])
    expect(result.summary).toContain('Structured session context')
    expect(result.summary).toContain('transactional safety')
    expect(h.manager.getEntries().slice(0, original.length)).toEqual(original)
    const file = h.manager.getSessionFile()
    if (!file) throw new Error('Persistent session file missing')
    const restored = SessionManager.open(file)
    expect(restored.buildSessionContext().messages).toEqual(
      h.manager.buildSessionContext().messages,
    )
    const tool = h.session.agent.state.tools.find((item) => item.name === 'compact_recall')
    if (!tool) throw new Error('Recall tool was not activated')
    const recalled = await tool.execute('recall', { entryId: h.first })
    expect(recalled.content).toEqual([
      expect.objectContaining({ text: expect.stringContaining('Original requirement') }),
    ])
  })

  test('selects both modes through the native settings menu and marks the active choice', async () => {
    const menus: { title: string; rows: string[] }[] = []
    let selected = 'hybrid'
    const h = await harness(false, true, {
      async select(title, rows) {
        menus.push({ title, rows })
        return rows.find((row) => row.startsWith(`${selected} - `))
      },
    })
    await h.session.prompt('/compact-mode')
    expect(menus[0]).toEqual({
      title: 'Compaction settings',
      rows: [
        'deterministic - No model calls (recommended) (current)',
        'hybrid - Send evidence to active model (extra latency/cost)',
      ],
    })
    expect(h.manager.getBranch().at(-1)).toMatchObject({
      type: 'custom',
      customType: 'compact-mode',
      data: { mode: 'hybrid' },
    })
    selected = 'deterministic'
    await h.session.prompt('/compact-mode')
    expect(menus[1]?.rows).toEqual([
      'deterministic - No model calls (recommended)',
      'hybrid - Send evidence to active model (extra latency/cost) (current)',
    ])
    expect(h.manager.getBranch().at(-1)).toMatchObject({ data: { mode: 'deterministic' } })
    expect(h.requests).toHaveLength(0)
    expect(h.events).toHaveLength(0)
  })

  test('dismisses settings or selects the current mode without mutating the session', async () => {
    let selected: string | undefined
    const h = await harness(false, true, {
      async select(_title, rows) {
        return rows.find((row) => row.startsWith(`${selected} - `))
      },
    })
    const before = h.manager.getEntries()
    await h.session.prompt('/compact-mode')
    expect(h.manager.getEntries()).toEqual(before)
    selected = 'deterministic'
    await h.session.prompt('/compact-mode')
    expect(h.manager.getEntries()).toEqual(before)
    expect(h.requests).toHaveLength(0)
  })

  test('keeps direct arguments noninteractive and rejects invalid modes', async () => {
    let opened = false
    const notices: string[] = []
    const h = await harness(false, true, {
      async select() {
        opened = true
        return undefined
      },
      notify(message) {
        notices.push(message)
      },
    })
    const before = h.manager.getEntries()
    await h.session.prompt('/compact-mode invalid')
    expect(h.manager.getEntries()).toEqual(before)
    expect(notices).toContain('Usage: /compact-mode [deterministic|hybrid]')
    await h.session.prompt('/compact-mode hybrid')
    expect(h.manager.getBranch().at(-1)).toMatchObject({ data: { mode: 'hybrid' } })
    expect(opened).toBe(false)
  })

  test('reports the current mode without a dialog in noninteractive runs', async () => {
    const h = await harness()
    const before = h.manager.getEntries()
    await h.session.prompt('/compact-mode')
    expect(h.manager.getEntries()).toEqual(before)
    expect(h.requests).toHaveLength(0)
  })

  test('opts into hybrid through the native command and persists semantic state and usage', async () => {
    const h = await harness()
    await h.session.prompt('/compact-mode hybrid')
    expect(h.requests).toHaveLength(0)
    const result = await h.session.compact()
    expect(h.requests).toHaveLength(1)
    expect(result.summary).toContain('constraint/active: Preserve transactional safety.')
    const checkpoint = h.manager.getBranch().findLast((entry) => entry.type === 'compaction')
    expect(checkpoint).toMatchObject({
      usage: { totalTokens: 11 },
      details: {
        enrichment: { outcome: 'applied' },
        semantic: { items: [{ id: 'transaction-safety' }] },
      },
    })
    const file = h.manager.getSessionFile()
    if (!file) throw new Error('Session file missing')
    expect(SessionManager.open(file).getBranch()).toEqual(h.manager.getBranch())
    h.manager.branch(h.first)
    for (let i = 0; i < 5; i++) {
      h.manager.appendMessage(assistant('Alternative branch evidence. '.repeat(300)))
      h.manager.appendMessage(user(`Alternative phase ${i}`))
    }
    h.session.agent.state.messages = h.manager.buildSessionContext().messages
    const other = await h.session.compact()
    expect(other.summary).not.toContain('Model interpretations')
    expect(h.requests).toHaveLength(1)
  })

  test('commits deterministic fallback after one invalid nested model response', async () => {
    const h = await harness(false, false)
    await h.session.prompt('/compact-mode hybrid')
    const result = await h.session.compact()
    expect(result.summary).toContain('Original requirement')
    expect(result.summary).not.toContain('Model interpretations')
    expect(h.events).toEqual(['manual:true'])
    expect(h.requests).toHaveLength(1)
    expect(h.manager.getBranch().at(-1)).toMatchObject({
      usage: { totalTokens: 11 },
      details: { enrichment: { outcome: 'fallback', reason: 'invalid_response' } },
    })
  })

  test('merges successive checkpoints without losing the original request or duplicating the retained tail', async () => {
    const h = await harness()
    const first = await h.session.compact()
    for (let i = 0; i < 5; i++) {
      h.manager.appendMessage(user(`Second phase ${i}`))
      h.manager.appendMessage(assistant('Second phase evidence. '.repeat(300)))
    }
    h.session.agent.state.messages = h.manager.buildSessionContext().messages
    const second = await h.session.compact()
    expect(second.summary).toContain('Original requirement')
    expect(second.summary.length).toBeLessThanOrEqual(16_000)
    expect(second.summary.split('# Structured session context')).toHaveLength(2)
    expect(second.firstKeptEntryId).not.toBe(first.firstKeptEntryId)
    expect(h.requests).toHaveLength(0)
  })

  test('cancels before persistence and allows a clean retry', async () => {
    const h = await harness()
    const original = h.manager.getEntries()
    const unsubscribe = h.session.subscribe((event) => {
      if (event.type === 'compaction_start') h.session.abortCompaction()
    })
    await expect(h.session.compact()).rejects.toThrow(/cancel|abort/i)
    unsubscribe()
    expect(h.manager.getEntries()).toEqual(original)
    expect(h.requests).toHaveLength(0)
    expect(h.failures).toEqual(['manual'])
    expect((await h.session.compact()).summary).toContain('Original requirement')
  })

  test('handles automatic threshold compaction and lets Pi continue exactly once', async () => {
    const h = await harness()
    await h.session.prompt('Continue with the next step.')
    expect(h.events).toContain('threshold:true')
    expect(h.requests).toHaveLength(1)
    expect(h.requests[0]).toContain('Structured session context')
    expect(h.session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  })

  test('recovers provider overflow without a summary request or an extra continuation', async () => {
    const h = await harness(true)
    await h.session.prompt('Continue after overflow.')
    expect(h.events).toEqual(['overflow:true'])
    expect(h.requests).toHaveLength(2)
    expect(h.requests[1]).toContain('Structured session context')
    expect(h.session.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'stop' })
  })

  test('refuses to commit when the branch changes during compilation', async () => {
    const h = await harness()
    h.session.subscribe((event) => {
      if (event.type === 'compaction_start') {
        setImmediate(() => h.manager.appendMessage(user('Concurrent branch update')))
      }
    })
    await expect(h.session.compact()).rejects.toThrow(/cancel/i)
    expect(h.manager.getEntries().some((entry) => entry.type === 'compaction')).toBe(false)
    expect(h.requests).toHaveLength(0)
  })
})
