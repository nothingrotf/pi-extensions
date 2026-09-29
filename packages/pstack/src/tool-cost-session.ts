import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  getCurrentSystemPrompt,
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

import {
  declarationCost,
  type CodemodeMode,
  type DeclarationCost,
  type DeclaredTool,
} from './tool-cost.ts'

export async function measureDeclarations(
  extensionPaths: readonly string[],
  mode: CodemodeMode,
): Promise<DeclarationCost> {
  const root = await mkdtemp(join(tmpdir(), 'pstack-declarations-'))
  try {
    const settingsManager = SettingsManager.inMemory(
      mode === 'off' ? {} : { defaultTools: ['+codemode'] },
    )
    const loader = new DefaultResourceLoader({
      additionalExtensionPaths: [...extensionPaths],
      agentDir: join(root, 'agent'),
      cwd: root,
      extensionFactories: mode === 'off' ? [] : [createCodemodeExtension({ mode, models: false })],
      noContextFiles: true,
      noPromptTemplates: true,
      noSkills: true,
      noThemes: true,
      settingsManager,
    })
    await loader.reload()
    const errors = loader.getExtensions().errors
    if (errors.length > 0) {
      throw new Error(errors.map((error) => `Cannot load ${error.path}: ${error.error}`).join('\n'))
    }
    let captured: { systemPrompt: string; tools: readonly DeclaredTool[] } | undefined
    const faux = fauxProvider({ models: [{ id: 'measure' }], provider: 'pstack-tool-cost' })
    faux.setResponses([
      (context) => {
        captured = {
          systemPrompt: getCurrentSystemPrompt(context.messages) ?? '',
          tools: getCurrentTools(context.messages),
        }
        return fauxAssistantMessage(fauxText('measured'))
      },
    ])
    const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
    modelRuntime.registerNativeProvider(faux.provider)
    const model = modelRuntime.getModel('pstack-tool-cost', 'measure')
    if (model === undefined) throw new Error('The measurement model was not registered.')
    const { session } = await createAgentSession({
      agentDir: join(root, 'agent'),
      cwd: root,
      model,
      modelRuntime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(root),
      settingsManager,
    })
    try {
      await session.prompt('Measure the declared tools.')
    } finally {
      session.dispose()
    }
    if (captured === undefined) throw new Error('The measurement session sent no request.')
    return declarationCost(mode, captured.tools, captured.systemPrompt)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
}
