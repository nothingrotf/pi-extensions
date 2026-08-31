import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

const WatchSchema = Type.Object({
  command: Type.String({ minLength: 1 }),
  pattern: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
})

const DynamicConfigSchema = Type.Object({
  mode: Type.Literal('dynamic'),
  intervalMs: Type.Null(),
  watch: Type.Union([WatchSchema, Type.Null()]),
})

const FixedConfigSchema = Type.Object({
  mode: Type.Literal('fixed'),
  intervalMs: Type.Number({ minimum: 1 }),
  watch: Type.Null(),
})

const ActiveLifecycleSchema = Type.Object({
  status: Type.Literal('active'),
  nextRunAt: Type.Union([Type.Number(), Type.Null()]),
  inFlight: Type.Boolean(),
  pendingWake: Type.Boolean(),
  stopReason: Type.Null(),
})

const StoppedLifecycleSchema = Type.Object({
  status: Type.Literal('stopped'),
  nextRunAt: Type.Null(),
  inFlight: Type.Literal(false),
  pendingWake: Type.Literal(false),
  stopReason: Type.String({ minLength: 1 }),
})

export const LoopStateSchema = Type.Intersect([
  Type.Object({
    version: Type.Literal(1),
    id: Type.String({ minLength: 1 }),
    prompt: Type.String({ minLength: 1 }),
    startedAt: Type.Number(),
    lastRunAt: Type.Union([Type.Number(), Type.Null()]),
    iterations: Type.Integer({ minimum: 0 }),
  }),
  Type.Union([DynamicConfigSchema, FixedConfigSchema]),
  Type.Union([ActiveLifecycleSchema, StoppedLifecycleSchema]),
])

export type LoopState = Static<typeof LoopStateSchema>
export type ActiveLoopState = LoopState & { status: 'active' }
export type DynamicLoopState = ActiveLoopState & { mode: 'dynamic' }
export type FixedLoopState = ActiveLoopState & { mode: 'fixed' }
export type Watch = Static<typeof WatchSchema>

export type LoopSchedule =
  | { mode: 'dynamic'; intervalMs: null; watch: null }
  | { mode: 'fixed'; intervalMs: number; watch: null }

export type NewLoop = {
  prompt: string
  schedule: LoopSchedule
}

export type DynamicSchedule = {
  delayMs: number
  prompt: string | null
  watch: Watch | null
}

export function decodeLoopState<Input>(value: Input): LoopState | null {
  try {
    return Value.Decode(LoopStateSchema, value)
  } catch {
    return null
  }
}

export function createLoop(input: NewLoop, now: number, id: string): ActiveLoopState {
  return {
    version: 1,
    id,
    prompt: input.prompt,
    ...input.schedule,
    status: 'active',
    startedAt: now,
    lastRunAt: now,
    nextRunAt: input.schedule.mode === 'fixed' ? now + input.schedule.intervalMs : null,
    iterations: 1,
    inFlight: true,
    pendingWake: false,
    stopReason: null,
  }
}

export function dispatchLoopIteration(state: ActiveLoopState, now: number): ActiveLoopState {
  return {
    ...state,
    iterations: state.iterations + 1,
    lastRunAt: now,
    inFlight: true,
    pendingWake: false,
  }
}

export function settleLoopIteration(state: ActiveLoopState): ActiveLoopState {
  return { ...state, inFlight: false }
}

export function recordDynamicWake(state: DynamicLoopState): DynamicLoopState {
  return { ...state, nextRunAt: null, watch: null, pendingWake: true }
}

export function recordFixedWake(state: FixedLoopState, now: number): FixedLoopState {
  const deadline = state.nextRunAt ?? now
  const elapsed = Math.max(0, now - deadline)
  const intervals = Math.floor(elapsed / state.intervalMs) + 1
  return {
    ...state,
    nextRunAt: deadline + intervals * state.intervalMs,
    pendingWake: true,
  }
}

export function scheduleDynamicLoop(
  state: DynamicLoopState,
  schedule: DynamicSchedule,
  now: number,
): DynamicLoopState {
  return {
    ...state,
    prompt: schedule.prompt ?? state.prompt,
    nextRunAt: now + schedule.delayMs,
    watch: schedule.watch,
    pendingWake: false,
  }
}

export function recoverLoop(state: ActiveLoopState): ActiveLoopState {
  return { ...state, inFlight: false }
}

export function stopLoop(state: ActiveLoopState, reason: string): LoopState {
  return {
    ...state,
    status: 'stopped',
    nextRunAt: null,
    inFlight: false,
    pendingWake: false,
    stopReason: reason,
    watch: null,
  }
}

export function isActiveLoop(state: LoopState | null): state is ActiveLoopState {
  return state?.status === 'active'
}

export function isDynamicLoop(state: LoopState | null): state is DynamicLoopState {
  return state?.status === 'active' && state.mode === 'dynamic'
}

export function isFixedLoop(state: LoopState | null): state is FixedLoopState {
  return state?.status === 'active' && state.mode === 'fixed'
}
