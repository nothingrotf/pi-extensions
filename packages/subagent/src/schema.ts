import { type Static, Type } from 'typebox'

export const SubagentTypeSchema = Type.String({ minLength: 1, pattern: '^[A-Za-z0-9_-]+$' })

export const EffortSchema = Type.Union([
  Type.Literal('off'),
  Type.Literal('minimal'),
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('xhigh'),
  Type.Literal('max'),
])

export const TaskInputSchema = Type.Object(
  {
    description: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    subagent_type: SubagentTypeSchema,
    cwd: Type.Optional(Type.String({ minLength: 1 })),
    model: Type.Optional(Type.String({ minLength: 1 })),
    readonly: Type.Optional(Type.Boolean()),
    resume: Type.Optional(Type.String({ minLength: 1 })),
    run_in_background: Type.Optional(Type.Boolean()),
    tools: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 })),
  },
  { additionalProperties: false },
)

export const RunStatusSchema = Type.Union([
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('aborted'),
])

export const RunUsageSchema = Type.Object({
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  cost: Type.Number({ minimum: 0 }),
  durationMs: Type.Number({ minimum: 0 }),
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  toolCalls: Type.Number({ minimum: 0 }),
  turns: Type.Number({ minimum: 0 }),
})

export const AgentSourceSchema = Type.Union([
  Type.Object({ kind: Type.Literal('bundled') }),
  Type.Object({ id: Type.String({ minLength: 1 }), kind: Type.Literal('extension') }),
  Type.Object({ kind: Type.Literal('project'), path: Type.String({ minLength: 1 }) }),
  Type.Object({ kind: Type.Literal('user'), path: Type.String({ minLength: 1 }) }),
])

export const ExecutionContractSchema = Type.Object({
  agentDescription: Type.String(),
  agentName: Type.String({ minLength: 1 }),
  agentSource: AgentSourceSchema,
  cwd: Type.String({ minLength: 1 }),
  effort: EffortSchema,
  fast: Type.Boolean(),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  readonly: Type.Boolean(),
  systemPrompt: Type.String({ minLength: 1 }),
  tools: Type.Array(Type.String({ minLength: 1 })),
  version: Type.Literal(1),
})

const RunRecordFields = {
  agentId: Type.String({ minLength: 1 }),
  background: Type.Boolean(),
  createdAt: Type.Number({ minimum: 0 }),
  description: Type.String({ minLength: 1 }),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  effort: EffortSchema,
  error: Type.Optional(Type.String()),
  fast: Type.Boolean(),
  intercomUsage: Type.Optional(RunUsageSchema),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  output: Type.Optional(Type.String()),
  ownerSessionId: Type.String({ minLength: 1 }),
  readonly: Type.Boolean(),
  runGeneration: Type.Optional(Type.Number({ minimum: 1 })),
  sessionFile: Type.String({ minLength: 1 }),
  status: RunStatusSchema,
  subagentType: SubagentTypeSchema,
  updatedAt: Type.Number({ minimum: 0 }),
  usage: Type.Optional(RunUsageSchema),
}

export const RunRecordV1Schema = Type.Object(RunRecordFields)
export const RunRecordSchema = Type.Object({
  ...RunRecordFields,
  execution: Type.Optional(ExecutionContractSchema),
})

export const RuntimeStateV1Schema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordV1Schema),
  version: Type.Literal(1),
})

export const RuntimeStateSchema = Type.Object({
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
  version: Type.Literal(2),
})

export type AgentSource = Static<typeof AgentSourceSchema>
export type Effort = Static<typeof EffortSchema>
export type ExecutionContract = Static<typeof ExecutionContractSchema>
export type RunRecord = Static<typeof RunRecordSchema>
export type RunStatus = Static<typeof RunStatusSchema>
export type RunUsage = Static<typeof RunUsageSchema>
export type RuntimeState = Static<typeof RuntimeStateSchema>
export type SubagentType = Static<typeof SubagentTypeSchema>
export type TaskInput = Static<typeof TaskInputSchema>
