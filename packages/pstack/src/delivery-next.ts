import { isImplementationRole } from './delivery-roles.ts'
import {
  currentDeliveryReport,
  type DeliveryIssue,
  type DeliverySubmission,
  reviewEndorsesCandidate,
  sameDeliveryArtifact,
  summarizeDelivery,
} from './delivery.ts'

export type ReviewRole = 'code review' | 'runtime verification'

export type DeliveryNextStep =
  | { step: 'record'; agentIds: string[]; instruction: string }
  | { step: 'wait'; agentIds: string[]; instruction: string }
  | { step: 'workspace'; instruction: string }
  | { step: 'diagnose'; role: 'hardest tasks'; instruction: string }
  | { step: 'implement'; instruction: string }
  | { step: 'correct'; resume: string | null; instruction: string }
  | { step: 'review'; roles: ReviewRole[]; instruction: string }
  | { step: 'refresh'; agentId: string; instruction: string }
  | { step: 'publish'; instruction: string }

export interface DeliveryNextContext {
  running: readonly string[]
  unrecorded: readonly string[]
  workspace: boolean
}

const reviewKinds: ReadonlyMap<string, ReviewRole> = new Map([
  ['technical-review', 'code review'],
  ['runtime-verification', 'runtime verification'],
])

function isImplementation(submission: DeliverySubmission): boolean {
  return (
    currentDeliveryReport(submission).kind === 'implementation' &&
    isImplementationRole(submission.role)
  )
}

function currentReviews(
  issue: DeliveryIssue,
  candidate: DeliverySubmission,
): Map<ReviewRole, DeliverySubmission> {
  const authors = new Set(issue.submissions.filter(isImplementation).map((entry) => entry.agentId))
  const reviews = new Map<ReviewRole, DeliverySubmission>()
  const artifact = candidate.artifact
  if (artifact === undefined) return reviews
  for (const submission of issue.submissions.slice(issue.submissions.indexOf(candidate) + 1)) {
    const role = reviewKinds.get(currentDeliveryReport(submission).kind)
    if (
      role === undefined ||
      submission.role !== role ||
      authors.has(submission.agentId) ||
      submission.execution !== 'completed' ||
      submission.artifact === undefined ||
      !sameDeliveryArtifact(artifact, submission.artifact)
    )
      continue
    reviews.set(role, submission)
  }
  return reviews
}

export function nextDeliveryStep(
  issue: DeliveryIssue,
  context: DeliveryNextContext,
): DeliveryNextStep {
  if (context.unrecorded.length > 0) {
    return {
      step: 'record',
      agentIds: [...context.unrecorded],
      instruction: 'Call pstack_delivery record for each agent, then follow the new next step.',
    }
  }
  if (context.running.length > 0) {
    return {
      step: 'wait',
      agentIds: [...context.running],
      instruction:
        'Do independent work first. Then call TaskControl wait once for these agents, and record each one when it settles.',
    }
  }
  const summary = summarizeDelivery(issue)
  if (summary.diagnosisRequired) {
    return {
      step: 'diagnose',
      role: 'hardest tasks',
      instruction:
        'Dispatch one read-only hardest tasks diagnosis with the artifact, open findings, failed correction, and reproduction. Give its cause to the next owner.',
    }
  }
  const candidate = issue.submissions.findLast(isImplementation)
  if (summary.state === 'accepted') {
    if (summary.integration !== 'integrated' && candidate !== undefined) {
      return {
        step: 'refresh',
        agentId: candidate.agentId,
        instruction: 'Join the accepted owner Task, then call pstack_delivery refresh for it.',
      }
    }
    return {
      step: 'publish',
      instruction:
        'Dispatch one foreground publication Task with role publication for commit, push, and PR text.',
    }
  }
  if (candidate === undefined) {
    if (!context.workspace) {
      return {
        step: 'workspace',
        instruction:
          'Call pstack_delivery workspace for this issue, then dispatch the implementation owner. Skip the workspace only when the issue changes no repository.',
      }
    }
    return {
      step: 'implement',
      instruction:
        'Dispatch one implementation owner in the background with the per-issue fields and acceptance criteria.',
    }
  }
  if (summary.state === 'candidate') {
    const reviews = currentReviews(issue, candidate)
    const rejected = [...reviews.values()].some((review) => !reviewEndorsesCandidate(issue, review))
    const roles: ReviewRole[] = []
    if (!reviews.has('code review')) roles.push('code review')
    if (issue.runtimeRequired && !reviews.has('runtime verification'))
      roles.push('runtime verification')
    if (!rejected && roles.length > 0) {
      return {
        step: 'review',
        roles,
        instruction:
          roles.length > 1
            ? 'Dispatch both reviewers in one Task.tasks batch on the current candidate, then wait once for the pair.'
            : `Dispatch one ${roles[0]} Task on the current candidate.`,
      }
    }
  }
  const diagnosed = issue.submissions
    .slice(issue.submissions.indexOf(candidate) + 1)
    .some((submission) => currentDeliveryReport(submission).kind === 'diagnosis')
  const resume =
    context.workspace && candidate.execution === 'completed' && !diagnosed
      ? candidate.agentId
      : null
  return {
    step: 'correct',
    resume,
    instruction:
      resume === null
        ? `Dispatch a fresh implementation owner with the consolidated scope, the open findings, and the unresolved criteria${diagnosed ? ', and the recorded diagnosis' : ''}.`
        : 'Resume the recorded owner with the verdict, the open findings, the unresolved criteria, and every new directive.',
  }
}
