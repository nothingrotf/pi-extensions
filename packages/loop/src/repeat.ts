import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

const IterationLimitSchema = Type.Object({
  kind: Type.Literal('iterations'),
  initial: Type.Integer({ minimum: 1 }),
  remaining: Type.Integer({ minimum: 0 }),
})

const DurationLimitSchema = Type.Object({
  kind: Type.Literal('duration'),
  durationMs: Type.Integer({ minimum: 1 }),
  deadlineMs: Type.Number(),
})

export const RepeatStateSchema = Type.Object({
  version: Type.Literal(1),
  enabled: Type.Boolean(),
  paused: Type.Boolean(),
  prompt: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  between: Type.Union([Type.Literal('prompt'), Type.Literal('compact')]),
  limit: Type.Union([IterationLimitSchema, DurationLimitSchema, Type.Null()]),
  iterations: Type.Integer({ minimum: 0 }),
  startedAt: Type.Number(),
})

export type RepeatState = Static<typeof RepeatStateSchema>
export type RepeatLimit = Static<typeof IterationLimitSchema> | Static<typeof DurationLimitSchema>
export type RepeatBetween = RepeatState['between']

export type RepeatLimitConfig =
  | { kind: 'iterations'; iterations: number }
  | { kind: 'duration'; durationMs: number }

export interface ParsedRepeatArgs {
  between: RepeatBetween
  limit?: RepeatLimitConfig
  prompt?: string
}

export type RepeatParseResult = { ok: true; args: ParsedRepeatArgs } | { ok: false; error: string }

type LimitParse = { ok: true; limit: RepeatLimitConfig } | { ok: false; error: string }

const timeUnitsMs = new Map<string, number>([
  ['s', 1_000],
  ['sec', 1_000],
  ['secs', 1_000],
  ['second', 1_000],
  ['seconds', 1_000],
  ['m', 60_000],
  ['min', 60_000],
  ['mins', 60_000],
  ['minute', 60_000],
  ['minutes', 60_000],
  ['h', 3_600_000],
  ['hr', 3_600_000],
  ['hrs', 3_600_000],
  ['hour', 3_600_000],
  ['hours', 3_600_000],
])

export const repeatUsage =
  'Usage: /loop repeat [compact] [count|duration] [prompt]. Examples: /loop repeat 10, /loop repeat 10m, /loop repeat compact 1h30m fix the tests.'

function iterationsLimit(text: string): LimitParse {
  const amount = Number(text)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'Loop count must be a positive integer.' }
  }
  return { ok: true, limit: { kind: 'iterations', iterations: amount } }
}

function durationLimit(text: string, unitMs: number): LimitParse {
  const amount = Number(text)
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, error: 'Loop duration must be positive.' }
  }
  return { ok: true, limit: { kind: 'duration', durationMs: amount * unitMs } }
}

function compoundDuration(token: string): LimitParse | undefined {
  if (!/^(?:\d+[a-z]+)+$/.test(token)) {
    return undefined
  }
  const segments = token.match(/\d+[a-z]+/g)
  if (segments === null) {
    return undefined
  }
  let totalMs = 0
  for (const segment of segments) {
    const match = /^(\d+)([a-z]+)$/.exec(segment)
    if (match === null) {
      return { ok: false, error: repeatUsage }
    }
    const unitMs = timeUnitsMs.get(match[2] ?? '')
    if (unitMs === undefined) {
      return { ok: false, error: 'Loop duration unit must be seconds, minutes, or hours.' }
    }
    const amount = Number(match[1])
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return { ok: false, error: 'Loop duration must be positive.' }
    }
    totalMs += amount * unitMs
  }
  return totalMs <= 0
    ? { ok: false, error: 'Loop duration must be positive.' }
    : { ok: true, limit: { kind: 'duration', durationMs: totalMs } }
}

function withPrompt(
  between: RepeatBetween,
  limit: RepeatLimitConfig,
  prompt: string,
): RepeatParseResult {
  return prompt.length === 0
    ? { ok: true, args: { between, limit } }
    : { ok: true, args: { between, limit, prompt } }
}

