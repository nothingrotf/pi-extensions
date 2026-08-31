import { access } from 'node:fs/promises'

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  type AgentSession,
  type ExtensionContext,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import {
  CHILD_INTERCOM_TOOL_NAMES,
  createChildIntercomTools,
  type ChildIntercomHandlers,
} from './intercom.ts'
import { toThinkingLevel, type ResolvedModel } from './model.ts'
import { loadRolePrompt, type RoleDefinition } from './roles.ts'

const ProviderPayloadSchema = Type.Object({}, { additionalProperties: true })

function errorMessage<Input>(error: Input): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export class ChildSessionError extends Error {
  constructor(
    message: string,
    readonly agentId: string,
  ) {
    super(message)
  }
}

const fastModeExtension: InlineExtension = {
  factory: (pi) => {
    pi.on('before_provider_request', (event) => {
      if (!Value.Check(ProviderPayloadSchema, event.payload)) return event.payload
      const payload = Value.Decode(ProviderPayloadSchema, event.payload)
      return { ...payload, service_tier: 'priority' }
    })
  },
  hidden: true,
  name: 'subagent-fast-mode',
}

export function syncChildProviders(ctx: ExtensionContext, runtime: ModelRuntime): void {
  const providerIds = new Set(ctx.modelRegistry.getRegisteredProviderIds())
  for (const providerId of runtime.getRegisteredProviderIds()) {
    if (!providerIds.has(providerId)) runtime.unregisterProvider(providerId)
  }

  for (const providerId of providerIds) {
    const nativeProvider = ctx.modelRegistry.getRegisteredNativeProvider(providerId)
    const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(providerId)
    if (nativeProvider !== undefined) runtime.registerNativeProvider(nativeProvider)
    else if (providerConfig !== undefined) runtime.registerProvider(providerId, providerConfig)
  }
}

export async function createChildModelRuntime(ctx: ExtensionContext): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({ refreshOnCreate: false })
  syncChildProviders(ctx, runtime)
  await runtime.refresh({ allowNetwork: false })
  return runtime
}

function createSessionManager(
  ctx: ExtensionContext,
  resumeFile: string | undefined,
): SessionManager {
  if (resumeFile !== undefined) return SessionManager.open(resumeFile, undefined, ctx.cwd)

  const parentSession = ctx.sessionManager.getSessionFile()
  if (parentSession === undefined) return SessionManager.create(ctx.cwd)
  return SessionManager.create(ctx.cwd, undefined, { parentSession })
}

export interface CreateChildOptions {
  ctx: ExtensionContext
  description: string
  intercom: ChildIntercomHandlers
  model: ResolvedModel
  resumeFile: string | undefined
  role: RoleDefinition
  runtime: ModelRuntime
}

export async function createChildSession(options: CreateChildOptions): Promise<AgentSession> {
  if (options.resumeFile !== undefined) {
    try {
      await access(options.resumeFile)
    } catch {
      throw new Error(`The child transcript does not exist: ${options.resumeFile}`)
    }
  }

  const rolePrompt = await loadRolePrompt(options.role)
  const resourceLoader = new DefaultResourceLoader({
    agentDir: getAgentDir(),
    appendSystemPrompt: [rolePrompt],
    cwd: options.ctx.cwd,
    extensionFactories: options.model.fast ? [fastModeExtension] : [],
    noExtensions: true,
    noThemes: true,
  })
  await resourceLoader.reload()

  const sessionManager = createSessionManager(options.ctx, options.resumeFile)
  const created = await createAgentSession({
    customTools: createChildIntercomTools(sessionManager.getSessionId(), options.intercom),
    cwd: options.ctx.cwd,
    model: options.model.model,
    modelRuntime: options.runtime,
    resourceLoader,
    sessionManager,
    thinkingLevel: toThinkingLevel(options.model.effort),
  })

  if (created.modelFallbackMessage !== undefined) {
    const agentId = created.session.sessionId
    created.session.dispose()
    throw new ChildSessionError(created.modelFallbackMessage, agentId)
  }

  const activeModel = created.session.model
  if (
    activeModel === undefined ||
    `${activeModel.provider}/${activeModel.id}` !== options.model.modelRef
  ) {
    const agentId = created.session.sessionId
    created.session.dispose()
    throw new ChildSessionError(
      `The child session did not activate model "${options.model.modelRef}".`,
      agentId,
    )
  }

  try {
    if (options.role.tools !== undefined) {
      created.session.setActiveToolsByName([...options.role.tools, ...CHILD_INTERCOM_TOOL_NAMES])
    }
    created.session.setSessionName(`Task: ${options.description}`)
    return created.session
  } catch (error) {
    const agentId = created.session.sessionId
    created.session.dispose()
    throw new ChildSessionError(errorMessage(error), agentId)
  }
}
