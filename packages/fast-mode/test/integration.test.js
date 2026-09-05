import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { createFastModeExtension } from '../src/index.ts'

const cleanup = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function harness() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-fast-mode-'))
  cleanup.push(() => rm(dir, { recursive: true, force: true }))
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const bytes = Buffer.concat(chunks)
    const decoded =
      request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(bytes) : bytes
    const payload = JSON.parse(decoded.toString())
    requests.push(payload)
    const item = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'OK', annotations: [] }],
    }
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
      {
        type: 'response.content_part.added',
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      },
      {
        type: 'response.output_text.delta',
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: 'OK',
      },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          id: 'resp_test',
          status: 'completed',
          output: [item],
          service_tier: payload.service_tier ?? 'default',
          usage: { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 0 } },
        },
      },
    ]
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const token = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account' } })).toString('base64url')}.test`
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: join(dir, 'models.json'),
    modelsStorePath: join(dir, 'models-store.json'),
    refreshOnCreate: false,
  })
  runtime.registerProvider('openai-codex', {
    api: 'openai-codex-responses',
    apiKey: token,
    baseUrl,
    models: ['gpt-6-astra', 'not-fast'].map((id) => ({
      id,
      name: id,
      reasoning: true,
      contextWindow: 272000,
      maxTokens: 128000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      input: ['text'],
    })),
  })
  const settingsManager = SettingsManager.inMemory({
    transport: 'sse',
    compaction: { enabled: false },
    retry: { enabled: false },
  })
  const catalogPath = join(dir, 'catalog.json')
  const notices = []
  const loader = new DefaultResourceLoader({
    agentDir: dir,
    cwd: dir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    noContextFiles: true,
    extensionFactories: [createFastModeExtension({ agentDir: dir, catalogPath })],
  })
  await loader.reload()
  const created = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    resourceLoader: loader,
    modelRuntime: runtime,
    model: runtime.getModel('openai-codex', 'gpt-6-astra'),
    thinkingLevel: 'medium',
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
    tools: [],
  })
  cleanup.push(() => created.session.dispose())
  await created.session.bindExtensions({
    uiContext: { notify: (text) => notices.push(text), setStatus() {} },
    commandContextActions: {},
    onError: (error) => {
      throw new Error(error.error)
    },
  })
  return { session: created.session, runtime, requests, dir, catalogPath, notices }
}

describe('Fast Mode through the native Codex request path', () => {
  it('toggles the tier without changing reasoning, verbosity, or other payload fields', async () => {
    const instance = await harness()
    await instance.session.prompt('Reply OK')
    expect(instance.requests.at(-1)).not.toHaveProperty('service_tier')
    const originalText = instance.requests.at(-1).text
    await instance.session.prompt('/fast on')
    await instance.session.prompt('Reply OK again')
    expect(instance.requests.at(-1)).toMatchObject({
      model: 'gpt-6-astra',
      service_tier: 'priority',
      reasoning: { effort: 'medium' },
      text: originalText,
    })
    expect(JSON.parse(await readFile(join(instance.dir, 'state/fast-mode.json'), 'utf8'))).toEqual({
      enabled: true,
    })
    await instance.session.prompt('/codex-fast off')
    await instance.session.prompt('Reply OK once more')
    expect(instance.requests.at(-1)).not.toHaveProperty('service_tier')
    expect(instance.session.messages.at(-1).stopReason).toBe('stop')
  })

  it('respects catalog denial after a model switch and refuses unsupported activation', async () => {
    const instance = await harness()
    await instance.session.prompt('/fast on')
    await instance.session.setModel(instance.runtime.getModel('openai-codex', 'not-fast'))
    await instance.session.prompt('Reply OK')
    expect(instance.requests.at(-1)).not.toHaveProperty('service_tier')
    await instance.session.prompt('/fast off')
    await instance.session.prompt('/fast on')
    expect(JSON.parse(await readFile(join(instance.dir, 'state/fast-mode.json'), 'utf8'))).toEqual({
      enabled: false,
    })
    await instance.session.setModel(instance.runtime.getModel('openai-codex', 'gpt-6-astra'))
    await writeFile(
      instance.catalogPath,
      JSON.stringify({ models: [{ slug: 'gpt-6-astra', service_tiers: [] }] }),
    )
    await instance.session.prompt('/fast on')
    expect(JSON.parse(await readFile(join(instance.dir, 'state/fast-mode.json'), 'utf8'))).toEqual({
      enabled: false,
    })
  })

  it('uses the catalog tier and suspends the override when the preference becomes invalid', async () => {
    const instance = await harness()
    await writeFile(
      instance.catalogPath,
      JSON.stringify({
        models: [{ slug: 'gpt-6-astra', service_tiers: [{ id: 'fast', name: 'Fast' }] }],
      }),
    )
    await instance.session.prompt('/fast on')
    await instance.session.prompt('Reply OK')
    expect(instance.requests.at(-1).service_tier).toBe('fast')
    await writeFile(join(instance.dir, 'state/fast-mode.json'), 'invalid')
    await instance.session.prompt('Reply OK again')
    expect(instance.requests.at(-1)).not.toHaveProperty('service_tier')
    expect(instance.notices.some((notice) => notice.includes('Cannot read Fast Mode state'))).toBe(
      true,
    )
  })
})
