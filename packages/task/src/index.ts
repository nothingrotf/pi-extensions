import { randomUUID } from 'node:crypto'

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import {
  backgroundText,
  completedText,
  decodeTaskState,
  errorDetails,
  type PendingTask,
  resolveAgentName,
  resolveModel,
  type TaskAgent,
  type TaskCompletedDetails,
  type TaskDetails,
  type TaskInput,
  TaskSchema,
  validateTaskInput,
} from './domain.ts'
import {
  asyncCompleteEvent,
  completionOutcome,
  completionRunId,
  type CompletionOutcome,
  decodeAsyncCompletion,
  decodeRpcLaunch,
  delegateForeground,
  type DelegationUpdate,
  rpcRequest,
  waitForCompletion,
} from './transport.ts'

export {
  type PendingTask,
  type TaskDetails,
  TaskDetailsSchema,
  type TaskInput,
  TaskSchema,
} from './domain.ts'

const stateEntryType = 'pi-task-state'
const notificationType = 'system/task_notification'
const readonlyAgentName = 'task-readonly'

const description = `Delegate a task to an isolated child agent through pi-subagents.

Use a concise description and a complete prompt. Use subagent_type for a built-in role or a configured pi-subagents agent. Set run_in_background to true only when the parent can continue without the result. Use resume with a prior Agent ID to continue that child.`

type RuntimeAgentRegistration = { dispose(): void }
type CompletedCore = Pick<
  TaskCompletedDetails,
  'status' | 'agentId' | 'finalMessage' | 'toolCallCount' | 'durationMs' | 'runId'
>
type TaskToolResult = {
  content: Array<{ type: 'text'; text: string }>
  details: TaskDetails
  isError?: true
}

type RuntimeAgentRegistrationResult =
  | { ok: true; registration: RuntimeAgentRegistration }
  | { ok: false; error: Error }

interface RuntimeAgentRequest {
  version: 1
  name: string
  definition: {
    description: string
    systemPrompt: string
    tools: readonly string[]
  }
  result?: RuntimeAgentRegistrationResult
}

function taskError(error: string, agentId?: string): TaskToolResult {
  const details = errorDetails(error, agentId)
  return {
    content: [{ type: 'text', text: `Task error: ${error}` }],
    details,
    isError: true,
  }
}

function ownerRunId(ctx: ExtensionContext): string {
  return `Task:${ctx.sessionManager.getSessionId()}`.slice(0, 256)
}

function nodeId(toolCallId: string): string {
  return toolCallId.slice(0, 256)
}

function progressText(update: DelegationUpdate): string {
  if (update.currentTool !== undefined) {
    return `Task child uses ${update.currentTool}.`
  }
  if (update.recentOutput !== undefined) {
    return update.recentOutput
  }
  return 'Task child is active.'
}

function foregroundDetails(
  agentId: string,
  finalMessage: string,
  toolCallCount: number,
  durationMs: number,
  model: string | undefined,
  usage: TaskCompletedDetails['usage'],
): TaskCompletedDetails {
  const base: CompletedCore = {
    status: 'completed',
    agentId,
    finalMessage,
    toolCallCount,
    durationMs,
    runId: agentId,
  }
  if (model !== undefined && usage !== undefined) {
    return { ...base, model, usage }
  }
  if (model !== undefined) {
    return { ...base, model }
  }
  if (usage !== undefined) {
    return { ...base, usage }
  }
  return base
}

function resumedDetails(
  agentId: string,
  finalMessage: string,
  toolCallCount: number,
  durationMs: number,
  model: string | undefined,
  transcriptPath: string | undefined,
): TaskCompletedDetails {
  const base: CompletedCore = {
    status: 'completed',
    agentId,
    finalMessage,
    toolCallCount,
    durationMs,
    runId: agentId,
  }
  if (model !== undefined && transcriptPath !== undefined) {
    return { ...base, model, transcriptPath }
  }
  if (model !== undefined) {
    return { ...base, model }
  }
  if (transcriptPath !== undefined) {
    return { ...base, transcriptPath }
  }
  return base
}

function errorMessage<Input>(error: Input): string {
  return error instanceof Error ? error.message : String(error)
}

function resumeErrorMessage<Input>(error: Input): string {
  const message = errorMessage(error)
  if (/\b(running|live|active)\b/i.test(message)) {
    return 'Sub-agent is currently running. You may send the follow-up message when it has completed.'
  }
  return message
}

