import type {
  ExtensionAPI,
  ToolResultEvent,
  ToolResultEventResult,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { cloakText, loadState, type CloakState } from './cloak.ts'

const InputSchema = Type.Object({
  path: Type.Optional(Type.String()),
  paths: Type.Optional(Type.Array(Type.String())),
})
const FilesSchema = Type.Object({
  files: Type.Array(
    Type.Object({
      path: Type.String(),
      text: Type.String(),
      images: Type.Number(),
      bounded: Type.Boolean(),
    }),
  ),
  unread: Type.Array(Type.String()),
})

export function cloakReadResult(
  event: ToolResultEvent,
  cwd: string,
  state: CloakState,
): ToolResultEventResult | undefined {
  if (event.toolName !== 'read' || state.config.enabled === false) return undefined
  if (!Value.Check(InputSchema, event.input)) return undefined
  const paths = event.input.paths ?? (event.input.path ? [event.input.path] : [])
  if (paths.length === 0) return undefined
  let path = event.input.path ?? ''
  let changed = false
  const content = event.content.map((part) => {
    if (part.type !== 'text') return part
    const header = paths.find((candidate) => part.text === `===== ${candidate} =====`)
    if (header !== undefined) {
      path = header
      return part
    }
    if (!path) return part
    const text = cloakText(part.text, path, cwd, state)
    if (text === part.text) return part
    changed = true
    return { ...part, text }
  })
  if (Value.Check(FilesSchema, event.structuredContent)) {
    const files = event.structuredContent.files.map((file) => {
      const text = cloakText(file.text, file.path, cwd, state)
      if (text !== file.text) changed = true
      return { ...file, text }
    })
    if (!changed) return undefined
    return { content, structuredContent: { files, unread: event.structuredContent.unread } }
  }
  return changed ? { content } : undefined
}

export default function cloak(pi: ExtensionAPI): void {
  let state: CloakState | undefined
  const reload = () => {
    state = loadState()
    return state
  }
  pi.on('session_start', (_event, ctx) => {
    const loaded = reload()
    if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, 'warning')
  })
  pi.registerCommand('cloak-status', {
    description: 'Reload pi-cloak configuration and show its status',
    handler: async (_args, ctx) => {
      const loaded = reload()
      ctx.ui.notify(
        loaded.error ??
          `pi-cloak enabled=${loaded.config.enabled !== false} patterns=${loaded.rules.length} config=${loaded.configPath}`,
        loaded.error ? 'warning' : 'info',
      )
    },
  })
  pi.on('tool_result', (event, ctx) => cloakReadResult(event, ctx.cwd, state ?? reload()))
}
