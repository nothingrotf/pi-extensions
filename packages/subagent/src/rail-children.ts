import { relative } from 'node:path'

import { truncateToWidth } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { oneLineLabel } from './format.ts'
import type { RailActionReport, RailBridge, RailCategory, RailIconKey } from './rail.ts'
import type { ChildToolEvent } from './runtime.ts'

const OUTPUT_LINE_CAP = 12
const OUTPUT_CHAR_CAP = 4_096
const SUMMARY_CAP = 96
const HIDDEN_TOOLS = new Set(['update_progress'])

type ChildToolMeta = {
  category: RailCategory
  doneLabel: string
  iconKey?: RailIconKey
  runningLabel: string
}

const childToolMeta = new Map<string, ChildToolMeta>([
  ['read', { category: 'read', doneLabel: 'Read', iconKey: 'read', runningLabel: 'Reading' }],
  ['write', { category: 'edit', doneLabel: 'Wrote', iconKey: 'edit', runningLabel: 'Writing' }],
  ['edit', { category: 'edit', doneLabel: 'Edited', iconKey: 'edit', runningLabel: 'Editing' }],
  ['bash', { category: 'other', doneLabel: 'Ran', iconKey: 'shell', runningLabel: 'Running' }],
  [
    'grep',
    { category: 'search', doneLabel: 'Searched', iconKey: 'grep', runningLabel: 'Searching' },
  ],
  ['find', { category: 'search', doneLabel: 'Found', iconKey: 'find', runningLabel: 'Finding' }],
  ['ls', { category: 'search', doneLabel: 'Listed', iconKey: 'list', runningLabel: 'Listing' }],
  [
    'Task',
    { category: 'other', doneLabel: 'Dispatched', iconKey: 'agent', runningLabel: 'Dispatching' },
  ],
  [
    'ask_parent',
    { category: 'other', doneLabel: 'Asked parent', iconKey: 'ask', runningLabel: 'Asking parent' },
  ],
  [
    'request_parent',
    {
      category: 'other',
      doneLabel: 'Requested decision',
      iconKey: 'ask',
      runningLabel: 'Requesting decision',
    },
  ],
  [
    'notify_parent',
    {
      category: 'other',
      doneLabel: 'Notified parent',
      iconKey: 'agent',
      runningLabel: 'Notifying parent',
    },
  ],
  [
    'send_peer',
    {
      category: 'other',
      doneLabel: 'Messaged peer',
      iconKey: 'agent',
      runningLabel: 'Messaging peer',
    },
  ],
  [
    'receive_peers',
    {
      category: 'other',
      doneLabel: 'Received peers',
      iconKey: 'agent',
      runningLabel: 'Receiving peers',
    },
  ],
])

