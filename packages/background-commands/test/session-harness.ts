import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  getCurrentTools,
  type AssistantMessage,
  type Context,
  type ToolCall,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type Theme,
} from '@earendil-works/pi-coding-agent'
import { afterEach, vi } from 'vite-plus/test'

import { createBackgroundCommands } from '../src/headless.ts'
import { completionMessageType, createBackgroundCommandsExtension } from '../src/index.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllEnvs()
})

type Plan = (request: number, context: Context) => AssistantMessage['content']

export function toolCall(name: string, args: ToolCall['arguments']): ToolCall {
  return { type: 'toolCall', id: `fixture-${name}`, name, arguments: args }
}

export async function sessionFixture(
  plan: Plan = () => [{ type: 'text', text: 'Done' }],
  ownership: 'standalone' | 'injected' = 'injected',
) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-background-session-'))
  const agentDir = join(directory, 'agent')
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
  const manager = SessionManager.create(directory, join(directory, 'sessions'))
  const service = createBackgroundCommands({
    sessionId: manager.getSessionId(),
    getContext: () => ({ cwd: directory }),
  })
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  const requests: Context[] = []
  let holding = false
  let inputTokens = 1
  const releases: Array<() => void> = []
  runtime.registerProvider('background-fixture', {
    api: 'openai-completions',
    apiKey: 'local-fixture-only',
    baseUrl: 'http://localhost:1',
    models: [
      {
        id: 'model',
        name: 'Local fixture',
        reasoning: false,
        input: ['text'],
        contextWindow: 100000,
        maxTokens: 1000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    streamSimple(model, context, options) {
      requests.push({ ...context, messages: structuredClone(context.messages) })
      const stream = createAssistantMessageEventStream()
      let finished = false
      const finish = (aborted = false) => {
        if (finished) return
        finished = true
        const content = aborted ? [] : plan(requests.length, context)
        const stopReason = aborted
          ? 'aborted'
          : content.some((item) => item.type === 'toolCall')
            ? 'toolUse'
            : 'stop'
        const message: AssistantMessage = {
          api: model.api,
          model: model.id,
          provider: model.provider,
          role: 'assistant',
          content,
          stopReason,
          timestamp: Date.now(),
          usage: {
            input: inputTokens,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: inputTokens + 1,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        }
        if (stopReason === 'aborted')
          stream.push({ type: 'error', reason: 'aborted', error: message })
        else stream.push({ type: 'done', reason: stopReason, message })
        stream.end()
      }
      if (holding) {
        releases.push(() => finish())
        if (options?.signal?.aborted) finish(true)
        else options?.signal?.addEventListener('abort', () => finish(true), { once: true })
      } else finish()
      return stream
    },
  })
  const model = runtime.getModel('background-fixture', 'model')
  if (model === undefined) throw new Error('Fixture model unavailable')
  let api: ExtensionAPI | undefined
  let theme: Theme | undefined
  const loader = new DefaultResourceLoader({
    cwd: directory,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      (pi) => {
        api = pi
        pi.on('session_start', (_event, ctx) => {
          theme = ctx.ui.theme
        })
      },
      ownership === 'injected'
        ? createBackgroundCommandsExtension({ service })
        : createBackgroundCommandsExtension(),
      createCodemodeExtension({ mode: 'on', models: false }),
    ],
  })
  await loader.reload()
  const { session } = await createAgentSession({
    cwd: directory,
    model,
    modelRuntime: runtime,
    resourceLoader: loader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory(),
    thinkingLevel: 'off',
  })
  const errors: string[] = []
  await session.bindExtensions({
    mode: 'print',
    onError: (error) => {
      errors.push(error.error)
    },
  })
  if (api === undefined) throw new Error('Fixture API is not bound')
  api.setActiveTools([...session.getActiveToolNames(), 'codemode'])
  cleanups.push(async () => {
    holding = false
    for (const release of releases.splice(0)) release()
    await session.abort()
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
    await service.dispose()
    session.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return {
    directory,
    errors,
    theme: () => {
      if (theme === undefined) throw new Error('Fixture theme is not available')
      return theme
    },
    session,
    service,
    manager,
    requests,
    api: () => {
      if (api === undefined) throw new Error('Fixture extension is not bound')
      return api
    },
    setInputTokens: (value: number) => {
      inputTokens = value
    },
    hold: () => {
      holding = true
    },
    release: () => {
      holding = false
      for (const release of releases.splice(0)) release()
    },
    completions: () =>
      manager
        .getBranch()
        .filter(
          (entry) => entry.type === 'custom_message' && entry.customType === completionMessageType,
        ),
    toolNames: () => getCurrentTools(requests[0]?.messages ?? []).map((tool) => tool.name),
  }
}
