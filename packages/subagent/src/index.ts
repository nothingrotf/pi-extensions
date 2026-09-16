import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import { decodeSubagentRegistration } from './agents.ts'
import { decodeCapabilityProfileRegistration, decodeCapabilityPublication } from './capabilities.ts'
import {
  decodeIntercomDetails,
  intercomTiming,
  intercomTimingKey,
  nativeIntercomLayout,
  renderIntercomCard,
  transcriptIntercomLayout,
} from './cards.ts'
import { registerTaskControl } from './control.ts'
import { acquireSubagentHost } from './controller.ts'
import { runBatch, type BatchItemResult } from './coordinator.ts'
import { taskRoleLabel } from './format.ts'
import { type JobProgressDetails, type JobSnapshot, toJobSnapshot } from './jobs.ts'
import { JobProgress } from './progress.ts'
import { RailChildReporter } from './rail-children.ts'
import { emptyRailComponent, RailBridge, railOutputText, type RailStatus } from './rail.ts'
import {
  type RuntimeBackgroundResult,
  type RuntimeCompletedDetails,
  type RuntimeFailedDetails,
  type RuntimeFailedResult,
  type SubagentRuntime,
} from './runtime.ts'
import { decodeBatchTaskInput, decodeSingleTaskInput, TaskInputSchema } from './schema.ts'
import {
  plainText,
  rowFromBatchItem,
  rowFromCompleted,
  rowFromFailed,
  rowFromJob,
  summaryLine,
  TaskCall,
  type TaskRenderState,
  TaskResult,
} from './task-render.ts'
import { SubagentTui } from './ui.ts'

export const SUBAGENT_DISCOVERY_EVENT = '@nothingrotf/subagent/discover-agents'
export const SUBAGENT_REGISTRATION_EVENT = '@nothingrotf/subagent/register-agents'
export const SUBAGENT_CAPABILITY_DISCOVERY_EVENT = '@nothingrotf/subagent/discover-capabilities'
export const SUBAGENT_CAPABILITY_REGISTRATION_EVENT = '@nothingrotf/subagent/register-capabilities'
export const SUBAGENT_CAPABILITY_PROFILE_DISCOVERY_EVENT =
  '@nothingrotf/subagent/discover-capability-profiles'
export const SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT =
  '@nothingrotf/subagent/register-capability-profiles'

interface BatchToolDetails {
  has_more: boolean
  items: readonly BatchItemResult[]
  runId: string
  status: 'batch'
  succeeded: boolean
  total: number
}

type OperationalCompletedDetails = Pick<
  RuntimeCompletedDetails,
  | 'agentId'
  | 'artifact'
  | 'durationMs'
  | 'effort'
  | 'fast'
  | 'finalMessage'
  | 'intercomUsage'
  | 'model'
  | 'role'
  | 'runId'
  | 'status'
  | 'taskId'
  | 'timing'
  | 'toolCallCount'
  | 'transcriptPath'
  | 'usage'
> & {
  attempt: number
  gateCount: number
  isolationStatus: string | null
  structuredOutputStatus: string | null
  toolReceiptCount: number
}

type OperationalFailedDetails = Pick<
  RuntimeFailedDetails,
  | 'agentId'
  | 'artifact'
  | 'attemptStarted'
  | 'error'
  | 'finalMessage'
  | 'model'
  | 'role'
  | 'runId'
  | 'status'
  | 'taskId'
  | 'timing'
> & {
  attempt: number
  gateCount: number
  isolationStatus: string | null
  structuredOutputStatus: string | null
}

type TaskToolDetails =
  | RuntimeBackgroundResult['details']
  | OperationalCompletedDetails
  | OperationalFailedDetails
  | BatchToolDetails
  | JobProgressDetails

const MAX_OPERATIONAL_BYTES = 8 * 1024
const MAX_OPERATIONAL_DETAILS_BYTES = 22 * 1024
const MAX_DETAIL_PREVIEW_BYTES = 2 * 1024

