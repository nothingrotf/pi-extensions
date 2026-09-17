import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ProviderConfig,
} from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vite-plus/test'

import filetools from '../src/index.ts'

const config: ProviderConfig = {
  api: 'openai-completions',
  apiKey: 'test-key',
  baseUrl: 'http://127.0.0.1/unused',
  models: [
    {
      contextWindow: 100_000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: 'plain',
      input: ['text'],
      maxTokens: 8_000,
      name: 'Test Plain',
      reasoning: false,
    },
  ],
  name: 'Filetools test provider',
}

test('contributes its tools and guidelines to the session system prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-filetools-prompt-'))
  try {
    const resourceLoader = new DefaultResourceLoader({
      agentDir: join(dir, 'agent'),
      cwd: dir,
      extensionFactories: [filetools],
      noContextFiles: true,
      noExtensions: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager: SettingsManager.inMemory(),
    })
    await resourceLoader.reload()
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
    modelRuntime.registerProvider('filetools-test', config)
    const model = modelRuntime.getModel('filetools-test', 'plain')
    if (model === undefined) throw new Error('The test model was not registered.')
    const created = await createAgentSession({
      cwd: dir,
      model,
      modelRuntime,
      resourceLoader,
      sessionManager: SessionManager.create(dir, join(dir, 'sessions')),
      thinkingLevel: 'off',
    })
    try {
      const prompt = created.session.systemPrompt

      expect(prompt).toContain('patch: Edit several files in one call')
      expect(prompt).toContain(
        'Use patch to change several files in one call instead of one edit call per file.',
      )
      expect(prompt).toContain('A patch writes nothing when any edit fails to match exactly once.')
      expect(prompt).toContain(
        'After a bounded head and file map, continue at the offset the result names.',
      )
      expect(prompt).toContain(
        'Read several files in one call with paths instead of one read call per file.',
      )
      expect(prompt).toContain(
        'Select fields of a large JSON file with json instead of reading the whole document.',
      )
      expect(prompt).toContain('Use read to examine files instead of cat or sed.')
    } finally {
      created.session.dispose()
    }
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})
