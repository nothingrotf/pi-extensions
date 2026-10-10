import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import { TaskInputSchema } from './schema.ts'
import { errorMessage } from './workspace.ts'

export const SUBAGENT_EXECUTE_TASK_EVENT = '@nothingrotf/subagent/execute-task'

export const ExecuteTaskRequestSchema = Type.Object(
  {
    version: Type.Literal(1),
    toolCallId: Type.String({ minLength: 1 }),
    input: Type.Unknown(),
    accept: Type.Function([Type.Function([], Type.Void())], Type.Void()),
    respond: Type.Function([Type.Unknown()], Type.Void()),
  },
  { additionalProperties: false },
)

export type ExecuteTaskRequest = Static<typeof ExecuteTaskRequestSchema>

export type ExecuteTask<Details> = (
  input: Static<typeof TaskInputSchema>,
  signal: AbortSignal,
  ctx: ExtensionContext,
  toolCallId: string,
) => Promise<AgentToolResult<Details>>

function invalidInput(request: ExecuteTaskRequest): string {
  const first = Value.Errors(TaskInputSchema, request.input)[0]
  return first === undefined
    ? 'The Task input is invalid.'
    : `The Task input is invalid at ${first.instancePath || '/'}: ${first.message}`
}

export function registerTaskExecution<Details>(
  pi: ExtensionAPI,
  execute: ExecuteTask<Details>,
): () => void {
  const contexts = new Map<string, ExtensionContext>()
  pi.on('tool_call', (event, ctx) => {
    contexts.set(event.toolCallId, ctx)
  })
  pi.on('tool_result', (event) => {
    contexts.delete(event.toolCallId)
  })
  return pi.events.on(SUBAGENT_EXECUTE_TASK_EVENT, (value) => {
    if (!Value.Check(ExecuteTaskRequestSchema, value)) return
    const controller = new AbortController()
    value.accept(() => controller.abort())
    const ctx = contexts.get(value.toolCallId)
    if (ctx === undefined) {
      value.respond({
        error: `No active tool call ${value.toolCallId} can own this Task. Request it from a running tool.`,
      })
      return
    }
    if (!Value.Check(TaskInputSchema, value.input)) {
      value.respond({ error: invalidInput(value) })
      return
    }
    execute(value.input, controller.signal, ctx, value.toolCallId).then(
      (result) => value.respond({ result }),
      (error) => value.respond({ error: errorMessage(error) }),
    )
  })
}