const TaskDetailSchema = Type.Object({
  description: Type.Optional(Type.String()),
  subagent_type: Type.Optional(Type.String()),
  role: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
})

function boundedText(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text)
  if (encoded.byteLength <= maxBytes) return text
  const suffix = '\n\n[Operational output truncated. Use TaskControl evidence for full content.]'
  const suffixBytes = Buffer.byteLength(suffix)
  let end = Math.max(0, maxBytes - suffixBytes)
  while (end > 0 && ((encoded[end] ?? 0) & 0xc0) === 0x80) end -= 1
  return `${new TextDecoder().decode(encoded.slice(0, end))}${suffix}`
}

function failedContent(result: RuntimeFailedResult): string {
  const agent = 'agentId' in result.details ? `\n\nAgent ID: ${result.details.agentId}` : ''
  return boundedText(`Task failed: ${result.details.error}${agent}`, MAX_OPERATIONAL_BYTES)
}

function completedDetails(details: RuntimeCompletedDetails): OperationalCompletedDetails {
  return {
    agentId: details.agentId,
    artifact: details.artifact,
    attempt: details.artifact.attempt,
    durationMs: details.durationMs,
    effort: details.effort,
    fast: details.fast,
    finalMessage: boundedText(details.finalMessage, MAX_DETAIL_PREVIEW_BYTES),
    gateCount: details.gateResults.length,
    intercomUsage: details.intercomUsage,
    isolationStatus: details.isolation?.integrationStatus ?? details.isolation?.status ?? null,
    model: details.model,
    role: details.role,
    runId: details.runId,
    status: details.status,
    structuredOutputStatus: details.structuredOutput?.status ?? null,
    taskId: details.taskId,
    timing: details.timing,
    toolCallCount: details.toolCallCount,
    toolReceiptCount: details.toolExecutionReceipts.length,
    transcriptPath: details.transcriptPath,
    usage: details.usage,
  }
}

function failedDetails(
  result: RuntimeFailedResult,
  runtime: SubagentRuntime,
): OperationalFailedDetails {
  const details = result.details
  const output: OperationalFailedDetails = {
    attempt: details.artifact?.attempt ?? runtime.getRecord(details.agentId)?.runGeneration ?? 1,
    attemptStarted: details.attemptStarted ?? true,
    error: details.error,
    gateCount: details.gateResults?.length ?? 0,
    isolationStatus: details.isolation?.integrationStatus ?? details.isolation?.status ?? null,
    status: details.status,
    structuredOutputStatus: details.structuredOutput?.status ?? null,
  }
  if (details.agentId !== undefined) output.agentId = details.agentId
  if (details.artifact !== undefined) output.artifact = details.artifact
  if (details.finalMessage !== undefined) {
    output.finalMessage = boundedText(details.finalMessage, MAX_DETAIL_PREVIEW_BYTES)
  }
  if (details.model !== undefined) output.model = details.model
  if (details.role !== undefined) output.role = details.role
  if (details.runId !== undefined) output.runId = details.runId
  if (details.taskId !== undefined) output.taskId = details.taskId
  if (details.timing !== undefined) output.timing = details.timing
  return output
}

function operationalItem(item: BatchItemResult): BatchItemResult {
  return {
    ...item,
    error: item.error === undefined ? undefined : boundedText(item.error, MAX_DETAIL_PREVIEW_BYTES),
    gateResults: [],
    isolation: undefined,
    output:
      item.output === undefined ? undefined : boundedText(item.output, MAX_DETAIL_PREVIEW_BYTES),
    structuredOutput: undefined,
  }
}

