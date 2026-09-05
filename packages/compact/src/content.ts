import type { SessionEntry, SessionMessageEntry } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

export type Message = SessionMessageEntry['message']

export function messageText(message: Message, includeThinking = false): string {
  switch (message.role) {
    case 'user':
    case 'custom':
      if (Value.Check(Type.String(), message.content)) return message.content
      return message.content
        .map((part) => (part.type === 'text' ? part.text : `[image: ${part.mimeType}]`))
        .join('\n')
    case 'assistant':
      return message.content
        .map((part) => {
          if (part.type === 'text') return part.text
          if (part.type === 'thinking') return includeThinking ? `[thinking]\n${part.thinking}` : ''
          return `[tool call ${part.name} ${part.id}] ${JSON.stringify(part.arguments)}`
        })
        .filter(Boolean)
        .join('\n')
    case 'toolResult':
      return message.content
        .map((part) => (part.type === 'text' ? part.text : `[image: ${part.mimeType}]`))
        .join('\n')
    case 'bashExecution':
      return message.excludeFromContext
        ? ''
        : `$ ${message.command}\nexit: ${message.exitCode ?? 'unknown'}\n${message.output}`
    case 'branchSummary':
    case 'compactionSummary':
      return message.summary
    default:
      return ''
  }
}

export function entryText(entry: SessionEntry): string {
  switch (entry.type) {
    case 'message':
      return messageText(entry.message, true)
    case 'custom_message':
      if (Value.Check(Type.String(), entry.content)) return entry.content
      return entry.content
        .map((part) => (part.type === 'text' ? part.text : `[image: ${part.mimeType}]`))
        .join('\n')
    case 'branch_summary':
    case 'compaction':
      return entry.summary
    default:
      return ''
  }
}

export function entryLabel(entry: SessionEntry): string {
  if (entry.type !== 'message') return entry.type
  return entry.message.role === 'toolResult'
    ? `tool ${entry.message.toolName} (${entry.message.isError ? 'error' : 'success'})`
    : entry.message.role
}
