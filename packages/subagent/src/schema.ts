import { type Static, Type } from 'typebox'

export const SubagentTypeSchema = Type.Union([
  Type.Literal('generalPurpose'),
  Type.Literal('explore'),
  Type.Literal('shell'),
  Type.Literal('debug'),
])

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
    model: Type.Optional(Type.String({ minLength: 1 })),
    resume: Type.Optional(Type.String({ minLength: 1 })),
    readonly: Type.Optional(Type.Boolean()),
    run_in_background: Type.Optional(Type.Boolean()),
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
  input: Type.Number({ minimum: 0 }),
  output: Type.Number({ minimum: 0 }),
  cacheRead: Type.Number({ minimum: 0 }),
  cacheWrite: Type.Number({ minimum: 0 }),
  cost: Type.Number({ minimum: 0 }),
  turns: Type.Number({ minimum: 0 }),
  toolCalls: Type.Number({ minimum: 0 }),
  durationMs: Type.Number({ minimum: 0 }),
})

export const RunRecordSchema = Type.Object({
  agentId: Type.String({ minLength: 1 }),
  ownerSessionId: Type.String({ minLength: 1 }),
  sessionFile: Type.String({ minLength: 1 }),
  subagentType: SubagentTypeSchema,
  description: Type.String({ minLength: 1 }),
  model: Type.String({ minLength: 1 }),
  modelSelector: Type.String({ minLength: 1 }),
  effort: EffortSchema,
  fast: Type.Boolean(),
  readonly: Type.Boolean(),
  background: Type.Boolean(),
  status: RunStatusSchema,
  createdAt: Type.Number({ minimum: 0 }),
  updatedAt: Type.Number({ minimum: 0 }),
  output: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
  intercomUsage: Type.Optional(RunUsageSchema),
  usage: Type.Optional(RunUsageSchema),
})

export const RuntimeStateSchema = Type.Object({
  version: Type.Literal(1),
  ownerSessionId: Type.String({ minLength: 1 }),
  records: Type.Array(RunRecordSchema),
})

export type Effort = Static<typeof EffortSchema>
export type RunRecord = Static<typeof RunRecordSchema>
export type RunStatus = Static<typeof RunStatusSchema>
export type RunUsage = Static<typeof RunUsageSchema>
export type RuntimeState = Static<typeof RuntimeStateSchema>
export type SubagentType = Static<typeof SubagentTypeSchema>
export type TaskInput = Static<typeof TaskInputSchema>