export function operationalBatchItems(items: readonly BatchItemResult[]): BatchItemResult[] {
  const operational = items.map(operationalItem)
  for (let index = operational.length - 1; index >= 0; index -= 1) {
    if (Buffer.byteLength(JSON.stringify(operational)) <= MAX_OPERATIONAL_DETAILS_BYTES) break
    const item = operational[index]
    if (item?.output !== undefined) operational[index] = { ...item, output: undefined }
  }
  for (let index = operational.length - 1; index >= 0; index -= 1) {
    if (Buffer.byteLength(JSON.stringify(operational)) <= MAX_OPERATIONAL_DETAILS_BYTES) break
    const item = operational[index]
    if (item?.error !== undefined) operational[index] = { ...item, error: undefined }
  }
  return operational
}

export function railTaskDetail(
  args: Static<typeof TaskInputSchema>,
  metadata?: { model?: string | undefined; role?: string | undefined },
): string {
  if ('tasks' in args) return args.tasks.map((task) => railTaskDetail(task)).join('; ')
  if (!Value.Check(TaskDetailSchema, args)) return ''
  const identity = taskRoleLabel(metadata?.role ?? args.role, metadata?.model ?? args.model)
  return [identity, args.description ?? args.subagent_type ?? ''].filter(Boolean).join(' · ')
}

