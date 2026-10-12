import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createBashToolDefinition,
  createCodemodeExtension,
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import { describe, expect, test } from 'vite-plus/test'

import hud from '../src/index.ts'
import { railTool } from '../src/rail-tools.ts'
import { RailStore } from '../src/rail.ts'

const spec = {
  category: 'other' as const,
  detail: () => '',
  doneLabel: 'Done',
  iconKey: 'tool' as const,
  runningLabel: 'Running',
}

const renderFields = new Set(['renderCall', 'renderResult', 'renderShell'])

function wrapNative<TParams extends TSchema, TDetails, TState>(
  base: ToolDefinition<TParams, TDetails, TState>,
) {
  const store = new RailStore()
  const wrapped = railTool(base, () => store, spec)
  const withoutRendering = (entries: ReadonlyArray<[string, unknown]>) =>
    Object.fromEntries(entries.filter(([key]) => !renderFields.has(key)))
  return {
    native: withoutRendering(Object.entries(base)),
    renderShell: wrapped.renderShell,
    wrapped: withoutRendering(Object.entries(wrapped)),
  }
}

describe('rail tool definitions', () => {
  const cwd = process.cwd()
  test.each([
    ['bash', () => wrapNative(createBashToolDefinition(cwd))],
    ['edit', () => wrapNative(createEditToolDefinition(cwd))],
    ['find', () => wrapNative(createFindToolDefinition(cwd))],
    ['ls', () => wrapNative(createLsToolDefinition(cwd))],
    ['write', () => wrapNative(createWriteToolDefinition(cwd))],
  ])('keeps every native %s field except rendering', (_name, wrap) => {
    const { native, renderShell, wrapped } = wrap()
    expect(wrapped).toEqual(native)
    expect(renderShell).toBe('self')
  })
})

test('declares the native structured bash result to codemode scripts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'hud-rail-schema-'))
  try {
    const loader = new DefaultResourceLoader({
      agentDir: join(cwd, 'agent'),
      cwd,
      extensionFactories: [createCodemodeExtension({ models: false }), hud],
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager: SettingsManager.inMemory(),
    })
    await loader.reload()
    const faux = fauxProvider({ models: [{ id: 'plain' }], provider: 'hud-test' })
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('codemode', { code: "return await describeTool('bash')" }, { id: 'script' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage(fauxText('done')),
    ])
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
    modelRuntime.registerNativeProvider(faux.provider)
    const model = modelRuntime.getModel('hud-test', 'plain')
    if (model === undefined) throw new Error('The test model was not registered.')
    const { session } = await createAgentSession({
      cwd,
      model,
      modelRuntime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
      tools: ['bash', 'codemode'],
    })
    try {
      await session.prompt('Describe bash from a script.')
      const result = session.messages.find(
        (message) => message.role === 'toolResult' && message.toolCallId === 'script',
      )
      if (result?.role !== 'toolResult') throw new Error('The script produced no result.')
      const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')

      expect(text).toContain('Script completed')
      expect(text).toContain('exit_code')
      expect(text).not.toContain('Promise<string>')
    } finally {
      session.dispose()
    }
  } finally {
    await rm(cwd, { force: true, recursive: true })
  }
})
