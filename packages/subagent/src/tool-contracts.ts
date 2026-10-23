import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import { Value } from 'typebox/value'

export const taskToolGuidelines = [
  'Codemode may call Task only for a single dispatch with explicit run_in_background: true. Return the Agent ID to the coordinator.',
  'Call Task directly for foreground execution. run_in_background belongs only to a single Task, never a graph node or batch wrapper.',
]

export const taskControlToolGuidelines = [
  'Codemode may call TaskControl for non-wait actions within the existing Task scope. Call TaskControl wait directly as the only tool call.',
]

const batchRecovery =
  'Task argument recovery: use a complete single-Task object. Root Task also accepts { tasks: [{ id, description, prompt, subagent_type }], context? }; nested Task does not accept graphs. run_in_background belongs only to a single Task. The graph scheduler owns batch execution; do not put run_in_background on nodes or the batch wrapper. Correct the rejected arguments before retrying.'

export function registerHybridTaskTool<Parameters extends TSchema, Details, State>(
  pi: ExtensionAPI,
  definition: ToolDefinition<Parameters, Details, State>,
): void {
  pi.registerTool(definition)
  let callable = false
  pi.on('before_agent_start', () => {
    if (callable) return
    const activeTools = pi.getActiveTools()
    pi.registerTool({ ...definition, exposure: 'codemode' })
    pi.setActiveTools(activeTools)
    callable = true
  })
}

export function registerTaskToolContracts(pi: ExtensionAPI, taskParameters: TSchema): void {
  pi.on('tool_call', (event) => {
    if (event.parentToolCallId === undefined) return
    if (
      (event.toolName === 'Task' || event.toolName === 'TaskControl') &&
      !pi.getActiveTools().includes(event.toolName)
    )
      return { block: true, reason: `${event.toolName} is inactive in this session.` }
    if (
      event.toolName === 'Task' &&
      ('tasks' in event.input || event.input['run_in_background'] !== true)
    ) {
      return {
        block: true,
        reason:
          'Nested Task calls require a single dispatch with explicit run_in_background: true. Call Task directly for foreground execution or batch graphs. Earlier script calls may have run; inspect their results before retrying.',
      }
    }
    if (event.toolName === 'TaskControl' && event.input['action'] === 'wait') {
      return {
        block: true,
        reason:
          'Call TaskControl wait directly as the only tool call, outside codemode. The coordinator must remain available for child decisions. Earlier script calls may have run; inspect their results before retrying.',
      }
    }
    return undefined
  })
  const invalidCalls = new Set<string>()
  pi.on('tool_execution_start', (event) => {
    const input: unknown = event.args
    if (event.toolName === 'Task' && !Value.Check(taskParameters, input))
      invalidCalls.add(event.parentToolCallId ?? event.toolCallId)
  })
  pi.on('message_end', (event) => {
    const message = event.message
    if (
      message.role !== 'toolResult' ||
      !invalidCalls.delete(message.toolCallId) ||
      !message.isError
    )
      return
    return {
      message: {
        ...message,
        content: [...message.content, { text: batchRecovery, type: 'text' }],
      },
    }
  })
  pi.on('session_shutdown', () => invalidCalls.clear())
}
