import { escapeXmlText } from './prompts.ts'
import type { GoalModeState, GoalVerdictRecord } from './state.ts'

const replanPrompt =
  'Several attempts did not converge. Stop incremental patching. Re-read the objective, inspect current state, derive a new plan, and use a different approach.'

export type GoalReviewDecision =
  | { action: 'pass'; summary: string }
  | { action: 'stuck'; reason: string }
  | { action: 'continue'; coderPrompt: string; replan: boolean }

export function normalizeVerdictReason(value: string): string {
  return value
    .toLowerCase()
    .replace(/:\d+(?:-\d+)?/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

function fingerprintText(value: string): string {
  return value
    .toLowerCase()
    .replace(/:\d+(?:-\d+)?/g, '')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-400)
}

function verdictFingerprint(verdict: GoalVerdictRecord): string {
  return [verdict.reason, ...verdict.evidence.slice(0, 3)].map(fingerprintText).join('|')
}

export function isVerdictOscillating(history: readonly GoalVerdictRecord[]): boolean {
  if (history.length < 3) return false
  const latest = history.at(-1)
  const previous = history.at(-2)
  const first = history.at(-3)
  if (latest === undefined || previous === undefined || first === undefined) return false
  if (latest.status === 'PASS' || latest.status !== previous.status) return false
  if (latest.status !== first.status) return false
  const latestFingerprint = verdictFingerprint(latest)
  const previousFingerprint = verdictFingerprint(previous)
  return (
    latestFingerprint.length > 0 &&
    latestFingerprint === previousFingerprint &&
    latestFingerprint === verdictFingerprint(first)
  )
}

function verdictLine(verdict: GoalVerdictRecord): string {
  return `${verdict.status}: ${verdict.reason}`
}

function currentFeedback(verdict: GoalVerdictRecord): string {
  const lines = [verdictLine(verdict)]
  if (verdict.evidence.length > 0) {
    lines.push('Evidence:')
    for (const evidence of verdict.evidence.slice(0, 12)) lines.push(`- ${evidence}`)
  }
  const checks = verdict.checks.filter(
    (check) => check.status === 'failed' || check.status === 'unavailable',
  )
  if (checks.length > 0) {
    lines.push('Checks:')
    for (const check of checks) {
      lines.push(
        `- ${check.label}: ${check.status}${check.command === undefined ? '' : ` (${check.command})`}`,
      )
      if (check.output !== undefined) lines.push(check.output.slice(-800))
    }
  }
  return lines.join('\n').slice(0, 8_000)
}

export function buildCoderPrompt(state: GoalModeState, verdict: GoalVerdictRecord): string {
  const blocks = [
    `Goal loop iteration ${state.loop.iteration}/${state.loop.maxIterations}.`,
    `<objective>\n${escapeXmlText(state.goal.objective)}\n</objective>`,
    `<review_feedback>\n${escapeXmlText(currentFeedback(verdict))}\n</review_feedback>`,
  ]
  const prior = state.loop.verdictHistory.slice(0, -1)
  if (prior.length > 0) {
    const history = prior.map((item, index) => `${index + 1}. ${verdictLine(item)}`).join('\n')
    blocks.push(`<prior_verdicts>\n${escapeXmlText(history)}\n</prior_verdicts>`)
  }
  const steering = [...(state.loop.userSteering ?? []), ...state.loop.pendingSteering]
  if (steering.length > 0) {
    blocks.push(`<user_steering>\n${escapeXmlText(steering.join('\n'))}\n</user_steering>`)
  }
  blocks.push(
    'Fix every reviewer finding without regressions. Verify the full objective. Finish the turn normally. An independent reviewer will check again.',
  )
  if (state.loop.iteration >= Math.min(4, state.loop.maxIterations - 1)) {
    blocks.push(replanPrompt)
  }
  return blocks.join('\n\n')
}

export function decideGoalReview(
  state: GoalModeState,
  verdict: GoalVerdictRecord,
): GoalReviewDecision {
  if (verdict.status === 'PASS') return { action: 'pass', summary: verdict.reason }
  if (state.goal.tokenBudget !== undefined && state.goal.tokensUsed >= state.goal.tokenBudget) {
    return {
      action: 'stuck',
      reason: `Token budget exhausted (${state.goal.tokensUsed}/${state.goal.tokenBudget}). Last verdict: ${verdictLine(verdict)}`,
    }
  }
  const reviewsSinceResume = state.loop.iteration - (state.loop.convergenceStart ?? 0)
  const recentHistory =
    reviewsSinceResume > 0 ? state.loop.verdictHistory.slice(-reviewsSinceResume) : []
  if (
    isVerdictOscillating(recentHistory) &&
    (state.loop.reviewFallbackModel === undefined ||
      verdict.reviewerModel === state.loop.reviewFallbackModel)
  ) {
    return {
      action: 'stuck',
      reason: `The same review failure survived two consecutive fixes: ${verdict.reason}`,
    }
  }
  if (state.loop.iteration >= state.loop.maxIterations) {
    return {
      action: 'stuck',
      reason: `Iteration cap reached (${state.loop.maxIterations}). Last verdict: ${verdictLine(verdict)}`,
    }
  }
  return {
    action: 'continue',
    coderPrompt: buildCoderPrompt(state, verdict),
    replan: state.loop.iteration >= Math.min(4, state.loop.maxIterations - 1),
  }
}
