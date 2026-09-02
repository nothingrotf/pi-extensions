import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

export const GoalStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('budget-limited'),
  Type.Literal('complete'),
  Type.Literal('dropped'),
])

export const GoalSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  objective: Type.String({ minLength: 1 }),
  status: GoalStatusSchema,
  tokenBudget: Type.Optional(Type.Integer({ minimum: 1 })),
  tokensUsed: Type.Integer({ minimum: 0 }),
  timeUsedSeconds: Type.Integer({ minimum: 0 }),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
})

export const GoalModeEntrySchema = Type.Union([
  Type.Object({ version: Type.Literal(2), mode: Type.Literal('none') }),
  Type.Object({
    version: Type.Literal(2),
    mode: Type.Union([Type.Literal('goal'), Type.Literal('goal_paused')]),
    goal: GoalSchema,
  }),
])

export type GoalStatus = Static<typeof GoalStatusSchema>
export type Goal = Static<typeof GoalSchema>
export type GoalModeEntry = Static<typeof GoalModeEntrySchema>
export type GoalPersistMode = 'goal' | 'goal_paused' | 'none'

export interface GoalModeState {
  enabled: boolean
  mode: 'active' | 'exiting'
  reason?: 'completed'
  goal: Goal
}

export interface GoalTokenUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type GoalBudgetSteering = 'allowed' | 'suppressed'

export type GoalRuntimeEvent = {
  type: 'goal_updated'
  goal: Goal | null
  state?: GoalModeState
}

export function decodeGoalModeEntry<Input>(value: Input): GoalModeEntry | null {
  try {
    return Value.Decode(GoalModeEntrySchema, value)
  } catch {
    return null
  }
}

export function encodeGoalModeEntry(mode: GoalPersistMode, goal?: Goal): GoalModeEntry | null {
  if (mode === 'none') {
    return { version: 2, mode }
  }
  if (goal === undefined) {
    return null
  }
  return { version: 2, mode, goal: { ...goal } }
}

export function withTokenBudget(goal: Goal, tokenBudget: number | undefined): Goal {
  const { tokenBudget: _previous, ...rest } = goal
  return tokenBudget === undefined ? rest : { ...rest, tokenBudget }
}

export function isAccountingStatus(goal: Goal): boolean {
  return goal.status === 'active' || goal.status === 'budget-limited'
}

export function remainingTokens(goal: Goal | null | undefined): number | null {
  if (!goal || goal.tokenBudget === undefined) {
    return null
  }
  return Math.max(0, goal.tokenBudget - goal.tokensUsed)
}
