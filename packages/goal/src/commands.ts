import { MAX_GOAL_ITERATIONS } from './state.ts'

export type GoalSubcommand =
  | 'set'
  | 'show'
  | 'pause'
  | 'resume'
  | 'drop'
  | 'budget'
  | 'max'
  | 'reviewer'
  | 'probe'

export const goalSubcommands: readonly GoalSubcommand[] = [
  'set',
  'show',
  'pause',
  'resume',
  'drop',
  'budget',
  'max',
  'reviewer',
  'probe',
]

export interface GoalStartOptions {
  maxIterations?: number
  reviewModel?: string
  reviewFallbackModel?: string
  runtimeProbe?: boolean
}

export type GoalStartParseResult =
  | { kind: 'valid'; objective: string; options: GoalStartOptions }
  | { kind: 'invalid'; error: string }

function toSubcommand(value: string): GoalSubcommand | undefined {
  return goalSubcommands.find((candidate) => candidate === value)
}

export function parseGoalSubcommand(args: string): {
  sub: GoalSubcommand | undefined
  rest: string
} {
  const trimmed = args.trim()
  if (trimmed.length === 0) return { sub: undefined, rest: '' }
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (match === null) return { sub: undefined, rest: trimmed }
  const sub = toSubcommand((match[1] ?? '').toLowerCase())
  if (sub === undefined) return { sub: undefined, rest: trimmed }
  return { sub, rest: match[2]?.trim() ?? '' }
}

function modelReference(value: string, label: string): string {
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1 || /\s/.test(value)) {
    throw new Error(`${label} must use provider/model-id syntax.`)
  }
  return value
}

export function parseGoalStartOptions(raw: string): GoalStartParseResult {
  const options: GoalStartOptions = {}
  let invalid: string | undefined
  let maxSeen = false
  let reviewSeen = false
  let fallbackSeen = false
  let probeSeen = false
  const objective = raw
    .replace(/(?:^|\s)--max=([^\s]+)/g, (_match, value: string) => {
      if (maxSeen) invalid = 'Use --max only once.'
      maxSeen = true
      const parsed = Number(value)
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_GOAL_ITERATIONS) {
        invalid = `--max must be an integer from 1 to ${MAX_GOAL_ITERATIONS}.`
      } else {
        options.maxIterations = parsed
      }
      return ' '
    })
    .replace(/(?:^|\s)--review-model=([^\s]+)/g, (_match, value: string) => {
      if (reviewSeen) invalid = 'Use --review-model only once.'
      reviewSeen = true
      try {
        options.reviewModel = modelReference(value, '--review-model')
      } catch (error) {
        invalid = error instanceof Error ? error.message : String(error)
      }
      return ' '
    })
    .replace(/(?:^|\s)--review-fallback=([^\s]+)/g, (_match, value: string) => {
      if (fallbackSeen) invalid = 'Use --review-fallback only once.'
      fallbackSeen = true
      try {
        options.reviewFallbackModel = modelReference(value, '--review-fallback')
      } catch (error) {
        invalid = error instanceof Error ? error.message : String(error)
      }
      return ' '
    })
    .replace(/(?:^|\s)--runtime-probe(?=\s|$)/g, () => {
      if (probeSeen) invalid = 'Use --runtime-probe only once.'
      probeSeen = true
      options.runtimeProbe = true
      return ' '
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (invalid !== undefined) return { kind: 'invalid', error: invalid }
  return { kind: 'valid', objective, options }
}

export type BudgetInput = { kind: 'off' } | { kind: 'value'; value: number } | { kind: 'invalid' }

export function parseBudgetInput(raw: string): BudgetInput {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'off') return { kind: 'off' }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' }
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(value) || value <= 0) return { kind: 'invalid' }
  return { kind: 'value', value }
}

export function parseToggle(raw: string): boolean | undefined {
  const value = raw.trim().toLowerCase()
  if (value === 'on') return true
  if (value === 'off') return false
  return undefined
}
