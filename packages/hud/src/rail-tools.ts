import { relative } from 'node:path'

import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Type, type Static, type TSchema } from 'typebox'
import { Value } from 'typebox/value'

import { sanitizeScalar } from './format.ts'
import type { IconKey } from './icons.ts'
import { defaultRailIcon, defaultRailLabel, type RailActionReport } from './rail-channel.ts'
import { decodeRailEntry, railEntryType } from './rail-entry.ts'
import type { RailSegment } from './rail-segments.ts'
import { decodeRailStateEntry, railStateEntryType } from './rail-state-entry.ts'
import { messageSegments, projectRailVoice } from './rail-voice.ts'
import { RailStore, type RailCategory, type RailPatch, type RailStatus } from './rail.ts'

type RailState = { store?: RailStore }

const emptyComponent: Component = {
  invalidate: () => undefined,
  render: () => [],
}

function resultText(content: readonly (ImageContent | TextContent)[]): string {
  return content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

const PathArgs = Type.Object({ path: Type.String() })
const CommandArgs = Type.Object({ command: Type.String() })
const PatternArgs = Type.Object({ pattern: Type.String() })
const EditArgs = Type.Object({ edits: Type.Array(Type.Unknown()), path: Type.String() })

type BuiltInMeta = {
  category: RailCategory
  doneLabel: string
  iconKey: IconKey
  runningLabel: string
}

const builtInMeta = new Map<string, BuiltInMeta>([
  ['read', { category: 'read', doneLabel: 'Read', iconKey: 'read', runningLabel: 'Reading' }],
  ['write', { category: 'edit', doneLabel: 'Wrote', iconKey: 'edit', runningLabel: 'Writing' }],
  ['edit', { category: 'edit', doneLabel: 'Edited', iconKey: 'edit', runningLabel: 'Editing' }],
  ['bash', { category: 'other', doneLabel: 'Ran', iconKey: 'shell', runningLabel: 'Running' }],
  [
    'grep',
    { category: 'search', doneLabel: 'Searched', iconKey: 'search', runningLabel: 'Searching' },
  ],
  ['find', { category: 'search', doneLabel: 'Found', iconKey: 'find', runningLabel: 'Finding' }],
  ['ls', { category: 'search', doneLabel: 'Listed', iconKey: 'find', runningLabel: 'Listing' }],
])

export type RailCallInput = {
  arguments: unknown
  toolName: string
}

export function railDetail(call: RailCallInput, cwd: string): string {
  const args = call.arguments
  switch (call.toolName) {
    case 'read':
    case 'write':
    case 'ls':
      return Value.Check(PathArgs, args) ? shortPath(args.path, cwd) : ''
    case 'edit':
      return Value.Check(EditArgs, args) ? shortPath(args.path, cwd) : ''
    case 'bash':
      return Value.Check(CommandArgs, args) ? sanitizeScalar(args.command) : ''
    case 'grep':
    case 'find':
      return Value.Check(PatternArgs, args) ? sanitizeScalar(args.pattern) : ''
    default:
      return ''
  }
}

export function railPatchForCall(call: RailCallInput, cwd: string): RailPatch {
  const meta = builtInMeta.get(call.toolName)
  if (meta !== undefined) {
    return { ...meta, detail: railDetail(call, cwd), status: 'pending' }
  }
  const label = defaultRailLabel(call.toolName)
  return {
    category: 'other',
    detail: '',
    doneLabel: label,
    iconKey: defaultRailIcon(call.toolName),
    runningLabel: label,
    status: 'pending',
  }
}

export type SessionRails = {
  byEntryTurn: Map<number, RailStore>
  byToolCallId: Map<string, RailStore>
  hiddenAssistantTextBlocks: Map<number, Set<number>>
  hiddenAssistantTimestamps: Set<number>
  maxTurn: number
}

function applyStateReport(
  target: RailStore,
  report: RailActionReport,
  preserveSettlement = false,
): void {
  const patch: RailPatch = { ...report, measureDuration: false, resetDerived: true }
  if (preserveSettlement) {
    patch.measureDuration = true
    patch.resetDerived = false
    delete patch.status
  }
  if (report.parentToolCallId === undefined) target.report(report.toolCallId, patch)
  else target.reportChild(report.parentToolCallId, report.toolCallId, patch)
}

export function mapSessionRails(entries: readonly SessionEntry[], cwd = ''): SessionRails {
  const byEntryTurn = new Map<number, RailStore>()
  const byToolCallId = new Map<string, RailStore>()
  const parentByToolCallId = new Map<string, string>()
  const settledToolCallIds = new Set<string>()
  const startedAt = new Map<string, number>()
  const hiddenAssistantTextBlocks = new Map<number, Set<number>>()
  const hiddenAssistantTimestamps = new Set<number>()
  const renderedStores = new Set<RailStore>()
  const deferredReports: { report: RailActionReport; target: RailStore }[] = []
  let store = new RailStore()
  let segments: RailSegment[] = []
  let maxTurn = 0
  const finalize = () => {
    const projection = projectRailVoice(segments, false)
    for (const row of projection.rows) store.report(row.id, row.patch)
    store.reorder(projection.order)
    if (renderedStores.has(store)) {
      for (const [timestamp, sourceIndices] of projection.hiddenTextBlocks) {
        const indices = hiddenAssistantTextBlocks.get(timestamp) ?? new Set<number>()
        for (const index of sourceIndices) indices.add(index)
        hiddenAssistantTextBlocks.set(timestamp, indices)
        hiddenAssistantTimestamps.add(timestamp)
      }
    }
  }
  for (const entry of entries) {
    if (entry.type === 'custom' && entry.customType === railEntryType) {
      const turn = decodeRailEntry(entry.data)
      if (turn !== undefined) {
        byEntryTurn.set(turn, store)
        renderedStores.add(store)
        maxTurn = Math.max(maxTurn, turn)
      }
      continue
    }
    if (entry.type === 'custom' && entry.customType === railStateEntryType) {
      const state = decodeRailStateEntry(entry.data)
      if (state === undefined) continue
      const target = byEntryTurn.get(state.turn)
      if (target === undefined) continue
      applyStateReport(target, state.report)
      deferredReports.push({ report: state.report, target })
      byToolCallId.set(state.report.toolCallId, target)
      if (state.report.parentToolCallId !== undefined) {
        parentByToolCallId.set(state.report.toolCallId, state.report.parentToolCallId)
      }
      continue
    }
    if (entry.type !== 'message') continue
    const message = entry.message
    if (message.role === 'user') {
      finalize()
      store = new RailStore()
      segments = []
      continue
    }
    if (message.role === 'toolResult') {
      const target = byToolCallId.get(message.toolCallId)
      if (target === undefined) continue
      const began = startedAt.get(message.toolCallId)
      const patch: RailPatch = {
        output: resultText(message.content),
        status: message.isError ? 'error' : 'ok',
      }
      if (began !== undefined && message.timestamp >= began) {
        patch.durationMs = message.timestamp - began
      }
      const parentToolCallId = parentByToolCallId.get(message.toolCallId)
      if (parentToolCallId === undefined) target.report(message.toolCallId, patch)
      else target.reportChild(parentToolCallId, message.toolCallId, patch)
      settledToolCallIds.add(message.toolCallId)
      continue
    }
    if (message.role !== 'assistant') continue
    segments.push(...messageSegments(message))
    for (const block of message.content) {
      if (block.type !== 'toolCall') continue
      byToolCallId.set(block.id, store)
      startedAt.set(block.id, message.timestamp)
      store.report(
        block.id,
        railPatchForCall({ arguments: block.arguments, toolName: block.name }, cwd),
      )
    }
  }
  finalize()
  for (const deferred of deferredReports) {
    const preserveSettlement =
      deferred.report.status === 'pending' && settledToolCallIds.has(deferred.report.toolCallId)
    applyStateReport(deferred.target, deferred.report, preserveSettlement)
  }
  return {
    byEntryTurn,
    byToolCallId,
    hiddenAssistantTextBlocks,
    hiddenAssistantTimestamps,
    maxTurn,
  }
}

export function shortPath(value: string | undefined, cwd: string): string {
  const raw = sanitizeScalar(value)
  if (raw.length === 0) return ''
  const relativePath = relative(cwd, raw)
  if (relativePath.length === 0) return '.'
  return relativePath.startsWith('..') ? raw : relativePath
}

export type RailToolSpec<TParams extends TSchema> = {
  category: RailCategory
  detail: (args: Static<TParams>) => string
  doneLabel: string
  iconKey: IconKey
  runningLabel: string
}

export function railTool<TParams extends TSchema, TDetails, TBaseState>(
  base: ToolDefinition<TParams, TDetails, TBaseState>,
  storeFor: (toolCallId: string) => RailStore,
  spec: RailToolSpec<TParams>,
): ToolDefinition<TParams, TDetails, RailState> {
  const definition: ToolDefinition<TParams, TDetails, RailState> = {
    description: base.description,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      base.execute(toolCallId, params, signal, onUpdate, ctx),
    label: base.label,
    name: base.name,
    parameters: base.parameters,
    renderShell: 'self',
    renderCall(args, _theme, context) {
      const store = (context.state.store ??= storeFor(context.toolCallId))
      store.report(context.toolCallId, {
        category: spec.category,
        detail: spec.detail(args),
        doneLabel: spec.doneLabel,
        iconKey: spec.iconKey,
        runningLabel: spec.runningLabel,
        status: 'pending',
      })
      return emptyComponent
    },
    renderResult(result, options, _theme, context) {
      const store = (context.state.store ??= storeFor(context.toolCallId))
      const text = resultText(result.content)
      const status: RailStatus = context.isError ? 'error' : options.isPartial ? 'pending' : 'ok'
      const argDetail = spec.detail(context.args)
      const patch: RailPatch = { detail: argDetail, output: text, status }
      if (spec.category === 'edit' && status !== 'error') patch.summary = ''
      store.report(context.toolCallId, patch)
      return emptyComponent
    },
  }
  if (base.constrainedSampling !== undefined) {
    definition.constrainedSampling = base.constrainedSampling
  }
  if (base.executionMode !== undefined) {
    definition.executionMode = base.executionMode
  }
  if (base.promptGuidelines !== undefined) {
    definition.promptGuidelines = [...base.promptGuidelines]
  }
  if (base.promptSnippet !== undefined) {
    definition.promptSnippet = base.promptSnippet
  }
  const prepare = base.prepareArguments
  if (prepare !== undefined) {
    definition.prepareArguments = (args) => prepare(args)
  }
  return definition
}

type RailRegistration = {
  create: (cwd: string) => void
}

function specFor<TParams extends TSchema>(name: string, cwd: string): RailToolSpec<TParams> {
  const meta = builtInMeta.get(name) ?? {
    category: 'other',
    doneLabel: defaultRailLabel(name),
    iconKey: defaultRailIcon(name),
    runningLabel: defaultRailLabel(name),
  }
  return { ...meta, detail: (args) => railDetail({ arguments: args, toolName: name }, cwd) }
}

function builtInRegistrations(
  pi: ExtensionAPI,
  storeFor: (toolCallId: string) => RailStore,
): RailRegistration[] {
  return [
    {
      create: (cwd) =>
        pi.registerTool(railTool(createReadToolDefinition(cwd), storeFor, specFor('read', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createWriteToolDefinition(cwd), storeFor, specFor('write', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createEditToolDefinition(cwd), storeFor, specFor('edit', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createBashToolDefinition(cwd), storeFor, specFor('bash', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createGrepToolDefinition(cwd), storeFor, specFor('grep', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createFindToolDefinition(cwd), storeFor, specFor('find', cwd))),
    },
    {
      create: (cwd) =>
        pi.registerTool(railTool(createLsToolDefinition(cwd), storeFor, specFor('ls', cwd))),
    },
  ]
}

export function applyRailTools(
  pi: ExtensionAPI,
  storeFor: (toolCallId: string) => RailStore,
  cwd: string,
  enabled: boolean,
): void {
  if (!enabled) {
    pi.registerTool(createReadToolDefinition(cwd))
    pi.registerTool(createWriteToolDefinition(cwd))
    pi.registerTool(createEditToolDefinition(cwd))
    pi.registerTool(createBashToolDefinition(cwd))
    pi.registerTool(createGrepToolDefinition(cwd))
    pi.registerTool(createFindToolDefinition(cwd))
    pi.registerTool(createLsToolDefinition(cwd))
    return
  }
  for (const registration of builtInRegistrations(pi, storeFor)) {
    registration.create(cwd)
  }
}
