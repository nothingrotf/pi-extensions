import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { SUBAGENT_EXECUTE_TASK_EVENT } from '@nothingrotf/subagent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

import type { DeliveryNextStep, ReviewRole } from './delivery-next.ts'
import type { DeliveryIssue } from './delivery.ts'

export const DELIVERY_ENGINE_TOOL = 'pstack_deliver'
export const DEFAULT_ENGINE_DISPATCHES = 8
const REPORT_LIMIT = 6000
const IDLE_STEP_LIMIT = 12

const id = Type.String({ minLength: 1, maxLength: 256 })
const model = Type.String({ minLength: 1, maxLength: 256 })

export const DeliveryEngineInputSchema = Type.Object(
  {
    issue: id,
    owner: Type.Object(
      {
        role: Type.Union(
          [
            Type.Literal('feature'),
            Type.Literal('refactoring'),
            Type.Literal('bug-fix'),
            Type.Literal('perf-issue'),
            Type.Literal('hillclimb'),
          ],
          { description: 'Implementation role whose model policy selects the owner.' },
        ),
        brief: Type.String({
          minLength: 1,
          description:
            'Complete owner brief: scope, constraints, reproduction, focused checks, and design references. The engine adds the delivery contract.',
        }),
        model: Type.Optional(model),
        capability_profile: Type.Optional(
          Type.Union([Type.Literal('pstack-leaf'), Type.Literal('pstack-nested')]),
        ),
      },
      { additionalProperties: false },
    ),
    review: Type.Object(
      {
        codeModel: Type.Optional(model),
        runtimeModel: Type.Optional(model),
        sandbox: Type.Optional(
          Type.Boolean({
            description:
              'Require an OS sandbox for runtime-verification commands. Unsupported hosts fail closed. The owner and static reviewer keep their existing profiles.',
          }),
        ),
        brief: Type.Optional(
          Type.String({
            minLength: 1,
            description:
              'Shared reviewer guidance, such as the acceptance surface and the focused commands to run.',
          }),
        ),
      },
      { additionalProperties: false },
    ),
    agent: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 128,
        description: 'subagent_type for every engine Task. Default: generalPurpose.',
      }),
    ),
    maxDispatches: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 })),
  },
  { additionalProperties: false },
)

export type DeliveryEngineInput = Static<typeof DeliveryEngineInputSchema>

interface EngineTaskFields {
  description: string
  prompt: string
  subagent_type: string
  delivery?: { kind: 'managed'; issue: string }
  role?: string
  capability_profile?: string
  readonly?: boolean
  model?: string
  resume?: string
}

export type EngineTask = EngineTaskFields & { run_in_background: false }
export type EngineNode = EngineTaskFields & { id: string }
export type EngineTaskInput = EngineTask | { tasks: EngineNode[] }

export interface EngineAgent {
  agentId: string
  status: string
}

export interface EngineDispatch {
  agents: readonly EngineAgent[]
  error: string | undefined
  text: string
}

export type EngineAction =
  | { action: 'record'; agentId: string }
  | { action: 'refresh'; agentId: string }
  | { action: 'workspace' }

export interface DeliveryEngineHost {
  checkpoint(): { issue: DeliveryIssue; next: DeliveryNextStep }
  deliver(action: EngineAction): Promise<string | undefined>
  dispatch(input: EngineTaskInput): Promise<EngineDispatch>
  now(): number
  readonly signal: AbortSignal | undefined
}

export type EngineStop =
  | 'accepted'
  | 'aborted'
  | 'dispatch-limit'
  | 'dispatch-rejected'
  | 'protocol-rejected'
  | 'repair-required'
  | 'running'
  | 'stalled'

export interface EngineStep {
  step: DeliveryNextStep['step']
  agents: readonly EngineAgent[]
  durationMs: number
  error: string | undefined
}

export interface DeliveryEngineResult {
  issue: string
  stop: EngineStop
  detail: string | undefined
  dispatches: number
  durationMs: number
  steps: readonly EngineStep[]
  next: DeliveryNextStep
}

function bounded(text: string): string {
  return text.length <= REPORT_LIMIT ? text : `${text.slice(0, REPORT_LIMIT)}\n[truncated]`
}

function section(title: string, text: string | undefined): string[] {
  return text === undefined ? [] : ['', `${title}:`, bounded(text)]
}

interface EngineMemory {
  owner: string | undefined
  review: string | undefined
  diagnosis: string | undefined
}

function unresolved(issue: DeliveryIssue, ids: readonly string[]): string {
  const descriptions = new Map(issue.criteria.map((entry) => [entry.id, entry.description]))
  return ids.map((entry) => `- ${entry}: ${descriptions.get(entry) ?? 'finding'}`).join('\n')
}

function openState(issue: DeliveryIssue, criteria: readonly string[], findings: readonly string[]) {
  return [
    ...(criteria.length > 0 ? ['', 'Unresolved criteria:', unresolved(issue, criteria)] : []),
    ...(findings.length > 0 ? ['', `Open findings: ${findings.join(', ')}`] : []),
  ]
}