export function parseRepeatArgs(args: string): RepeatParseResult {
  let trimmed = args.trim()
  let between: RepeatBetween = 'prompt'
  const betweenMatch = /^compact(?:\s+|$)/i.exec(trimmed)
  if (betweenMatch !== null) {
    between = 'compact'
    trimmed = trimmed.slice(betweenMatch[0].length).trim()
  }
  if (trimmed.length === 0) {
    return { ok: true, args: { between } }
  }
  const firstSpace = trimmed.search(/\s/)
  const firstToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()
  const token = firstToken.toLowerCase()

  if (!/^[+-]?\d/.test(token)) {
    return { ok: true, args: { between, prompt: trimmed } }
  }
  if (/^\d+$/.test(token)) {
    if (rest.length > 0) {
      const restTokens = rest.split(/\s+/)
      const unitMs = timeUnitsMs.get((restTokens[0] ?? '').toLowerCase())
      if (unitMs !== undefined) {
        const parsed = durationLimit(token, unitMs)
        if (!parsed.ok) {
          return parsed
        }
        return withPrompt(between, parsed.limit, restTokens.slice(1).join(' ').trim())
      }
    }
    const parsed = iterationsLimit(token)
    if (!parsed.ok) {
      return parsed
    }
    return withPrompt(between, parsed.limit, rest)
  }
  const duration = compoundDuration(token)
  if (duration !== undefined) {
    if (!duration.ok) {
      return duration
    }
    return withPrompt(between, duration.limit, rest)
  }
  return { ok: false, error: repeatUsage }
}

export function decodeRepeatState<Input>(value: Input): RepeatState | null {
  try {
    return Value.Decode(RepeatStateSchema, value)
  } catch {
    return null
  }
}

export function createRepeatLimit(
  config: RepeatLimitConfig | undefined,
  now: number,
): RepeatLimit | null {
  if (config === undefined) {
    return null
  }
  if (config.kind === 'iterations') {
    return { kind: 'iterations', initial: config.iterations, remaining: config.iterations }
  }
  return { kind: 'duration', durationMs: config.durationMs, deadlineMs: now + config.durationMs }
}

export function enableRepeat(parsed: ParsedRepeatArgs, now: number): RepeatState {
  return {
    version: 1,
    enabled: true,
    paused: false,
    prompt: parsed.prompt ?? null,
    between: parsed.between,
    limit: createRepeatLimit(parsed.limit, now),
    iterations: 0,
    startedAt: now,
  }
}

export function disableRepeat(state: RepeatState): RepeatState {
  return { ...state, enabled: false, paused: false, prompt: null }
}

export function pauseRepeat(state: RepeatState): RepeatState {
  return { ...state, paused: true }
}

export function setRepeatPrompt(state: RepeatState, prompt: string): RepeatState {
  return { ...state, prompt, paused: false }
}

export function isRepeatExpired(state: RepeatState, now: number): boolean {
  return state.limit?.kind === 'duration' && now >= state.limit.deadlineMs
}

export function consumeRepeatIteration(
  state: RepeatState,
  now: number,
): { ok: true; state: RepeatState } | { ok: false; reason: string } {
  if (state.limit === null) {
    return { ok: true, state: { ...state, iterations: state.iterations + 1 } }
  }
  if (state.limit.kind === 'duration') {
    if (now >= state.limit.deadlineMs) {
      return { ok: false, reason: 'Loop time limit reached.' }
    }
    return { ok: true, state: { ...state, iterations: state.iterations + 1 } }
  }
  if (state.limit.remaining <= 0) {
    return { ok: false, reason: 'Loop limit reached.' }
  }
  return {
    ok: true,
    state: {
      ...state,
      iterations: state.iterations + 1,
      limit: { ...state.limit, remaining: state.limit.remaining - 1 },
    },
  }
}

function formatLimitDuration(durationMs: number): string {
  if (durationMs % 3_600_000 === 0) {
    const hours = durationMs / 3_600_000
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  if (durationMs % 60_000 === 0) {
    const minutes = durationMs / 60_000
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  }
  const seconds = durationMs / 1_000
  return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
}

export function describeRepeatLimitConfig(config: RepeatLimitConfig): string {
  if (config.kind === 'iterations') {
    return `${config.iterations} ${config.iterations === 1 ? 'iteration' : 'iterations'}`
  }
  return formatLimitDuration(config.durationMs)
}

export function describeRepeatLimit(limit: RepeatLimit): string {
  if (limit.kind === 'iterations') {
    return `${limit.remaining} of ${limit.initial} ${limit.initial === 1 ? 'iteration' : 'iterations'} remaining`
  }
  return `${formatLimitDuration(limit.durationMs)} limit`
}

export function describeRepeat(state: RepeatState): string {
  if (!state.enabled) {
    return 'Repeat loop off.'
  }
  const phase = state.paused
    ? 'paused'
    : state.prompt === null
      ? 'waiting for the next prompt'
      : `repeating ${JSON.stringify(state.prompt)}`
  const limit = state.limit === null ? '' : ` ${describeRepeatLimit(state.limit)}.`
  const between = state.between === 'compact' ? ' Compacts before each iteration.' : ''
  return `Repeat loop ${phase}. Iterations: ${state.iterations}.${limit}${between}`
}
