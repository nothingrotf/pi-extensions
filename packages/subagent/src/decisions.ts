import { randomUUID } from 'node:crypto'

import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

import { type DeliveryJournal } from './delivery.ts'
import { redactSensitiveText } from './intercom.ts'
import type { SubagentHandle } from './runtime.ts'

interface PendingDecision {
  agentId: string
  deliveryId: string
  handle: SubagentHandle
  reject: (reason: Error) => void
  resolve: (answer: string) => void
}

export interface DecisionReceipt {
  outcome: 'answered' | 'rejected'
  reason: 'not-pending' | 'stale-owner' | 'empty' | null
  requestId: string
}

export class ParentDecisions {
  private pending = new Map<string, PendingDecision>()

  constructor(
    private readonly deliveries: DeliveryJournal,
    private readonly timeoutMs = 300_000,
  ) {}

  async request(handle: SubagentHandle, question: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error('The parent decision request was cancelled.')
    if ([...this.pending.values()].some((request) => request.agentId === handle.agentId)) {
      throw new Error('The child already has a pending parent decision.')
    }
    const requestId = randomUUID()
    const response = Promise.withResolvers<string>()
    const delivery = this.deliveries.enqueue({
      agentId: handle.agentId,
      content: [
        `Parent decision requested by Task ${handle.agentId}. Request ID: ${requestId}.`,
        'The child is waiting. Reply with TaskControl action="reply", agent_id, request_id, and message.',
        'Preserve the user authorization boundary. Deny requests that exceed the authorized scope.',
        `Question: ${redactSensitiveText(question)}`,
      ].join('\n'),
      customType: 'subagent-intercom',
      display: true,
      kind: 'request',
      level: 'warning',
      ownerSessionId: handle.ownerSessionId,
      requestId,
      runGeneration: handle.runGeneration,
    })
    this.pending.set(requestId, {
      agentId: handle.agentId,
      deliveryId: delivery.id,
      handle,
      reject: response.reject,
      resolve: response.resolve,
    })
    const abort = () => response.reject(new Error('The parent decision request was cancelled.'))
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(
      () =>
        response.reject(
          new Error(
            'The parent did not answer before the decision deadline. No authorization was granted.',
          ),
        ),
      this.timeoutMs,
    )
    try {
      if (signal.aborted) abort()
      return await response.promise
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      this.pending.delete(requestId)
      const state = this.deliveries.get(delivery.id)?.state
      if (state === 'queued' || state === 'delivered')
        this.deliveries.settleAgent(handle.agentId, 'request', 'cancelled')
    }
  }

  reply(
    agentId: string,
    requestId: string,
    answer: string,
    current: (handle: SubagentHandle) => boolean,
  ): DecisionReceipt {
    const pending = this.pending.get(requestId)
    if (pending === undefined || pending.agentId !== agentId)
      return { outcome: 'rejected', reason: 'not-pending', requestId }
    if (!current(pending.handle)) return { outcome: 'rejected', reason: 'stale-owner', requestId }
    const text = answer.trim()
    if (text.length === 0) return { outcome: 'rejected', reason: 'empty', requestId }
    this.deliveries.acknowledge(pending.deliveryId)
    this.pending.delete(requestId)
    pending.resolve(redactSensitiveText(text))
    return { outcome: 'answered', reason: null, requestId }
  }
}

export function createDecisionTool(
  request: (question: string, signal?: AbortSignal) => Promise<string>,
) {
  return defineTool({
    name: 'request_parent',
    label: 'Request Parent Decision',
    description:
      'Request an explicit decision from the real root coordinator. Only direct background Tasks can wait for a reply. Foreground or nested Tasks must return their unresolved decision in the handoff instead.',
    parameters: Type.Object({ question: Type.String({ minLength: 1, maxLength: 4000 }) }),
    promptSnippet: 'Request a real coordinator decision for a direct background Task.',
    promptGuidelines: [
      'Use request_parent for scope changes, conflicting instructions, and authorization decisions. Advisory ask_parent replies never grant authorization.',
      'Do not perform the requested change before request_parent returns an explicit authorization. A timeout or error grants no authorization.',
    ],
    async execute(_id, input, signal) {
      const answer = await request(input.question, signal)
      return { content: [{ text: answer, type: 'text' }], details: { source: 'root-coordinator' } }
    },
  })
}
