import type { LoopSchedule } from './machine.ts'

export type ParsedLoop =
  | { ok: true; prompt: string; schedule: LoopSchedule }
  | { ok: false; error: string }

const unitMilliseconds = new Map<string, number>([
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
  ['d', 86_400_000],
  ['day', 86_400_000],
  ['days', 86_400_000],
])

const durationSource =
  '(\\d+(?:\\.\\d+)?)\\s*(s|secs?|seconds?|m|mins?|minutes?|h|hrs?|hours?|d|days?)'
const leadingDuration = new RegExp(`^${durationSource}\\s+(.+)$`, 'i')
const trailingDuration = new RegExp(`^(.+?)\\s+every\\s+${durationSource}$`, 'i')
const minimumIntervalMs = 1_000
const maximumIntervalMs = 8_000_000_000_000_000

function durationMs(value: string, unit: string): number | null {
  const number = Number(value)
  const multiplier = unitMilliseconds.get(unit.toLowerCase())
  if (!Number.isFinite(number) || number <= 0 || multiplier === undefined) {
    return null
  }
  const result = Math.round(number * multiplier)
  return result >= minimumIntervalMs && result <= maximumIntervalMs ? result : null
}

function fixedLoop(prompt: string, value: string, unit: string): ParsedLoop {
  const intervalMs = durationMs(value, unit)
  const trimmedPrompt = prompt.trim()
  if (intervalMs === null || trimmedPrompt.length === 0) {
    return { ok: false, error: 'Use an interval of at least 1s and include a prompt.' }
  }
  return {
    ok: true,
    prompt: trimmedPrompt,
    schedule: { mode: 'fixed', intervalMs, watch: null },
  }
}

export function parseLoopInput(input: string): ParsedLoop {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { ok: false, error: 'Usage: /loop [interval] <prompt>' }
  }

  const leading = trimmed.match(leadingDuration)
  if (leading !== null) {
    return fixedLoop(leading[3] ?? '', leading[1] ?? '', leading[2] ?? '')
  }

  const trailing = trimmed.match(trailingDuration)
  if (trailing !== null) {
    return fixedLoop(trailing[1] ?? '', trailing[2] ?? '', trailing[3] ?? '')
  }

  return {
    ok: true,
    prompt: trimmed,
    schedule: { mode: 'dynamic', intervalMs: null, watch: null },
  }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds % 86_400_000 === 0) {
    return `${milliseconds / 86_400_000}d`
  }
  if (milliseconds % 3_600_000 === 0) {
    return `${milliseconds / 3_600_000}h`
  }
  if (milliseconds % 60_000 === 0) {
    return `${milliseconds / 60_000}m`
  }
  if (milliseconds % 1_000 === 0) {
    return `${milliseconds / 1_000}s`
  }
  return `${milliseconds}ms`
}
