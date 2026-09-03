import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { IconKey } from './icons.ts'
import type { RailCategory, RailStatus } from './rail.ts'

export const railToolsChannel = 'hud:rail-tools'
export const railActionChannel = 'hud:rail-action'
export const railEnabledChannel = 'hud:rail-enabled'

const RailToolsSchema = Type.Object({
  tools: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
})

const RailActionSchema = Type.Object({
  toolName: Type.Optional(Type.String({ minLength: 1 })),
  category: Type.Optional(
    Type.Union([
      Type.Literal('edit'),
      Type.Literal('meta'),
      Type.Literal('other'),
      Type.Literal('read'),
      Type.Literal('search'),
    ]),
  ),
  detail: Type.Optional(Type.String()),
  doneLabel: Type.Optional(Type.String({ minLength: 1 })),
  iconKey: Type.Optional(
    Type.Union([
      Type.Literal('agent'),
      Type.Literal('ask'),
      Type.Literal('branch'),
      Type.Literal('edit'),
      Type.Literal('find'),
      Type.Literal('read'),
      Type.Literal('search'),
      Type.Literal('shell'),
      Type.Literal('todo'),
      Type.Literal('tool'),
      Type.Literal('web'),
    ]),
  ),
  output: Type.Optional(Type.String()),
  parentToolCallId: Type.Optional(Type.String({ minLength: 1 })),
  runningLabel: Type.Optional(Type.String({ minLength: 1 })),
  status: Type.Union([Type.Literal('error'), Type.Literal('ok'), Type.Literal('pending')]),
  summary: Type.Optional(Type.String()),
  toolCallId: Type.String({ minLength: 1 }),
})

export type RailAnnouncement = {
  tools: string[]
}

export type RailActionReport = {
  category?: RailCategory
  detail?: string
  doneLabel?: string
  iconKey?: IconKey
  output?: string
  parentToolCallId?: string
  runningLabel?: string
  status: RailStatus
  summary?: string
  toolCallId: string
  toolName?: string
}

const iconByToolName = new Map<string, IconKey>([
  ['AskQuestion', 'ask'],
  ['Task', 'agent'],
  ['fetch_content', 'web'],
  ['session_history', 'todo'],
  ['todo_read', 'todo'],
  ['todo_write', 'todo'],
  ['web_search', 'web'],
])

export function defaultRailIcon(toolName: string): IconKey {
  const known = iconByToolName.get(toolName)
  if (known !== undefined) return known
  if (toolName.startsWith('mcp')) return 'tool'
  return 'tool'
}

export function defaultRailLabel(toolName: string): string {
  const words = toolName.replace(/[_-]+/gu, ' ').trim()
  if (words.length === 0) return 'Tool'
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

export function decodeRailTools<Input>(data: Input): RailAnnouncement | undefined {
  return Value.Check(RailToolsSchema, data) ? data : undefined
}

export function decodeRailAction<Input>(data: Input): RailActionReport | undefined {
  return Value.Check(RailActionSchema, data) ? data : undefined
}

export const builtInRailToolNames = ['bash', 'edit', 'find', 'grep', 'ls', 'read', 'write']
