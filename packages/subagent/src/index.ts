import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import { decodeSubagentRegistration } from './agents.ts'
import { decodeCapabilityProfileRegistration } from './capabilities.ts'
import { registerTaskControl } from './control.ts'
import { acquireSubagentHost } from './controller.ts'
import { runBatch, type BatchItemResult } from './coordinator.ts'
import { type JobProgressDetails, type JobSnapshot, toJobSnapshot } from './jobs.ts'
import { JobProgress } from './progress.ts'
import { type RuntimeDetails, type RuntimeFailedResult, type SubagentRuntime } from './runtime.ts'
import { BatchTaskInputSchema, SingleTaskInputSchema, TaskInputSchema } from './schema.ts'
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
export const SUBAGENT_CAPABILITY_PROFILE_DISCOVERY_EVENT =
  '@nothingrotf/subagent/discover-capability-profiles'
export const SUBAGENT_CAPABILITY_PROFILE_REGISTRATION_EVENT =
  '@nothingrotf/subagent/register-capability-profiles'

interface BatchToolDetails {
  items: readonly BatchItemResult[]
  runId: string
  status: 'batch'
  succeeded: boolean
}

type TaskToolDetails = RuntimeDetails | BatchToolDetails | JobProgressDetails

function failedContent(result: RuntimeFailedResult): string {
  const agent = 'agentId' in result.details ? `\n\nAgent ID: ${result.details.agentId}` : ''
  return `Task failed: ${result.details.error}${agent}`
}

export function registerSubagent(pi: ExtensionAPI, runTimeoutMs?: number): SubagentRuntime {
  const host = acquireSubagentHost(pi, runTimeoutMs)
  const runtime = host.runtime
  if (host.registered) return runtime
  host.registered = true
  const tui = new SubagentTui(runtime)
  const agentRegistrations = new Map<string, () => void>()
  const capabilityProfileSources = new Set<string>()
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
  pi.events.emit(SUBAGENT_DISCOVERY_EVENT, { version: 1 })
  pi.events.emit(SUBAGENT_CAPABILITY_PROFILE_DISCOVERY_EVENT, { version: 1 })

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
    unregisterAgentEvents()
    unregisterCapabilityProfileEvents()
    for (const unregister of agentRegistrations.values()) unregister()
    agentRegistrations.clear()
    if (await host.stopSession(ctx)) tui.sessionShutdown(ctx)
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
      'Run a subagent with a persistent transcript. Use resume with the returned Agent ID to continue it. Foreground is the default unless the selected agent defines background mode.',
    execute: async (_callId, input, signal, onUpdate, ctx) => {
      const progress = new JobProgress(
        runtime,
        { events: pi.events, hasUI: ctx.hasUI, ui: ctx.ui },
        onUpdate,
      )
      try {
        return await executeTask(runtime, input, signal, ctx, progress)
      } finally {
        progress.stop()
      }
    },
    executionMode: 'parallel',
    label: 'Task',
    name: 'Task',
    parameters: TaskInputSchema,
    renderCall(args, theme, context) {
      return new TaskCall(args, theme, context.state)
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const details = result.details
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
  progress: JobProgress,
): Promise<AgentToolResult<TaskToolDetails>> {
  if ('tasks' in input) {
    const decoded = Value.Decode(BatchTaskInputSchema, input)
    const batch = await runBatch({
      ctx,
      input: decoded,
      onStarted: progress.started,
      runtime,
      signal,
    })
    return {
      content: [{ text: `Run ID: ${batch.runId}\n\n${batch.content}`, type: 'text' }],
      details: {
        items: batch.items,
        runId: batch.runId,
        status: 'batch',
        succeeded: batch.status === 'completed',
      },
    }
  }
  const decoded = Value.Decode(SingleTaskInputSchema, input)
  const result = await runtime.run({ ctx, input: decoded, onStarted: progress.started, signal })

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
      details: result.details,
    }
  }

  return {
    content: [{ text: `Agent ID: ${result.details.agentId}\n\n${result.content}`, type: 'text' }],
    details: result.details,
  }
}

export { acquireSubagentController } from './controller.ts'
export { TaskControlInputSchema } from './control.ts'
export type { TaskControlDetails, TaskControlInput } from './control.ts'
export type { AgentSource, SubagentDefinition } from './agents.ts'
export type {
  CapabilityProfile,
  CapabilityRegistration,
  CapabilityToolDefinition,
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
  GateDefinition,
  GateResult,
  IsolationChangedFile,
  IsolationIntegration,
  IsolationPatchRef,
  IsolationReceipt,
  IsolationRepositoryReceipt,
  IsolationRequest,
  StructuredOutput,
  TaskInput,
  TaskNodeInput,
} from './schema.ts'
export { recoverIsolations } from './isolation.ts'
export type { IsolationRecovery } from './isolation.ts'

export default function subagentExtension(pi: ExtensionAPI): void {
  registerSubagent(pi)
}
