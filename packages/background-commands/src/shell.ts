import { delimiter, join } from 'node:path'

import {
  getAgentDir,
  SettingsManager,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'

export interface CommandContext {
  readonly cwd: string
  readonly sessionFile?: string | undefined
  readonly model?: { readonly provider: string; readonly id: string } | undefined
  readonly thinkingLevel?: string | undefined
  readonly shellPath?: string | undefined
  readonly commandPrefix?: string | undefined
  readonly exposeSessionEnvironment?: boolean
}

export function commandEnvironment(sessionId: string, context: CommandContext): NodeJS.ProcessEnv {
  const env = { ...process.env }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  const path = env[pathKey] ?? ''
  const bin = join(getAgentDir(), 'bin')
  if (!path.split(delimiter).includes(bin))
    env[pathKey] = [bin, path].filter(Boolean).join(delimiter)
  for (const key of [
    'PI_SESSION_ID',
    'PI_SESSION_FILE',
    'PI_PROVIDER',
    'PI_MODEL',
    'PI_REASONING_LEVEL',
  ])
    delete env[key]
  if (context.exposeSessionEnvironment !== false) {
    env.PI_SESSION_ID = sessionId
    if (context.sessionFile !== undefined) env.PI_SESSION_FILE = context.sessionFile
    if (context.model !== undefined) {
      env.PI_PROVIDER = context.model.provider
      env.PI_MODEL = context.model.id
    }
    if (context.thinkingLevel !== undefined) env.PI_REASONING_LEVEL = context.thinkingLevel
  }
  return env
}

export function sessionCommandContext(ctx: ExtensionContext): CommandContext {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  })
  return {
    cwd: ctx.cwd,
    sessionFile: ctx.sessionManager.getSessionFile(),
    model: ctx.model,
    thinkingLevel: ctx.thinkingLevel,
    shellPath: settings.getShellPath(),
    commandPrefix: settings.getShellCommandPrefix(),
  }
}
