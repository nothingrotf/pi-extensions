export type GoalSubcommand = 'set' | 'show' | 'pause' | 'resume' | 'drop' | 'budget'

export const goalSubcommands: readonly GoalSubcommand[] = [
  'set',
  'show',
  'pause',
  'resume',
  'drop',
  'budget',
]

function toSubcommand(value: string): GoalSubcommand | undefined {
  return goalSubcommands.find((candidate) => candidate === value)
}

export function parseGoalSubcommand(args: string): {
  sub: GoalSubcommand | undefined
  rest: string
} {
  const trimmed = args.trim()
  if (trimmed.length === 0) {
    return { sub: undefined, rest: '' }
  }
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (match === null) {
    return { sub: undefined, rest: trimmed }
  }
  const sub = toSubcommand((match[1] ?? '').toLowerCase())
  if (sub === undefined) {
    return { sub: undefined, rest: trimmed }
  }
  return { sub, rest: match[2]?.trim() ?? '' }
}

export type BudgetInput = { kind: 'off' } | { kind: 'value'; value: number } | { kind: 'invalid' }

export function parseBudgetInput(raw: string): BudgetInput {
  const trimmed = raw.trim().toLowerCase()
  if (trimmed === 'off') {
    return { kind: 'off' }
  }
  if (!/^\d+$/.test(trimmed)) {
    return { kind: 'invalid' }
  }
  const value = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(value) || value <= 0) {
    return { kind: 'invalid' }
  }
  return { kind: 'value', value }
}