export function registerSubagent(pi: ExtensionAPI, runTimeoutMs?: number): SubagentRuntime {
  const host = acquireSubagentHost(pi, runTimeoutMs)
  const runtime = host.runtime
  const rail = new RailBridge(pi, ['Task'])
  if (host.registered) return runtime
  host.registered = true
  const tui = new SubagentTui(runtime)
  const agentRegistrations = new Map<string, () => void>()
  const capabilityProfileSources = new Set<string>()
  const unregisterCapabilityEvents = pi.events.on(
    SUBAGENT_CAPABILITY_REGISTRATION_EVENT,
    (value) => {
      const publication = decodeCapabilityPublication(value)
      if (publication === undefined) return
      runtime.publishCapabilities(publication)
    },
  )
  const unregisterAgentEvents = pi.events.on(SUBAGENT_REGISTRATION_EVENT, (value) => {
    const registration = decodeSubagentRegistration(value)
    if (registration === undefined) return
    agentRegistrations.get(registration.sourceId)?.()
    agentRegistrations.set(
      registration.sourceId,
      host.registerAgents(registration.sourceId, registration.definitions),
    )
  })
  const unregisterCapabilityProfileEvents = pi.events.on(
    SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT,
    (value) => {
      const registration = decodeCapabilityProfileRegistration(value)
      if (registration === undefined || capabilityProfileSources.has(registration.sourceId)) return
      runtime.registerCapabilityProfiles(registration.profiles)
      capabilityProfileSources.add(registration.sourceId)
    },
  )
  pi.events.emit(SUBAGENT_CAPABILITY_DISCOVERY_EVENT, { version: 1 })
  pi.events.emit(SUBAGENT_DISCOVERY_EVENT, { version: 1 })
  pi.events.emit(SUBAGENT_CAPABILITY_PROFILE_DISCOVERY_EVENT, { version: 1 })

  pi.on('context', (event, ctx) => {
    runtime.deliveries.ensureOwner(ctx)
    return {
      messages: runtime.deliveries.context(event.messages, (record) =>
        runtime.isCurrentDelivery(record),
      ),
    }
  })
  pi.on('session_before_compact', () => runtime.deliveries.pause())
  pi.on('session_compact', (_event, ctx) => {
    runtime.deliveries.compact()
    runtime.deliveries.resumeWhenIdle(ctx)
  })
  pi.on('session_compact_failed', (_event, ctx) => runtime.deliveries.resumeWhenIdle(ctx))

  pi.on('agent_start', (_event, ctx) => {
    tui.agentStart(ctx)
  })
  pi.on('session_start', async (_event, ctx) => {
    if (await host.replaceSession(ctx)) tui.sessionStart(ctx)
  })
  pi.on('session_before_switch', async (_event, ctx) => {
    if (await host.stopSession(ctx, 'The parent session switched.')) tui.sessionShutdown(ctx)
  })
  pi.on('session_before_fork', async (_event, ctx) => {
    if (await host.stopSession(ctx, 'The parent session forked.')) tui.sessionShutdown(ctx)
  })
  pi.on('session_before_tree', async (_event, ctx) => {
    if (await host.stopSession(ctx, 'The parent session tree changed.')) tui.sessionShutdown(ctx)
  })
  pi.on('session_tree', async (_event, ctx) => {
    if (await host.replaceSession(ctx)) tui.sessionStart(ctx)
  })
  pi.on('session_shutdown', async (_event, ctx) => {
    runtime.deliveries.pause()
    unregisterAgentEvents()
    unregisterCapabilityEvents()
    unregisterCapabilityProfileEvents()
    for (const unregister of agentRegistrations.values()) unregister()
    agentRegistrations.clear()
    if (await host.stopSession(ctx)) tui.sessionShutdown(ctx)
  })

  pi.registerMessageRenderer('subagent-intercom', (message, options, theme) => {
    const details = decodeIntercomDetails(message.details)
    if (details === undefined) return undefined
    const snapshot = runtime.listSnapshots().find((entry) => entry.agentId === details.agentId)
    const label = snapshot?.description ?? details.agentId
    let cached: { key: string; lines: string[] } | undefined
    return {
      invalidate() {
        cached = undefined
      },
      render(width) {
        const framed = rail.active
        const now = Date.now()
        const delivery =
          details.deliveryId === undefined ? undefined : runtime.deliveries.get(details.deliveryId)
        const key = [
          width,
          framed ? 'framed' : 'native',
          options.expanded ? 'expanded' : 'collapsed',
          intercomTimingKey(intercomTiming(details, message.timestamp, { delivery, now })),
        ].join('\u001f')
        if (cached?.key === key) return cached.lines
        const layout = framed ? transcriptIntercomLayout(width) : nativeIntercomLayout(width)
        const lines = new Text(
          renderIntercomCard(
            details,
            label,
            message.timestamp,
            {
              expanded: options.expanded,
              now,
              model: snapshot?.model,
              role: snapshot?.role,
              layout,
              delivery,
            },
            theme,
          ).join('\n'),
          framed ? 0 : 1,
          0,
        ).render(width)
        cached = { key, lines }
        return lines
      },
    }
  })

  pi.registerCommand('subagents', {
    description: 'List subagents. Use `/subagents peek` to open the browsable pane.',
    handler: async (args, ctx) => {
      if (
        String(args ?? '')
          .trim()
          .toLowerCase() === 'peek'
      )
        await tui.openPeek(ctx)
      else tui.list(ctx)
    },
  })

  pi.registerCommand('subagent-peek', {
    description: 'Open the browsable subagent pane.',
    handler: async (_args, ctx) => tui.openPeek(ctx),
  })

  pi.registerShortcut('ctrl+shift+a', {
    description: 'Peek at running subagents',
    handler: async (ctx) => tui.openPeek(ctx),
  })

  registerTaskControl(pi, host, runtime)

  pi.registerTool<typeof TaskInputSchema, TaskToolDetails, TaskRenderState>({
    description:
      'Run a subagent with a persistent transcript. Use resume with the returned Agent ID to continue it. Optional role is an explicit task-purpose label preserved on resume. A selected capability profile may require an exact role and provide its default model. Explicit model overrides take precedence over valid capability policy. Foreground is the default unless the selected agent defines background mode.',
    execute: async (callId, input, signal, onUpdate, ctx) => {
      const progress = new JobProgress(
        runtime,
        { events: pi.events, hasUI: ctx.hasUI, ui: ctx.ui },
        onUpdate,
      )
      const children = new RailChildReporter(rail, runtime, callId)
      const onStarted = (agentId: string) => {
        progress.started(agentId)
        children.started(agentId)
      }
      try {
        return await executeTask(runtime, input, signal, ctx, onStarted)
      } finally {
        children.stop()
        progress.stop()
      }
    },
    executionMode: 'parallel',
    label: 'Task',
    name: 'Task',
    parameters: TaskInputSchema,
    renderShell: 'self',
    renderCall(args, theme, context) {
      if (rail.active) {
        rail.report({
          detail: railTaskDetail(
            args,
            'resume' in args ? runtime.getRecord(args.resume) : undefined,
          ),
          doneLabel: 'Dispatched',
          runningLabel: 'Dispatching',
          status: 'pending',
          toolCallId: context.toolCallId,
          iconKey: 'agent',
          toolName: 'Task',
        })
        return emptyRailComponent
      }
      return new TaskCall(args, theme, context.state)
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details
      if (rail.active) {
        const status: RailStatus = context.isError ? 'error' : isPartial ? 'pending' : 'ok'
        rail.report({
          detail:
            details?.status === 'progress'
              ? details.jobs
                  .map((job) =>
                    [taskRoleLabel(job.role, job.model), job.description]
                      .filter(Boolean)
                      .join(' · '),
                  )
                  .join('; ')
              : details?.status === 'batch'
                ? details.items
                    .map((item) =>
                      [taskRoleLabel(item.role, item.model), item.taskId]
                        .filter(Boolean)
                        .join(' · '),
                    )
                    .join('; ')
                : railTaskDetail(context.args, details),
          doneLabel: 'Dispatched',
          output: railOutputText(result.content),
          runningLabel: 'Dispatching',
          status,
          toolCallId: context.toolCallId,
          iconKey: 'agent',
          toolName: 'Task',
        })
        return emptyRailComponent
      }
      if (details === undefined) {
        const text = result.content.find((content) => content.type === 'text')?.text ?? ''
        return plainText(theme.fg('dim', text))
      }
      context.state.hasResult = true
      const options = { expanded, live: isPartial }
      if (details.status === 'progress') {
        return new TaskResult(
          details.jobs.map((job) => rowFromJob(job, false)),
          options,
          theme,
        )
      }
      if (details.status === 'batch') {
        const snapshots = new Map<string, JobSnapshot>()
        const now = Date.now()
        for (const snapshot of runtime.listSnapshots()) {
          snapshots.set(snapshot.agentId, toJobSnapshot(snapshot, now))
        }
        const rows = details.items.map((item) =>
          rowFromBatchItem(
            item,
            item.agentId === undefined ? undefined : snapshots.get(item.agentId),
            'task',
          ),
        )
        const duration = rows.reduce((max, row) => Math.max(max, row.durationMs ?? 0), 0)
        return new TaskResult(rows, options, theme, summaryLine(rows, duration, theme))
      }
      const label =
        'description' in context.args ? context.args.description : (details.agentId ?? '')
      const agentType = 'subagent_type' in context.args ? context.args.subagent_type : 'task'
      if (details.status === 'background') {
        const snapshot = runtime.listSnapshots().find((entry) => entry.agentId === details.agentId)
        const row =
          snapshot === undefined
            ? {
                activity: undefined,
                agentType,
                background: true,
                context: undefined,
                cost: 0,
                durationMs: undefined,
                error: undefined,
                label,
                model: details.model,
                role: details.role,
                output: undefined,
                status: 'pending' as const,
                task: undefined,
                toolCalls: 0,
              }
            : rowFromJob(toJobSnapshot(snapshot, Date.now()), true)
        return new TaskResult([row], options, theme)
      }
      if (details.status === 'error') {
        const aborted = result.content.some(
          (content) => content.type === 'text' && content.text.includes('aborted'),
        )
        return new TaskResult([rowFromFailed(details, label, agentType, aborted)], options, theme)
      }
      return new TaskResult([rowFromCompleted(details, label, agentType)], options, theme)
    },
  })

  return runtime
}

