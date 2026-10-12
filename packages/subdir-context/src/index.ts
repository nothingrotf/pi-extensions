import { realpath } from 'node:fs/promises'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'

import {
  ancestorContextFiles,
  contentHash,
  discoverContextFiles,
  touchedPaths,
} from './discovery.ts'
import {
  DeliveryDetailsSchema,
  deliveredFiles,
  deliveryMessage,
  type DeliveryDetails,
  messageType,
} from './state.ts'

export { CONTEXT_FILE_NAMES, directoryChain, touchedPaths } from './discovery.ts'
export { deliveredFiles, messageType } from './state.ts'

export default function subdirContext(pi: ExtensionAPI): void {
  let delivered = new Map<string, string>()
  const queued = new Map<string, string>()
  let preloaded = new Set<string>()
  let enabled = true
  let root: string | undefined

  const rebuild = (ctx: ExtensionContext) => {
    delivered = deliveredFiles(ctx.sessionManager.getBranch())
    queued.clear()
  }

  pi.on('session_start', (_event, ctx) => {
    root = undefined
    rebuild(ctx)
  })
  pi.on('session_tree', (_event, ctx) => rebuild(ctx))
  pi.on('session_compact', (_event, ctx) => rebuild(ctx))
  pi.on('agent_settled', (_event, ctx) => rebuild(ctx))

  pi.on('before_agent_start', async (event, ctx) => {
    rebuild(ctx)
    const loaded = event.systemPromptOptions.contextFiles
    preloaded = new Set(loaded.map((file) => contentHash(file.content)))
    const loadedPaths = new Set(loaded.map((file) => file.path))
    const project = await ancestorContextFiles(ctx.cwd)
    const disabledByHost = project.length > 0 && !project.some((path) => loadedPaths.has(path))
    enabled = ctx.isProjectTrusted() && !disabledByHost
    root = await realpath(ctx.cwd)
  })

  pi.on('tool_result', async (event, ctx) => {
    if (!enabled || event.isError) return
    const paths = touchedPaths(event.toolName, event.input)
    if (paths.length === 0) return
    const base = root ?? (await realpath(ctx.cwd))
    const files = (await discoverContextFiles(base, paths)).filter(
      (file) =>
        !preloaded.has(file.sha256) &&
        (queued.get(file.path) ?? delivered.get(file.path)) !== file.sha256,
    )
    if (files.length === 0) return
    const changed = new Set(
      files
        .filter((file) => queued.has(file.path) || delivered.has(file.path))
        .map((file) => file.path),
    )
    for (const file of files) queued.set(file.path, file.sha256)
    const details: DeliveryDetails = {
      files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
      version: 1,
    }
    pi.sendMessage(
      {
        content: deliveryMessage(event.toolName, files, changed),
        customType: messageType,
        details,
        display: true,
      },
      { triggerTurn: false },
    )
  })

  pi.registerMessageRenderer(messageType, (message, options, theme) => {
    if (!Value.Check(DeliveryDetailsSchema, message.details)) return undefined
    const paths = message.details.files.map((file) => file.path).join(', ')
    return new Text(theme.fg('dim', `Loaded instructions: ${paths}`), options.outputPad, 0)
  })
}
