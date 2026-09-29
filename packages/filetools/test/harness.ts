import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  type CreateAgentSessionOptions,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

import filetools from '../src/index.ts'
import type { PatchInput } from '../src/patch.ts'
import type { ReadInput } from '../src/read.ts'

export interface SeedFile {
  content: string
  name: string
}

export interface ScriptResult {
  isError: boolean
  nestedCalls: readonly { name: string; status: string }[]
  text: string
}

export interface FiletoolsHarness {
  activeTools: () => readonly string[]
  cwd: string
  dispose: () => void
  runScript: (code: string) => Promise<ScriptResult>
  systemPrompt: string
  tool: (name: string) => {
    execute: (
      toolCallId: string,
      params: PatchInput | ReadInput,
    ) => Promise<{
      content: readonly { text?: string; type: string }[]
      structuredContent?: unknown
    }>
  }
}

export interface FiletoolsHarnessOptions {
  codemode?: boolean
  tools?: readonly string[]
}

/** Start a real Pi session with the filetools extension, so tests exercise the registered tools. */
export async function createFiletoolsHarness(
  files: readonly SeedFile[] = [],
  options: FiletoolsHarnessOptions = {},
): Promise<FiletoolsHarness> {
  const cwd = await mkdtemp(join(tmpdir(), 'filetools-session-'))
  for (const file of files) await writeFile(join(cwd, file.name), file.content, 'utf8')
  const resourceLoader = new DefaultResourceLoader({
    agentDir: join(cwd, 'agent'),
    cwd,
    extensionFactories: [
      ...(options.codemode === true ? [createCodemodeExtension({ models: false })] : []),
      filetools,
    ],
    noContextFiles: true,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager: SettingsManager.inMemory(),
  })
  await resourceLoader.reload()
  const faux = fauxProvider({ models: [{ id: 'plain' }], provider: 'filetools-test' })
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerNativeProvider(faux.provider)
  const model = modelRuntime.getModel('filetools-test', 'plain')
  if (model === undefined) throw new Error('The test model was not registered.')
  const sessionOptions: CreateAgentSessionOptions = {
    cwd,
    model,
    modelRuntime,
    resourceLoader,
    sessionManager: SessionManager.create(cwd, join(cwd, 'sessions')),
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
    thinkingLevel: 'off',
  }
  if (options.tools !== undefined) sessionOptions.tools = [...options.tools]
  const { session } = await createAgentSession(sessionOptions)
  let scripts = 0
  return {
    activeTools: () => session.getActiveToolNames(),
    cwd,
    dispose: () => {
      session.dispose()
    },
    runScript: async (code) => {
      scripts += 1
      const id = `script-${scripts}`
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall('codemode', { code }, { id }), {
          stopReason: 'toolUse',
        }),
        fauxAssistantMessage(fauxText('done')),
      ])
      await session.prompt(`Run script ${scripts}`)
      const message = session.messages.find(
        (entry) => entry.role === 'toolResult' && entry.toolCallId === id,
      )
      if (message?.role !== 'toolResult') throw new Error(`The session has no result for ${id}.`)
      return {
        isError: message.isError,
        nestedCalls: message.nestedCalls?.calls ?? [],
        text: resultText(message),
      }
    },
    systemPrompt: session.systemPrompt,
    tool: (name) => {
      const found = session.agent.state.tools.find((entry) => entry.name === name)
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