async function executeTask(
  runtime: SubagentRuntime,
  input: Static<typeof TaskInputSchema>,
  signal: AbortSignal | undefined,
  ctx: ExtensionContext,
  onStarted: (agentId: string) => void,
): Promise<AgentToolResult<TaskToolDetails>> {
  if ('tasks' in input) {
    const decoded = decodeBatchTaskInput(input)
    const batch = await runBatch({
      ctx,
      input: decoded,
      onStarted,
      runtime,
      signal,
    })
    const items = operationalBatchItems(batch.items)
    return {
      content: [
        {
          text: boundedText(`Run ID: ${batch.runId}\n\n${batch.content}`, MAX_OPERATIONAL_BYTES),
          type: 'text',
        },
      ],
      details: {
        has_more: items.some(
          (item, index) =>
            item.output !== batch.items[index]?.output || item.error !== batch.items[index]?.error,
        ),
        items,
        runId: batch.runId,
        status: 'batch',
        succeeded: batch.status === 'completed',
        total: batch.items.length,
      },
    }
  }
  const decoded = decodeSingleTaskInput(input)
  const result = await runtime.run({ ctx, input: decoded, onStarted, signal })

  if (result.kind === 'background') {
    return {
      content: [
        {
          text: `Task started in the background.\nAgent ID: ${result.details.agentId}`,
          type: 'text',
        },
      ],
      details: result.details,
    }
  }

  if (result.kind === 'failed') {
    return {
      content: [{ text: failedContent(result), type: 'text' }],
      details: failedDetails(result, runtime),
    }
  }

  return {
    content: [
      {
        text: boundedText(
          `Agent ID: ${result.details.agentId}\n\n${result.content}`,
          MAX_OPERATIONAL_BYTES,
        ),
        type: 'text',
      },
    ],
    details: completedDetails(result.details),
  }
}

