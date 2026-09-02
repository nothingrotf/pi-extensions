import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Value } from 'typebox/value'

import { decodeSubagentRegistration } from './agents.ts'
import { decodeCapabilityProfileRegistration } from './capabilities.ts'
import { registerTaskControl } from './control.ts'
import { acquireSubagentHost } from './controller.ts'
import { runBatch, type BatchItemResult } from './coordinator.ts'
import { formatUsage, oneLineLabel, statusIcon } from './format.ts'
import { type RuntimeDetails, type RuntimeFailedResult, type SubagentRuntime } from './runtime.ts'
import { BatchTaskInputSchema, SingleTaskInputSchema, TaskInputSchema } from './schema.ts'
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

type TaskToolDetails = RuntimeDetails | BatchToolDetails

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

  pi.registerTool<typeof TaskInputSchema, TaskToolDetails>({
    description:
      'Run a subagent with a persistent transcript. Use resume with the returned Agent ID to continue it. Foreground is the default unless the selected agent defines background mode.',
    execute: async (_callId, input, signal, _onUpdate, ctx) => {
      if ('tasks' in input) {
        const decoded = Value.Decode(BatchTaskInputSchema, input)
        const batch = await runBatch({ ctx, input: decoded, runtime, signal })
        return {
          content: [{ text: `Run ID: ${batch.runId}\n\n${batch.content}`, type: 'text' }],
          details: {
            items: batch.items,
            runId: batch.runId,
            status: 'batch',
            succeeded: batch.status === 'completed',
          },
          isError: batch.status !== 'completed',
        }
      }
      const decoded = Value.Decode(SingleTaskInputSchema, input)
      const result = await runtime.run({ ctx, input: decoded, signal })

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
          isError: true,
        }
      }

      return {
        content: [
          { text: `Agent ID: ${result.details.agentId}\n\n${result.content}`, type: 'text' },
        ],
        details: result.details,
      }
    },
    executionMode: 'parallel',
    label: 'Task',
    name: 'Task',
    parameters: TaskInputSchema,
    renderCall(args, theme) {
      if ('tasks' in args) {
        return new Text(
          `${theme.fg('toolTitle', theme.bold('Task'))} ${theme.fg('accent', `${args.tasks.length} tasks`)} ${theme.fg('muted', '[fg]')}`,
          0,
          0,
        )
      }
      const mode =
        args.run_in_background === undefined ? 'auto' : args.run_in_background ? 'bg' : 'fg'
      const parts = [args.model, args.readonly === true ? 'read-only' : undefined].filter(
        (part) => part !== undefined,
      )
      const metadata = parts.length === 0 ? '' : `\n  ${theme.fg('dim', parts.join(' · '))}`
      return new Text(
        `${theme.fg('toolTitle', theme.bold('Task'))} ${theme.fg('accent', args.subagent_type)} ${theme.fg('muted', `[${mode}]`)}${metadata}\n  ${theme.fg('dim', oneLineLabel(args.description))}`,
        0,
        0,
      )
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details
      if (details === undefined) {
        const text = result.content.find((content) => content.type === 'text')?.text ?? ''
        return new Text(text, 0, 0)
      }
      if (details.status === 'batch') {
        const summary = details.items
          .map(
            (item) => `${item.status === 'completed' ? '✓' : '✗'} ${item.taskId}: ${item.status}`,
          )
          .join('\n')
        return new Text(`${theme.fg('accent', details.runId)}\n${summary}`, 0, 0)
      }
      if (details.status === 'background') {
        return new Text(
          `• ${theme.fg('accent', 'running')} ${theme.fg('muted', details.agentId)}`,
          0,
          0,
        )
      }
      if (details.status === 'error') {
        const id = 'agentId' in details ? ` ${theme.fg('muted', details.agentId)}` : ''
        return new Text(`✗ ${theme.fg('error', details.error)}${id}`, 0, 0)
      }
      const usage = formatUsage(details.usage)
      const intercomUsage = formatUsage(details.intercomUsage)
      const usageLines = [
        usage,
        intercomUsage.length > 0 ? `parent ↔ ${intercomUsage}` : undefined,
      ].filter((line) => line !== undefined && line.length > 0)
      const header = `${statusIcon(details.status)} ${theme.fg('accent', details.agentId)}`
      if (!expanded) {
        return new Text(
          usageLines.length === 0 ? header : `${header}\n${theme.fg('dim', usageLines.join('\n'))}`,
          0,
          0,
        )
      }
      return new Text(
        [header, theme.fg('dim', details.finalMessage), theme.fg('dim', usageLines.join('\n'))]
          .filter((line) => line.length > 0)
          .join('\n'),
        0,
        0,
      )
    },
  })

  return runtime
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
