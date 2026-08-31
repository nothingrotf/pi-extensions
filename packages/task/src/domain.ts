import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const SameMachineSchema = Type.Object(
  { same_machine: Type.Object({}, { additionalProperties: false }) },
  { additionalProperties: false },
)

const NewCloudVmSchema = Type.Object(
  {
    new_cloud_vm: Type.Object(
      {
        environment_build_id: Type.Optional(Type.String()),
        base_branch: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

const SelfHostedWorkerSchema = Type.Object(
  {
    self_hosted_worker: Type.Object(
      { worker_id: Type.String({ minLength: 1 }) },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

const SelfHostedPoolSchema = Type.Object(
  {
    self_hosted_pool: Type.Object(
      {
        pool: Type.Optional(Type.String()),
        labels: Type.Optional(
          Type.Array(
            Type.Object(
              { key: Type.String(), value: Type.String() },
              { additionalProperties: false },
            ),
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export const TaskTargetMachineSchema = Type.Union([
  SameMachineSchema,
  NewCloudVmSchema,
  SelfHostedWorkerSchema,
  SelfHostedPoolSchema,
])

export const TaskSchema = Type.Object(
  {
    description: Type.String({
      minLength: 1,
      description: 'A short description of the delegated task',
    }),
    prompt: Type.String({ minLength: 1, description: 'The complete task for the child agent' }),
    subagent_type: Type.String({
      minLength: 1,
      description: 'The built-in role or configured pi-subagents agent name',
    }),
    model: Type.Optional(Type.String({ minLength: 1 })),
    resume: Type.Optional(Type.String({ minLength: 1 })),
    readonly: Type.Optional(Type.Boolean()),
    run_in_background: Type.Optional(Type.Boolean()),
    attachments: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    environment: Type.Optional(
      Type.Union([Type.Literal('unspecified'), Type.Literal('local'), Type.Literal('cloud')]),
    ),
    cloud_base_branch: Type.Optional(Type.String({ minLength: 1 })),
    cloud_requested_environment_build_id: Type.Optional(Type.String({ minLength: 1 })),
    machine: Type.Optional(TaskTargetMachineSchema),
    interrupt: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
)

const TaskUsageSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
    cost: Type.Number({ minimum: 0 }),
    turns: Type.Number({ minimum: 0 }),
    toolCalls: Type.Number({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)

const TaskCompletedDetailsSchema = Type.Object(
  {
    status: Type.Literal('completed'),
    agentId: Type.String(),
    finalMessage: Type.String(),
    toolCallCount: Type.Number({ minimum: 0 }),
    durationMs: Type.Number({ minimum: 0 }),
    runId: Type.String(),
    model: Type.Optional(Type.String()),
    transcriptPath: Type.Optional(Type.String()),
    usage: Type.Optional(TaskUsageSchema),
  },
  { additionalProperties: false },
)

const TaskBackgroundDetailsSchema = Type.Object(
  {
    status: Type.Literal('background'),
    agentId: Type.String(),
    runId: Type.String(),
    backgroundReason: Type.Union([
      Type.Literal('agent_request'),
      Type.Literal('user_request'),
      Type.Literal('queued_follow_up'),
    ]),
  },
  { additionalProperties: false },
)

const TaskErrorDetailsSchema = Type.Object(
  {
    status: Type.Literal('error'),
    error: Type.String(),
    agentId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
)

export const TaskDetailsSchema = Type.Union([
  TaskCompletedDetailsSchema,
  TaskBackgroundDetailsSchema,
  TaskErrorDetailsSchema,
])

export const PendingTaskSchema = Type.Object(
  {
    completionRunId: Type.String({ minLength: 1 }),
    agentId: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    subagentType: Type.String({ minLength: 1 }),
    startedAt: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export const TaskAgentSchema = Type.Object(
  {
    agentId: Type.String({ minLength: 1 }),
    readonly: Type.Boolean(),
    subagentType: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
)

export const TaskStateSchema = Type.Object(
  {
    version: Type.Literal(1),
    pending: Type.Array(PendingTaskSchema),
    agents: Type.Optional(Type.Array(TaskAgentSchema)),
  },
  { additionalProperties: false },
)

export type TaskInput = Static<typeof TaskSchema>
export type TaskDetails = Static<typeof TaskDetailsSchema>
export type PendingTask = Static<typeof PendingTaskSchema>
export type TaskAgent = Static<typeof TaskAgentSchema>
export type TaskState = Static<typeof TaskStateSchema>
export type TaskCompletedDetails = Static<typeof TaskCompletedDetailsSchema>

export type TaskValidation = { kind: 'valid' } | { kind: 'invalid'; error: string }

export function validateTaskInput(input: TaskInput): TaskValidation {
  if (input.description.trim().length === 0) {
    return { kind: 'invalid', error: 'Task description cannot be blank.' }
  }
  if (input.prompt.trim().length === 0) {
    return { kind: 'invalid', error: 'Task prompt cannot be blank.' }
  }
  if (input.subagent_type.trim().length === 0) {
    return { kind: 'invalid', error: 'Task subagent_type cannot be blank.' }
  }
  if (input.model?.trim() === 'auto') {
    return {
      kind: 'invalid',
      error: 'Task automatic model selection is not supported by pi-subagents.',
    }
  }
  if (input.attachments !== undefined && input.attachments.length > 0) {
    return { kind: 'invalid', error: 'Task attachments are not supported by pi-subagents.' }
  }
  if (input.environment === 'cloud') {
    return { kind: 'invalid', error: 'Task cloud execution is not supported by pi-subagents.' }
  }
  if (
    input.cloud_base_branch !== undefined ||
    input.cloud_requested_environment_build_id !== undefined
  ) {
    return { kind: 'invalid', error: 'Task cloud configuration is not supported by pi-subagents.' }
  }
  if (input.machine !== undefined && !('same_machine' in input.machine)) {
    return {
      kind: 'invalid',
      error: 'Task remote machine selection is not supported by pi-subagents.',
    }
  }
  if (input.interrupt === true) {
    return { kind: 'invalid', error: 'Task interrupt is not supported by the Pi adapter.' }
  }
  return { kind: 'valid' }
}

export function resolveAgentName(subagentType: string, readonly: boolean): string {
  if (readonly) {
    return 'task-readonly'
  }
  switch (subagentType.trim()) {
    case 'generalPurpose':
    case 'general-purpose':
    case 'general_purpose':
    case 'unspecified':
    case 'shell':
    case 'bash':
      return 'worker'
    case 'explore':
      return 'scout'
    default:
      return subagentType.trim()
  }
}

export function resolveModel(model: string | undefined): string | undefined {
  const normalized = model?.trim()
  if (
    normalized === undefined ||
    normalized === '' ||
    normalized === 'default' ||
    normalized === 'inherit'
  ) {
    return undefined
  }
  return normalized
}

export function completedText(details: TaskCompletedDetails): string {
  if (details.finalMessage.length === 0) {
    return `Agent ID: ${details.agentId}`
  }
  return `Agent ID: ${details.agentId}\n\n${details.finalMessage}`
}

export function backgroundText(agentId: string): string {
  return `Task started in the background.\nAgent ID: ${agentId}`
}

export function errorDetails(error: string, agentId?: string): TaskDetails {
  if (agentId === undefined) {
    return { status: 'error', error }
  }
  return { status: 'error', error, agentId }
}

export function decodeTaskDetails<Input>(value: Input): TaskDetails | null {
  try {
    return Value.Decode(TaskDetailsSchema, value)
  } catch {
    return null
  }
}

export function decodeTaskState<Input>(value: Input): TaskState | null {
  try {
    return Value.Decode(TaskStateSchema, value)
  } catch {
    return null
  }
}
