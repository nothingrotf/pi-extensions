import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

const GoalStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('paused'),
  Type.Literal('complete'),
  Type.Literal('cleared'),
])

export const GoalStateSchema = Type.Object({
  version: Type.Literal(1),
  id: Type.String({ minLength: 1 }),
  objective: Type.String({ minLength: 1 }),
  status: GoalStatusSchema,
  startedAt: Type.Number(),
  activeDurationMs: Type.Number({ minimum: 0 }),
  lastAccruedAt: Type.Union([Type.Number(), Type.Null()]),
  idleContinuationsWithoutToolCalls: Type.Integer({ minimum: 0 }),
  continuationCount: Type.Integer({ minimum: 0 }),
})

export type GoalState = Static<typeof GoalStateSchema>
export type GoalStatus = Static<typeof GoalStatusSchema>
export type ActiveGoalState = GoalState & { status: 'active' }

export function decodeGoalState<Input>(value: Input): GoalState | null {
  try {
    return Value.Decode(GoalStateSchema, value)
  } catch {
    return null
  }
}

export function createGoal(objective: string, now: number, id: string): ActiveGoalState {
  return {
    version: 1,
    id,
    objective,
    status: 'active',
    startedAt: now,
    activeDurationMs: 0,
    lastAccruedAt: now,
    idleContinuationsWithoutToolCalls: 0,
    continuationCount: 0,
  }
}

export function activeDurationMs(state: GoalState, now: number): number {
  if (state.status !== 'active' || state.lastAccruedAt === null) {
    return state.activeDurationMs
  }
  return state.activeDurationMs + Math.max(0, now - state.lastAccruedAt)
}

export function accrueGoal(state: GoalState, now: number): GoalState {
  if (state.status !== 'active' || state.lastAccruedAt === null) {
    return state
  }
  return {
    ...state,
    activeDurationMs: activeDurationMs(state, now),
    lastAccruedAt: now,
  }
}

export function updateGoalStatus(
  state: GoalState,
  status: 'active' | 'complete' | 'paused' | 'cleared',
  now: number,
): GoalState {
  const accrued = accrueGoal(state, now)
  if (status === 'active') {
    return {
      ...accrued,
      status,
      lastAccruedAt: accrued.status === 'active' ? accrued.lastAccruedAt : now,
      idleContinuationsWithoutToolCalls: 0,
    }
  }
  return {
    ...accrued,
    status,
    lastAccruedAt: null,
  }
}

export function settleGoalTurn(
  state: ActiveGoalState,
  usedTool: boolean,
  isContinuation: boolean,
  now: number,
): ActiveGoalState {
  const accrued = accrueGoal(state, now)
  return {
    ...accrued,
    status: 'active',
    idleContinuationsWithoutToolCalls: usedTool
      ? 0
      : isContinuation
        ? state.idleContinuationsWithoutToolCalls + 1
        : state.idleContinuationsWithoutToolCalls,
  }
}

export function dispatchContinuation(state: ActiveGoalState): ActiveGoalState {
  return {
    ...state,
    continuationCount: state.continuationCount + 1,
  }
}
