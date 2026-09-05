import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { emptyRailComponent, RailBridge, railOutputText, type RailStatus } from './rail.ts'
import { SessionHistorySchema } from './schema.ts'
import { SessionChangedError } from './session-file.ts'
import { HistoryError, type HistoryResponse, SessionHistoryStore } from './sessions.ts'
import { WorkLimitError } from './work.ts'

const maximumResponseCharacters = 200_000

interface ErrorResponse {
  action: string
  error: { code: string; message: string }
  limits?: { responseCharacterLimit: number }
}

interface ToolOutput {
  content: Array<{ type: 'text'; text: string }>
  details: HistoryResponse
}

function toolResult(value: HistoryResponse): ToolOutput {
  const text = JSON.stringify(value)
  if (text.length <= maximumResponseCharacters) {
    return { content: [{ type: 'text', text }], details: value }
  }
  throw new HistoryError(
    'RESULT_LIMIT_EXCEEDED',
    'The response exceeded the total character limit. Use a smaller item limit.',
  )
}

export default function sessionHistory(pi: ExtensionAPI): void {
  let store: SessionHistoryStore | undefined
  const rail = new RailBridge(pi, ['session_history'])

  pi.registerTool({
    name: 'session_history',
    label: 'Session history',
    description:
      'List, search, read, and audit Pi sessions from the current project. Use content to page through a long message or tool result by entry_id and block_index. Results use stable logical references and never expose physical session paths.',
    promptSnippet: 'Inspect project-scoped Pi session history',
    promptGuidelines: [
      'Use session_history to find evidence in prior or current Pi sessions.',
      'Treat tool activity as recorded evidence. Do not infer success from assistant text.',
    ],
    parameters: SessionHistorySchema,
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (store === undefined || !store.usesCurrent(ctx.sessionManager)) {
        store = new SessionHistoryStore(ctx.sessionManager)
      }
      try {
        return toolResult(await store.execute(params, signal))
      } catch (error) {
        signal?.throwIfAborted()
        const historyError =
          error instanceof HistoryError ||
          error instanceof WorkLimitError ||
          error instanceof SessionChangedError
            ? error
            : new HistoryError('MALFORMED_SESSION', 'The session history request failed.')
        const failure: ErrorResponse = {
          action: params.action,
          error: { code: historyError.code, message: historyError.message },
        }
        if (historyError.code === 'RESULT_LIMIT_EXCEEDED') {
          failure.limits = { responseCharacterLimit: maximumResponseCharacters }
        }
        throw new Error(JSON.stringify(failure))
      }
    },
    renderShell: 'self',
    renderCall(args, _theme, context) {
      if (!rail.active) return emptyRailComponent
      rail.report({
        detail: args.action,
        doneLabel: 'History',
        runningLabel: 'History',
        status: 'pending',
        toolCallId: context.toolCallId,
        iconKey: 'todo',
        toolName: 'session_history',
      })
      return emptyRailComponent
    },
    renderResult(result, options, _theme, context) {
      if (!rail.active) return emptyRailComponent
      const status: RailStatus = context.isError ? 'error' : options.isPartial ? 'pending' : 'ok'
      rail.report({
        detail: context.args.action,
        doneLabel: 'History',
        output: railOutputText(result.content),
        runningLabel: 'History',
        status,
        toolCallId: context.toolCallId,
        iconKey: 'todo',
        toolName: 'session_history',
      })
      return emptyRailComponent
    },
  })
}

export { ContentReadSchema, SessionHistorySchema } from './schema.ts'
export type { ContentReadInput, SessionHistoryInput } from './schema.ts'
export type { ContentChunk } from './content.ts'
export { HistoryError, SessionHistoryStore } from './sessions.ts'
export type { ContentResponse, HistoryResponse } from './sessions.ts'
