const leadingDuration =
  /^(?:for\s+)?(?:\d+(?:\.\d+)?\s*(?:ms|s|m|h|d|w)|\d+(?:\.\d+)?\s*(?:milliseconds?|seconds?|minutes?|hours?|days?|weeks?))\b[\s,:-]*/i
const recurring = /\bevery\b/i

export type GoalCommandInput =
  | { kind: 'empty' }
  | { kind: 'control'; control: 'status' | 'pause' | 'resume' | 'clear' }
  | { kind: 'recurring' }
  | { kind: 'objective'; objective: string; removedTimeLimit: boolean }

export function parseGoalCommand(input: string): GoalCommandInput {
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    return { kind: 'empty' }
  }
  if (trimmed === 'status' || trimmed === 'pause' || trimmed === 'resume' || trimmed === 'clear') {
    return { kind: 'control', control: trimmed }
  }
  if (recurring.test(trimmed)) {
    return { kind: 'recurring' }
  }
  const withoutTimeLimit = trimmed.replace(leadingDuration, '').trim()
  if (withoutTimeLimit.length === 0) {
    return { kind: 'empty' }
  }
  return {
    kind: 'objective',
    objective: withoutTimeLimit,
    removedTimeLimit: withoutTimeLimit !== trimmed,
  }
}