export { acquireSubagentController } from './controller.ts'
export { captureWorkspaceSnapshot } from './git-isolation.ts'
export { latestState as readSubagentState } from './state.ts'
export { TaskControlInputSchema } from './control.ts'
export type { TaskControlDetails, TaskControlInput } from './control.ts'
export type { AgentSource, SubagentDefinition } from './agents.ts'
export type {
  CapabilityModelPolicy,
  RoleModelPolicyEntry,
  CapabilityProfile,
  CapabilityPublication,
  CapabilityRegistration,
  CapabilityToolDefinition,
  RoleToolRequirement,
  TerminalValidationInput,
  TerminalValidationPolicy,
  TerminalValidationResult,
} from './capabilities.ts'
export type { BatchItemResult, BatchResult } from './coordinator.ts'
export type {
  CancelReceipt,
  SteerReceipt,
  SubagentController,
  SubagentEvent,
  SubagentHandle,
  SubagentInvocation,
  SubagentResult,
  SubagentSnapshot,
  TaskReceipt,
} from './runtime.ts'
export type {
  ArtifactRef,
  BatchTaskInput,
  CapabilityContract,
  CoordinationRunState,
  DeliveryBinding,
  ExecutionContractV4,
  ExecutionContractV5,
  GateDefinition,
  GateResult,
  IsolationChangedFile,
  IsolationIntegration,
  IsolationPatchRef,
  IsolationReceipt,
  IsolationRepositoryReceipt,
  IsolationRequest,
  JsonValue,
  RunRecord,
  StructuredOutput,
  TaskInput,
  TaskNodeInput,
  ToolExecutionReceipt,
  TerminalOutputRevision,
  WorkspaceIdentity,
  WorkspaceSnapshot,
  WorkspaceSnapshotRepository,
} from './schema.ts'
export { decodeJsonValue, isJsonObject } from './schema.ts'
export { jsonEquals, resolveStructuredOutput, validateOutputSchema } from './output.ts'
export { recoverIsolations } from './isolation.ts'
export type { IsolationRecovery } from './isolation.ts'

export default function subagentExtension(pi: ExtensionAPI): void {
  registerSubagent(pi)
}
