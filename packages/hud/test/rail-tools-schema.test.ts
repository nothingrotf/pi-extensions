import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vite-plus/test'

import hud from '../src/index.ts'

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

      const sources = new Map(
        session.extensionRunner.getAllRegisteredTools().map((tool) => [tool.definition.name, tool]),
      )
      for (const name of ['bash', 'edit', 'find', 'ls', 'write'])
        expect(sources.has(name)).toBe(false)
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