export default function task(pi: ExtensionAPI): void {
  let pendingTasks: PendingTask[] = []
  let taskAgents: TaskAgent[] = []
  const taskRunIds = new Set<string>()
  const completedRuns = new Map<string, CompletionOutcome>()
  let readonlyRegistration: RuntimeAgentRegistration | undefined
  let readonlyRegistrationError: string | undefined

  const persist = () => {
    pi.appendEntry(stateEntryType, { version: 1, pending: pendingTasks, agents: taskAgents })
  }

  const rememberAgent = (agentId: string, readonly: boolean, subagentType: string) => {
    const agent: TaskAgent = { agentId, readonly, subagentType }
    taskAgents = [...taskAgents.filter((candidate) => candidate.agentId !== agentId), agent]
  }

  const trimCompletedRuns = () => {
    if (completedRuns.size <= 256) {
      return
    }
    for (const runId of completedRuns.keys()) {
      if (completedRuns.size <= 256) {
        return
      }
      if (!taskRunIds.has(runId)) {
        completedRuns.delete(runId)
      }
    }
  }

  const restore = (ctx: ExtensionContext) => {
    pendingTasks = []
    taskAgents = []
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom' || entry.customType !== stateEntryType) {
        continue
      }
      const state = decodeTaskState(entry.data)
      if (state !== null) {
        pendingTasks = state.pending
        taskAgents = state.agents ?? []
      }
    }
    for (const pending of pendingTasks) {
      taskRunIds.add(pending.completionRunId)
      const outcome = completedRuns.get(pending.completionRunId)
      if (outcome !== undefined) {
        finalizePending(pending.completionRunId, outcome)
      }
    }
  }

  const registerReadonlyAgent = () => {
    readonlyRegistration?.dispose()
    readonlyRegistration = undefined
    readonlyRegistrationError = undefined
    const request: RuntimeAgentRequest = {
      version: 1,
      name: readonlyAgentName,
      definition: {
        description: 'A read-only child for Task compatibility.',
        systemPrompt:
          'You are a read-only task agent. Read and analyze the workspace. Do not modify files or external state. Return the requested result.',
        tools: ['read', 'grep', 'find', 'ls'],
      },
    }
    pi.events.emit('pi-subagents:runtime-agent-register:v1', request)
    if (request.result?.ok === true) {
      readonlyRegistration = request.result.registration
      return
    }
    readonlyRegistrationError =
      request.result?.ok === false
        ? request.result.error.message
        : 'pi-subagents did not register the read-only Task agent.'
  }

  const finalizePending = (runId: string, outcome: CompletionOutcome) => {
    const pending = pendingTasks.find((task) => task.completionRunId === runId)
    if (pending === undefined) {
      return
    }
    const status =
      outcome.kind === 'completed' ? 'success' : outcome.kind === 'aborted' ? 'aborted' : 'error'
    const detail = outcome.kind === 'completed' ? outcome.finalMessage : outcome.error
    const notification = {
      taskId: pending.agentId,
      kind: 'subagent',
      status,
      title: pending.description,
      detail,
    }
    pi.sendMessage(
      {
        customType: notificationType,
        content: `Task notification: ${JSON.stringify(notification)}`,
        display: false,
        details: notification,
      },
      { triggerTurn: false, deliverAs: 'steer' },
    )
    completedRuns.delete(runId)
    taskRunIds.delete(runId)
    pendingTasks = pendingTasks.filter((task) => task.completionRunId !== runId)
    persist()
  }

  const rememberBackground = (completionRunIdValue: string, agentId: string, input: TaskInput) => {
    const next: PendingTask = {
      completionRunId: completionRunIdValue,
      agentId,
      description: input.description.trim(),
      subagentType: input.subagent_type.trim(),
      startedAt: Date.now(),
    }
    pendingTasks = [
      ...pendingTasks.filter((task) => task.completionRunId !== completionRunIdValue),
      next,
    ]
    taskRunIds.add(completionRunIdValue)
    rememberAgent(agentId, input.readonly === true, input.subagent_type.trim())
    persist()
    const completed = completedRuns.get(completionRunIdValue)
    if (completed !== undefined) {
      finalizePending(completionRunIdValue, completed)
    }
  }

  const backgroundResult = (
    completionRunIdValue: string,
    agentId: string,
    input: TaskInput,
  ): TaskToolResult => {
    rememberBackground(completionRunIdValue, agentId, input)
    const details: TaskDetails = {
      status: 'background',
      agentId,
      runId: completionRunIdValue,
      backgroundReason: 'agent_request',
    }
    return { content: [{ type: 'text', text: backgroundText(agentId) }], details }
  }

  pi.on('session_start', (_event, ctx) => {
    restore(ctx)
    registerReadonlyAgent()
  })

  pi.on('session_tree', (_event, ctx) => {
    restore(ctx)
  })

  pi.on('session_shutdown', () => {
    readonlyRegistration?.dispose()
    readonlyRegistration = undefined
  })

  pi.events.on(asyncCompleteEvent, (data) => {
    const completion = decodeAsyncCompletion(data)
    if (completion === null) {
      return
    }
    const runId = completionRunId(completion)
    if (runId === undefined) {
      return
    }
    const outcome = completionOutcome(completion)
    if (outcome === null) {
      return
    }
    completedRuns.delete(runId)
    completedRuns.set(runId, outcome)
    trimCompletedRuns()
    finalizePending(runId, outcome)
  })

  pi.registerTool({
    name: 'Task',
    label: 'Task',
    description,
    promptSnippet: 'Delegate isolated foreground or background work to a child agent',
    promptGuidelines: [
      'Use Task for work that benefits from an isolated child context.',
      'Use one Task call per independent child so Pi can execute calls in parallel.',
      'Use resume with the Agent ID from a prior Task result.',
      'Use readonly only for work that requires no state changes.',
    ],
    parameters: TaskSchema,
    executionMode: 'parallel',
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const validation = validateTaskInput(params)
      if (validation.kind === 'invalid') {
        return taskError(validation.error, params.resume)
      }

      if (params.resume !== undefined && params.readonly === true) {
        const retainedAgent = taskAgents.find((agent) => agent.agentId === params.resume)
        if (retainedAgent?.readonly !== true) {
          return taskError(
            'Task cannot enforce read-only mode for this retained child. Resume it without readonly or start a new read-only task.',
            params.resume,
          )
        }
      }

      if (params.resume !== undefined) {
        try {
          await rpcRequest(pi.events, 'ping', {}, 1_000)
          const launchValue = await rpcRequest(pi.events, 'resume', {
            id: params.resume,
            message: params.prompt,
          })
          const launch = decodeRpcLaunch(launchValue)
          if (launch === null) {
            return taskError('pi-subagents returned an invalid resume receipt.', params.resume)
          }
          if (params.run_in_background === true) {
            return backgroundResult(launch.runId, params.resume, params)
          }
          const cachedOutcome = completedRuns.get(launch.runId)
          const outcome =
            cachedOutcome ??
            (await waitForCompletion(pi.events, launch.runId, signal, () =>
              rpcRequest(pi.events, 'stop', { id: launch.runId }),
            ))
          completedRuns.delete(launch.runId)
          if (outcome.kind !== 'completed') {
            return taskError(outcome.error, params.resume)
          }
          const details = resumedDetails(
            params.resume,
            outcome.finalMessage,
            outcome.toolCallCount,
            outcome.durationMs,
            outcome.model,
            outcome.transcriptPath,
          )
          return { content: [{ type: 'text', text: completedText(details) }], details }
        } catch (error) {
          return taskError(resumeErrorMessage(error), params.resume)
        }
      }

      const isReadonly = params.readonly === true
      if (isReadonly && readonlyRegistration === undefined) {
        return taskError(readonlyRegistrationError ?? 'The read-only Task agent is not available.')
      }
      const agent = resolveAgentName(params.subagent_type, isReadonly)
      const model = resolveModel(params.model)

      if (params.run_in_background === true) {
        try {
          await rpcRequest(pi.events, 'ping', {}, 1_000)
          const spawnParams = {
            agent,
            task: params.prompt,
            context: 'fresh',
            cwd: ctx.cwd,
            async: true,
          }
          const launchValue = await rpcRequest(
            pi.events,
            'spawn',
            model === undefined ? spawnParams : { ...spawnParams, model },
          )
          const launch = decodeRpcLaunch(launchValue)
          if (launch === null) {
            return taskError('pi-subagents returned an invalid background receipt.')
          }
          return backgroundResult(launch.runId, launch.runId, params)
        } catch (error) {
          return taskError(errorMessage(error))
        }
      }

      const requestBase = {
        requestId: randomUUID(),
        ownerRunId: ownerRunId(ctx),
        nodeId: nodeId(toolCallId),
        agent,
        task: params.prompt,
        cwd: ctx.cwd,
      }
      const request = model === undefined ? requestBase : { ...requestBase, model }
      const outcome = await delegateForeground(pi.events, request, signal, (update) => {
        const progressRunId = update.runId ?? toolCallId
        onUpdate?.({
          content: [{ type: 'text', text: progressText(update) }],
          details: {
            status: 'background',
            agentId: progressRunId,
            runId: progressRunId,
            backgroundReason: 'agent_request',
          },
        })
      })
      if (outcome.kind === 'error') {
        return taskError(outcome.error, outcome.runId)
      }
      const details = foregroundDetails(
        outcome.runId,
        outcome.finalMessage,
        outcome.usage?.toolCalls ?? 0,
        outcome.usage?.durationMs ?? 0,
        outcome.model,
        outcome.usage,
      )
      rememberAgent(outcome.runId, isReadonly, params.subagent_type.trim())
      persist()
      return { content: [{ type: 'text', text: completedText(details) }], details }
    },
  })
}
