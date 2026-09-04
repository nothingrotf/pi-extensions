import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

export const DEFAULT_MAX_ITERATIONS = 5
export const MAX_GOAL_ITERATIONS = 12
export const MAX_VERDICT_HISTORY = 8
export const MAX_PENDING_STEERING = 5
export const MAX_GOAL_STEERING = 24

export const GoalStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('budget-limited'),
  Type.Literal('stuck'),
  Type.Literal('complete'),
  Type.Literal('dropped'),
])

export const GoalPhaseSchema = Type.Union([
  Type.Literal('coding'),
  Type.Literal('reviewing'),
  Type.Literal('between'),
])

export const GoalVerdictStatusSchema = Type.Union([
  Type.Literal('PASS'),
  Type.Literal('FAIL'),
  Type.Literal('PARTIAL'),
])

export const GoalCheckKindSchema = Type.Union([
  Type.Literal('scope'),
  Type.Literal('typecheck'),
  Type.Literal('test'),
  Type.Literal('runtime'),
])

export const GoalCheckStatusSchema = Type.Union([
  Type.Literal('passed'),
  Type.Literal('failed'),
  Type.Literal('unavailable'),
])

export const GoalTokenUsageSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
)

export const GoalCheckResultSchema = Type.Object(
  {
    kind: GoalCheckKindSchema,
    label: Type.String({ minLength: 1, maxLength: 120 }),
    status: GoalCheckStatusSchema,
    durationMs: Type.Integer({ minimum: 0 }),
    command: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    output: Type.Optional(Type.String({ maxLength: 1_600 })),
  },
  { additionalProperties: false },
)

export const GoalVerdictRecordSchema = Type.Object(
  {
    status: GoalVerdictStatusSchema,
    reason: Type.String({ minLength: 1, maxLength: 2_000 }),
    evidence: Type.Array(Type.String({ minLength: 1, maxLength: 1_000 }), { maxItems: 24 }),
    checks: Type.Array(GoalCheckResultSchema, { maxItems: 4 }),
    reviewedAt: Type.Number(),
    reviewerModel: Type.String({ minLength: 1, maxLength: 240 }),
    report: Type.String({ maxLength: 4_000 }),
    usage: GoalTokenUsageSchema,
  },
  { additionalProperties: false },
)

export const GoalLoopStateSchema = Type.Object(
  {
    iteration: Type.Integer({ minimum: 0 }),
    convergenceStart: Type.Optional(Type.Integer({ minimum: 0 })),
    maxIterations: Type.Integer({ minimum: 1, maximum: MAX_GOAL_ITERATIONS }),
    phase: GoalPhaseSchema,
    verdictHistory: Type.Array(GoalVerdictRecordSchema, { maxItems: MAX_VERDICT_HISTORY }),
    pendingSteering: Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), {
      maxItems: MAX_PENDING_STEERING,
    }),
    userSteering: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2_000 }), { maxItems: MAX_GOAL_STEERING }),
    ),
    reviewRequested: Type.Boolean(),
    runtimeProbe: Type.Boolean(),
    reviewModel: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    reviewFallbackModel: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    nextPrompt: Type.Optional(Type.String({ minLength: 1, maxLength: 12_000 })),
    stopReason: Type.Optional(Type.String({ minLength: 1, maxLength: 2_000 })),
  },
  { additionalProperties: false },
)

export const GoalSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    status: GoalStatusSchema,
    tokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
    tokensUsed: Type.Integer({ minimum: 0 }),
    timeUsedSeconds: Type.Integer({ minimum: 0 }),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
)

export const GoalModeStateSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    mode: Type.Union([Type.Literal('active'), Type.Literal('exiting')]),
    reason: Type.Optional(Type.Union([Type.Literal('completed'), Type.Literal('stuck')])),
    goal: GoalSchema,
    loop: GoalLoopStateSchema,
  },
  { additionalProperties: false },
)

const LegacyGoalStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('budget-limited'),
  Type.Literal('complete'),
  Type.Literal('dropped'),
])

const LegacyGoalSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    objective: Type.String({ minLength: 1 }),
    status: LegacyGoalStatusSchema,
    tokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
    tokensUsed: Type.Integer({ minimum: 0 }),
    timeUsedSeconds: Type.Integer({ minimum: 0 }),
    createdAt: Type.Number(),
    updatedAt: Type.Number(),
  },
  { additionalProperties: false },
)

const GoalModeEntryV2Schema = Type.Union([
  Type.Object(
    { version: Type.Literal(2), mode: Type.Literal('none') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      version: Type.Literal(2),
      mode: Type.Union([Type.Literal('goal'), Type.Literal('goal_paused')]),
      goal: LegacyGoalSchema,
    },
    { additionalProperties: false },
  ),
])

