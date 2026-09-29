import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  getCurrentTools,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { expect, it } from 'vite-plus/test'

import ask from '../src/index.ts'

it('keeps AskQuestion declared to the model and out of codemode scripts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ask-codemode-'))
  try {
    const loader = new DefaultResourceLoader({
      agentDir: join(cwd, 'agent'),
      cwd,
      extensionFactories: [createCodemodeExtension({ models: false }), ask],
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager: SettingsManager.inMemory(),
    })
    await loader.reload()
    let declared: readonly string[] = []
    const faux = fauxProvider({ models: [{ id: 'plain' }], provider: 'ask-test' })
    faux.setResponses([
      (context) => {
        declared = getCurrentTools(context.messages).map((tool) => tool.name)
        return fauxAssistantMessage(
          fauxToolCall('codemode', { code: 'return typeof tools.AskQuestion' }, { id: 'script' }),
          { stopReason: 'toolUse' },
        )
      },
      fauxAssistantMessage(fauxText('done')),
    ])
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
    modelRuntime.registerNativeProvider(faux.provider)
    const model = modelRuntime.getModel('ask-test', 'plain')
    if (model === undefined) throw new Error('The test model was not registered.')
    const { session } = await createAgentSession({
      cwd,
      model,
      modelRuntime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
      tools: ['AskQuestion', 'codemode'],
    })
    try {
      await session.prompt('Ask the user from a script.')
      const result = session.messages.find(
        (message) => message.role === 'toolResult' && message.toolCallId === 'script',
      )
      if (result?.role !== 'toolResult') throw new Error('The script produced no result.')
      const text = result.content.map((part) => (part.type === 'text' ? part.text : '')).join('')

      expect(declared).toEqual(expect.arrayContaining(['AskQuestion', 'codemode']))
      expect(text).toContain('Script completed')
      expect(text.trimEnd().endsWith('undefined')).toBe(true)
    } finally {
      session.dispose()
    }
  } finally {
    await rm(cwd, { force: true, recursive: true })
  }
})
