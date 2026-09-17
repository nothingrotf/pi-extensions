import { mkdtemp, writeFile } from 'node:fs/promises'
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

import filetools from '../src/index.ts'
import type { PatchInput } from '../src/patch.ts'
import type { ReadInput } from '../src/read.ts'

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

export interface SeedFile {
  content: string
  name: string
}

export interface FiletoolsHarness {
  cwd: string
  dispose: () => void
  systemPrompt: string
  tool: (name: string) => {
    execute: (
      toolCallId: string,
      params: PatchInput | ReadInput,
    ) => Promise<{ content: readonly { text?: string; type: string }[] }>
  }
}

/** Start a real Pi session with the filetools extension, so tests exercise the registered tools. */
export async function createFiletoolsHarness(
  files: readonly SeedFile[] = [],
): Promise<FiletoolsHarness> {
  const cwd = await mkdtemp(join(tmpdir(), 'filetools-session-'))
  for (const file of files) await writeFile(join(cwd, file.name), file.content, 'utf8')
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(cwd, 'agent'),
    cwd,
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
    cwd,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(cwd, join(cwd, 'sessions')),
    thinkingLevel: 'off',
  })
  return {
    cwd,
    dispose: () => {
      created.session.dispose()
    },
    systemPrompt: created.session.systemPrompt,
    tool: (name) => {
      const found = created.session.agent.state.tools.find((entry) => entry.name === name)
      if (found === undefined) throw new Error(`The session has no ${name} tool.`)
      return found
    },
  }
}

export function resultText(result: {
  content: readonly { text?: string; type: string }[]
}): string {
  return result.content
    .map((block) => (block.type === 'text' ? (block.text ?? '') : '[image]'))
    .join('\n')
}