const GoalModeEntryV3Schema = Type.Union([
  Type.Object(
    { version: Type.Literal(3), mode: Type.Literal('none') },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      version: Type.Literal(3),
      mode: Type.Union([Type.Literal('goal'), Type.Literal('goal_paused')]),
      state: GoalModeStateSchema,
    },
    { additionalProperties: false },
  ),
])

export const GoalModeEntrySchema = Type.Union([GoalModeEntryV2Schema, GoalModeEntryV3Schema])

export type GoalStatus = Static<typeof GoalStatusSchema>
export type GoalPhase = Static<typeof GoalPhaseSchema>
export type GoalVerdictStatus = Static<typeof GoalVerdictStatusSchema>
export type GoalCheckKind = Static<typeof GoalCheckKindSchema>
export type GoalCheckStatus = Static<typeof GoalCheckStatusSchema>
export type GoalTokenUsage = Static<typeof GoalTokenUsageSchema>
export type GoalCheckResult = Static<typeof GoalCheckResultSchema>
export type GoalVerdictRecord = Static<typeof GoalVerdictRecordSchema>
export type GoalLoopState = Static<typeof GoalLoopStateSchema>
export type Goal = Static<typeof GoalSchema>
export type GoalModeState = Static<typeof GoalModeStateSchema>
export type GoalModeEntry = Static<typeof GoalModeEntrySchema>
export type GoalPersistMode = 'goal' | 'goal_paused' | 'none'

export type GoalBudgetSteering = 'allowed' | 'suppressed'

export type GoalRuntimeEvent = {
  type: 'goal_updated'
  goal: Goal | null
  state?: GoalModeState
}

export interface GoalLoopOptions {
  maxIterations?: number
  reviewModel?: string
  reviewFallbackModel?: string
  runtimeProbe?: boolean
}

export function createGoalLoop(options: GoalLoopOptions = {}): GoalLoopState {
  const loop: GoalLoopState = {
    iteration: 0,
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    phase: 'coding',
    verdictHistory: [],
    pendingSteering: [],
    reviewRequested: false,
    runtimeProbe: options.runtimeProbe ?? false,
  }
  if (options.reviewModel !== undefined) loop.reviewModel = options.reviewModel
  if (options.reviewFallbackModel !== undefined) {
    loop.reviewFallbackModel = options.reviewFallbackModel
  }
  return loop
}

export function cloneGoalState(state: GoalModeState): GoalModeState {
  return structuredClone(state)
}

export function decodeGoalModeEntry<Input>(value: Input): GoalModeEntry | null {
  if (!Value.Check(GoalModeEntrySchema, value)) return null
  try {
    return Value.Decode(GoalModeEntrySchema, value)
  } catch {
    return null
  }
}

export function encodeGoalModeEntry(
  mode: GoalPersistMode,
  state?: GoalModeState,
): GoalModeEntry | null {
  if (mode === 'none') return { version: 3, mode }
  if (state === undefined) return null
  return { version: 3, mode, state: cloneGoalState(state) }
}

export function restoreGoalModeState(entry: GoalModeEntry): GoalModeState | undefined {
  if (entry.mode === 'none') return undefined
  if (entry.version === 3) {
    const restored = cloneGoalState(entry.state)
    restored.enabled = entry.mode === 'goal'
    if (restored.loop.phase === 'reviewing') restored.loop.phase = 'between'
    return restored
  }
  const goal: Goal = { ...entry.goal }
  if (entry.mode === 'goal_paused' && goal.status !== 'complete' && goal.status !== 'dropped') {
    goal.status = 'paused'
  }
  return {
    enabled: entry.mode === 'goal',
    mode: goal.status === 'complete' ? 'exiting' : 'active',
    goal,
    loop: createGoalLoop(),
  }
}

export function withTokenBudget(goal: Goal, tokenBudget: number | undefined): Goal {
  const { tokenBudget: _previous, ...rest } = goal
  return tokenBudget === undefined ? rest : { ...rest, tokenBudget }
}

export function isAccountingStatus(goal: Goal): boolean {
  return goal.status === 'active' || goal.status === 'budget-limited'
}

export function remainingTokens(goal: Goal | null | undefined): number | null {
  if (!goal || goal.tokenBudget === undefined) return null
  return Math.max(0, goal.tokenBudget - goal.tokensUsed)
}

export function goalUsageTotal(usage: GoalTokenUsage): number {
  return usage.input + usage.output + usage.cacheWrite
}