const PathArgs = Type.Object({ path: Type.String() })
const CommandArgs = Type.Object({ command: Type.String() })
const PatternArgs = Type.Object({ pattern: Type.String() })
const GenericArgs = Type.Object(
  {
    command: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    file_path: Type.Optional(Type.String()),
    filePath: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    path: Type.Optional(Type.String()),
    pattern: Type.Optional(Type.String()),
    query: Type.Optional(Type.String()),
    question: Type.Optional(Type.String()),
    subject: Type.Optional(Type.String()),
    task: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

function defaultLabel(toolName: string): string {
  const words = toolName.replace(/[_-]+/gu, ' ').trim()
  if (words.length === 0) return 'Tool'
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

function clip(value: string, maximum: number): string {
  const text = oneLineLabel(value, Number.POSITIVE_INFINITY)
  return text.length > maximum ? `${text.slice(0, maximum - 3)}...` : text
}

function shortPath(value: string, cwd: string): string {
  const raw = oneLineLabel(value, Number.POSITIVE_INFINITY)
  if (raw.length === 0) return ''
  const relativePath = relative(cwd, raw)
  if (relativePath.length === 0) return '.'
  return relativePath.startsWith('..') ? raw : relativePath
}

export function childToolDetail<Args>(toolName: string, args: Args, cwd: string): string {
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
    case 'ls':
      return Value.Check(PathArgs, args) ? shortPath(args.path, cwd) : ''
    case 'bash':
      return Value.Check(CommandArgs, args) ? clip(args.command, 60) : ''
    case 'grep':
      return Value.Check(PatternArgs, args) ? clip(args.pattern, 55) : ''
    case 'find':
      return Value.Check(PatternArgs, args) ? clip(args.pattern, 50) : ''
    default: {
      if (!Value.Check(GenericArgs, args)) return ''
      const value =
        args.description ??
        args.pattern ??
        args.query ??
        args.command ??
        args.path ??
        args.file_path ??
        args.filePath ??
        args.url ??
        args.name ??
        args.subject ??
        args.task ??
        args.question ??
        args.message
      return value === undefined ? '' : clip(value, 60)
    }
  }
}

export function childOutputSummary(output: string, status: 'error' | 'ok'): string {
  const trimmed = output.trimEnd()
  if (trimmed.length === 0) return ''
  const lines = trimmed.split('\n')
  if (status === 'error') {
    const first = lines.find((line) => line.trim().length > 0) ?? ''
    return truncateToWidth(oneLineLabel(first, Number.POSITIVE_INFINITY), SUMMARY_CAP, '…')
  }
  if (lines.length > 1) return `${lines.length} lines`
  return truncateToWidth(oneLineLabel(trimmed, Number.POSITIVE_INFINITY), SUMMARY_CAP, '…')
}

export function childOutputPreview(output: string): string {
  const lines = output.trimEnd().split('\n').slice(0, OUTPUT_LINE_CAP)
  const characters = Array.from(lines.join('\n'))
  return characters.length > OUTPUT_CHAR_CAP
    ? characters.slice(0, OUTPUT_CHAR_CAP).join('')
    : characters.join('')
}

export function childRailToolCallId(agentId: string, toolCallId: string): string {
  return `${agentId}:${toolCallId}`
}

export function childRailReport(
  event: ChildToolEvent,
  parentToolCallId: string,
  durationMs?: number,
): RailActionReport | undefined {
  if (HIDDEN_TOOLS.has(event.toolName)) return undefined
  const meta = childToolMeta.get(event.toolName)
  const base: RailActionReport = {
    category: meta?.category ?? 'other',
    doneLabel: meta?.doneLabel ?? defaultLabel(event.toolName),
    parentToolCallId,
    runningLabel: meta?.runningLabel ?? defaultLabel(event.toolName),
    status: event.status,
    toolCallId: childRailToolCallId(event.agentId, event.toolCallId),
    toolName: event.toolName,
  }
  if (meta?.iconKey !== undefined) base.iconKey = meta.iconKey
  if (event.status === 'pending') {
    return { ...base, detail: childToolDetail(event.toolName, event.args, event.cwd) }
  }
  const settled: RailActionReport = {
    ...base,
    output: childOutputPreview(event.output),
    summary: childOutputSummary(event.output, event.status),
  }
  if (durationMs !== undefined) settled.durationMs = Math.max(0, durationMs)
  return settled
}

export class RailChildReporter {
  private readonly agentIds = new Set<string>()
  private readonly startedAt = new Map<string, number>()
  private readonly unsubscribe: () => void
  private stopped = false

  constructor(
    private readonly rail: Pick<RailBridge, 'active' | 'report'>,
    runtime: { subscribeChildTools: (listener: (event: ChildToolEvent) => void) => () => void },
    private readonly parentToolCallId: string,
    private readonly now: () => number = Date.now,
  ) {
    this.unsubscribe = runtime.subscribeChildTools((event) => this.handle(event))
  }

  readonly started = (agentId: string): void => {
    if (this.stopped) return
    this.agentIds.add(agentId)
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    this.agentIds.clear()
    this.startedAt.clear()
  }

  private handle(event: ChildToolEvent): void {
    if (this.stopped || !this.rail.active || !this.agentIds.has(event.agentId)) return
    const id = childRailToolCallId(event.agentId, event.toolCallId)
    if (event.status === 'pending') {
      this.startedAt.set(id, this.now())
      const report = childRailReport(event, this.parentToolCallId)
      if (report !== undefined) this.rail.report(report)
      return
    }
    const began = this.startedAt.get(id)
    this.startedAt.delete(id)
    const report = childRailReport(
      event,
      this.parentToolCallId,
      began === undefined ? undefined : this.now() - began,
    )
    if (report !== undefined) this.rail.report(report)
  }
}