function ownerTask(input: DeliveryEngineInput, prompt: string): EngineTask {
  const task: EngineTask = {
    capability_profile: input.owner.capability_profile ?? 'pstack-leaf',
    delivery: { issue: input.issue, kind: 'managed' },
    description: `Deliver ${input.issue}`,
    prompt,
    role: input.owner.role,
    run_in_background: false,
    subagent_type: input.agent ?? 'generalPurpose',
  }
  if (input.owner.model !== undefined) task.model = input.owner.model
  return task
}

export function reviewPrompt(role: ReviewRole, brief: string | undefined): string {
  return [
    role === 'runtime verification'
      ? 'Verify the current candidate in this directory against every criterion with focused executable checks. Do not change any tracked file.'
      : 'Review the current candidate in this directory statically against every criterion. Do not change any file.',
    'Give one complete verdict. Report each defect as a finding with evidence, and apply the blocking rule of the delivery packet.',
    ...(brief === undefined ? [] : ['', brief]),
  ].join('\n')
}

function reviewTask(input: DeliveryEngineInput, role: ReviewRole): EngineTaskFields {
  const runtime = role === 'runtime verification'
  const prompt = reviewPrompt(role, input.review.brief)
  const node: EngineTaskFields = {
    capability_profile: runtime && input.review.sandbox === true ? 'pstack-sandbox' : 'pstack-leaf',
    delivery: { issue: input.issue, kind: 'managed' },
    description: runtime ? `Verify ${input.issue}` : `Review ${input.issue}`,
    prompt,
    readonly: !runtime,
    role,
    subagent_type: input.agent ?? 'generalPurpose',
  }
  const selected = runtime ? input.review.runtimeModel : input.review.codeModel
  if (selected !== undefined) node.model = selected
  return node
}

function taskFor(
  input: DeliveryEngineInput,
  issue: DeliveryIssue,
  next: DeliveryNextStep,
  memory: EngineMemory,
  summary: { unresolvedCriteria: readonly string[]; unresolvedFindings: readonly string[] },
): EngineTaskInput | undefined {
  const state = openState(issue, summary.unresolvedCriteria, summary.unresolvedFindings)
  if (next.step === 'implement') return ownerTask(input, input.owner.brief)
  if (next.step === 'review') {
    const [only] = next.roles
    if (next.roles.length === 1 && only !== undefined)
      return { ...reviewTask(input, only), run_in_background: false }
    return {
      tasks: next.roles.map((role) => ({
        ...reviewTask(input, role),
        id: role === 'runtime verification' ? 'runtime' : 'static',
      })),
    }
  }
  if (next.step === 'diagnose') {
    return {
      capability_profile: 'pstack-leaf',
      delivery: { issue: input.issue, kind: 'managed' },
      description: `Diagnose ${input.issue}`,
      prompt: [
        `Diagnose why the delivery of ${input.issue} does not converge. ${next.instruction}`,
        'Return the cause, a bounded correction proposal, and a regression test plan. Do not change any file.',
        ...section('Owner brief', input.owner.brief),
        ...state,
        ...section('Latest owner report', memory.owner),
        ...section('Latest review reports', memory.review),
      ].join('\n'),
      readonly: true,
      role: 'hardest tasks',
      run_in_background: false,
      subagent_type: input.agent ?? 'generalPurpose',
    }
  }
  if (next.step !== 'correct') return undefined
  const verdict = memory.review === undefined ? [] : section('Independent review', memory.review)
  if (next.resume !== null) {
    return {
      description: `Correct ${input.issue}`,
      prompt: [
        memory.review === undefined
          ? 'Continue the delivery. Your last report left the issue incomplete.'
          : 'Independent review rejected the current candidate. Correct every open finding.',
        'Resolve each unresolved criterion, rerun the affected checks, and return a new report.',
        ...state,
        ...verdict,
      ].join('\n'),
      resume: next.resume,
      run_in_background: false,
      subagent_type: input.agent ?? 'generalPurpose',
    }
  }
  return ownerTask(
    input,
    [
      input.owner.brief,
      '',
      'A previous owner did not reach acceptance. Its work remains in this checkout when an issue workspace exists.',
      ...state,
      ...verdict,
      ...section('Diagnosis', memory.diagnosis),
    ].join('\n'),
  )
}

function remember(memory: EngineMemory, step: DeliveryNextStep['step'], text: string): void {
  if (step === 'review') memory.review = text
  else if (step === 'diagnose') memory.diagnosis = text
  else {
    memory.owner = text
    memory.review = undefined
  }
}

export async function runDeliveryEngine(
  input: DeliveryEngineInput,
  host: DeliveryEngineHost,
  summarize: (issue: DeliveryIssue) => {
    unresolvedCriteria: readonly string[]
    unresolvedFindings: readonly string[]
  },
): Promise<DeliveryEngineResult> {
  const started = host.now()
  const limit = input.maxDispatches ?? DEFAULT_ENGINE_DISPATCHES
  const steps: EngineStep[] = []
  const memory: EngineMemory = { diagnosis: undefined, owner: undefined, review: undefined }
  let dispatches = 0
  let idle = 0
  const finish = (
    stop: EngineStop,
    next: DeliveryNextStep,
    detail?: string,
  ): DeliveryEngineResult => ({
    detail,
    dispatches,
    durationMs: host.now() - started,
    issue: input.issue,
    next,
    steps,
    stop,
  })
  for (;;) {
    const { issue, next } = host.checkpoint()
    if (host.signal?.aborted === true) return finish('aborted', next)
    if (next.step === 'publish') return finish('accepted', next)
    if (next.step === 'wait') return finish('running', next, next.agentIds.join(', '))
    if (next.step === 'repair')
      return finish('repair-required', next, `${next.agentId} attempt ${next.attempt}`)
    const stepStarted = host.now()
    if (next.step === 'record' || next.step === 'workspace' || next.step === 'refresh') {
      idle += 1
      if (idle > IDLE_STEP_LIMIT)
        return finish('stalled', next, `The ${next.step} step repeated without progress.`)
      const actions: EngineAction[] =
        next.step === 'record'
          ? next.agentIds.map((agentId) => ({ action: 'record', agentId }))
          : next.step === 'refresh'
            ? [{ action: 'refresh', agentId: next.agentId }]
            : [{ action: 'workspace' }]
      for (const action of actions) {
        const error = await host.deliver(action)
        const agents = 'agentId' in action ? [{ agentId: action.agentId, status: 'recorded' }] : []
        steps.push({ agents, durationMs: host.now() - stepStarted, error, step: next.step })
        if (error !== undefined) return finish('protocol-rejected', next, error)
      }
      continue
    }
    idle = 0
    if (dispatches >= limit)
      return finish('dispatch-limit', next, `The engine dispatched ${limit} Tasks.`)
    const task = taskFor(input, issue, next, memory, summarize(issue))
    if (task === undefined) return finish('stalled', next, `No dispatch exists for ${next.step}.`)
    dispatches += 1
    const outcome = await host.dispatch(task)
    steps.push({
      agents: outcome.agents,
      durationMs: host.now() - stepStarted,
      error: outcome.error,
      step: next.step,
    })
    if (outcome.agents.length === 0)
      return finish('dispatch-rejected', next, outcome.error ?? 'No Task started.')
    remember(memory, next.step, outcome.text)
  }
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

export function renderEngineResult(result: DeliveryEngineResult, checkpoint: string): string {
  const lines = [
    `Engine stop: ${result.stop}${result.detail === undefined ? '' : ` - ${result.detail}`}`,
    `Dispatches: ${result.dispatches}. Duration: ${seconds(result.durationMs)}.`,
    'Steps:',
    ...result.steps.map((step, index) => {
      const agents = step.agents.map((agent) => `${agent.agentId} ${agent.status}`).join(', ')
      const error = step.error === undefined ? '' : ` error: ${step.error}`
      return `${index + 1}. ${step.step} (${seconds(step.durationMs)})${agents === '' ? '' : ` ${agents}`}${error}`
    }),
    '',
    `Checkpoint: ${checkpoint}`,
  ]
  return lines.join('\n')
}

const TaskResponseSchema = Type.Union([
  Type.Object({ error: Type.String() }, { additionalProperties: false }),
  Type.Object(
    {
      result: Type.Object(
        {
          content: Type.Array(
            Type.Object(
              { type: Type.String(), text: Type.Optional(Type.String()) },
              { additionalProperties: true },
            ),
          ),
          details: Type.Unknown(),
        },
        { additionalProperties: true },
      ),
    },
    { additionalProperties: false },
  ),
])

export type TaskResponse = Static<typeof TaskResponseSchema>

export function requestTask(
  pi: Pick<ExtensionAPI, 'events'>,
  toolCallId: string,
  input: EngineTaskInput,
  signal: AbortSignal | undefined,
): Promise<TaskResponse> {
  return new Promise((resolve) => {
    let cancel: (() => void) | undefined
    let settled = false
    const abort = () => cancel?.()
    const settle = (response: TaskResponse) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      resolve(response)
    }
    const respond = <Response>(value: Response) => {
      settle(
        Value.Check(TaskResponseSchema, value)
          ? value
          : { error: 'The subagent returned an invalid Task response.' },
      )
    }
    pi.events.emit(SUBAGENT_EXECUTE_TASK_EVENT, {
      accept(handler: () => void) {
        cancel = handler
      },
      input,
      respond,
      toolCallId,
      version: 1,
    })
    if (settled) return
    if (cancel === undefined) {
      settle({
        error:
          'The subagent extension did not accept the engine Task. Update @nothingrotf/subagent.',
      })
      return
    }
    if (signal?.aborted === true) cancel()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}
