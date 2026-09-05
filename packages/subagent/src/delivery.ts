import { randomUUID } from 'node:crypto'

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const ENTRY_TYPE = 'pi-subagent-delivery'
const MAX_PENDING = 256
const MAX_HISTORY = 512

const DeliverySchema = Type.Object({
  agentId: Type.String(),
  content: Type.String(),
  customType: Type.String(),
  deliveredAt: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
  detail: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  status: Type.Optional(
    Type.Union([Type.Literal('success'), Type.Literal('error'), Type.Literal('aborted')]),
  ),
  display: Type.Boolean(),
  id: Type.String(),
  kind: Type.Union([Type.Literal('notice'), Type.Literal('completion'), Type.Literal('request')]),
  level: Type.Union([Type.Literal('info'), Type.Literal('warning'), Type.Literal('error')]),
  ownerSessionId: Type.String(),
  queuedAt: Type.Number(),
  requestId: Type.Optional(Type.String()),
  runGeneration: Type.Number(),
  sentAt: Type.Number(),
  settledAt: Type.Optional(Type.Number()),
  state: Type.Union([
    Type.Literal('queued'),
    Type.Literal('delivered'),
    Type.Literal('acknowledged'),
    Type.Literal('superseded'),
    Type.Literal('cancelled'),
    Type.Literal('failed'),
  ]),
})

const ReferenceSchema = Type.Object({
  deliveryId: Type.String(),
  ownerSessionId: Type.String(),
})

export type DeliveryRecord = Static<typeof DeliverySchema>
export type DeliveryInput = Pick<
  DeliveryRecord,
  | 'agentId'
  | 'content'
  | 'customType'
  | 'display'
  | 'kind'
  | 'level'
  | 'ownerSessionId'
  | 'requestId'
  | 'runGeneration'
  | 'detail'
  | 'title'
  | 'status'
>

export function deliveryReference<Input>(value: Input) {
  return Value.Check(ReferenceSchema, value) ? value : undefined
}

function details(record: DeliveryRecord) {
  return {
    agentId: record.agentId,
    deliveredAt: record.deliveredAt,
    deliveryId: record.id,
    kind:
      record.kind === 'notice'
        ? 'notification'
        : record.kind === 'completion'
          ? 'subagent'
          : record.kind,
    detail: record.detail,
    title: record.title,
    taskId: record.agentId,
    status: record.status,
    level: record.level,
    message: record.content,
    ownerSessionId: record.ownerSessionId,
    queuedAt: record.queuedAt,
    requestId: record.requestId,
    runGeneration: record.runGeneration,
    sentAt: record.sentAt,
  }
}

function message(record: DeliveryRecord): AgentMessage {
  const content =
    record.kind === 'notice'
      ? `<subagent-notice agent-id="${record.agentId}" level="${record.level}">\n${record.content}\n</subagent-notice>`
      : record.content
  return {
    content,
    customType: record.customType,
    details: details(record),
    display: record.display,
    role: 'custom',
    timestamp: record.sentAt,
  }
}

export class DeliveryJournal {
  private records = new Map<string, DeliveryRecord>()
  private owner = ''
  private compactedAt = 0
  private paused = false
  private wakeTimer: ReturnType<typeof setTimeout> | undefined
  private dispatched = new Set<string>()

  constructor(
    private readonly pi: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage'>,
    private readonly onRetain?: (agentId: string, retained: boolean) => void,
  ) {}

  unresolvedAgentIds(): string[] {
    return [
      ...new Set(
        [...this.records.values()]
          .filter((record) => record.state === 'queued' || record.state === 'delivered')
          .map((record) => record.agentId),
      ),
    ]
  }

  restore(ctx: Pick<ExtensionContext, 'sessionManager'>): void {
    this.pause()
    this.paused = false
    this.dispatched.clear()
    this.owner = ctx.sessionManager.getSessionId()
    this.records.clear()
    this.compactedAt = 0
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === 'compaction') this.compactedAt = Date.parse(entry.timestamp)
      if (entry.type !== 'custom' || entry.customType !== ENTRY_TYPE) continue
      if (!Value.Check(DeliverySchema, entry.data)) continue
      if (entry.data.ownerSessionId !== this.owner) continue
      this.records.set(entry.data.id, entry.data)
    }
    this.prune()
  }

  ensureOwner(ctx: Pick<ExtensionContext, 'sessionManager'>): void {
    if (this.owner !== ctx.sessionManager.getSessionId()) this.restore(ctx)
  }

  get(id: string): DeliveryRecord | undefined {
    const record = this.records.get(id)
    return record === undefined ? undefined : { ...record }
  }

  list(agentId?: string): DeliveryRecord[] {
    return [...this.records.values()]
      .filter((record) => agentId === undefined || record.agentId === agentId)
      .map((record) => ({ ...record }))
  }

  enqueue(input: DeliveryInput): DeliveryRecord {
    if (input.ownerSessionId !== this.owner) throw new Error('The notification owner is stale.')
    const duplicate = [...this.records.values()].find(
      (record) =>
        record.agentId === input.agentId &&
        record.runGeneration === input.runGeneration &&
        record.kind === input.kind &&
        record.level === input.level &&
        record.content === input.content &&
        (record.state === 'queued' || record.state === 'delivered'),
    )
    if (duplicate !== undefined) return { ...duplicate }
    const full =
      [...this.records.values()].filter(
        (record) => record.state === 'queued' || record.state === 'delivered',
      ).length >= MAX_PENDING
    const overflow =
      'The parent notification inbox is full. Return a bounded handoff instead of sending more notices.'
    if (full && input.kind !== 'completion') throw new Error(overflow)
    const sentAt = Date.now()
    const record: DeliveryRecord = {
      ...input,
      id: randomUUID(),
      queuedAt: sentAt,
      sentAt,
      state: full ? 'failed' : 'queued',
    }
    if (full) record.error = overflow
    this.save(record)
    if (!this.paused && record.state === 'queued') this.dispatch(record)
    return this.get(record.id) ?? { ...record }
  }

  acknowledge(id: string): boolean {
    const record = this.records.get(id)
    if (record === undefined || record.state === 'cancelled' || record.state === 'superseded')
      return false
    if (record.state !== 'acknowledged')
      this.save({ ...record, settledAt: Date.now(), state: 'acknowledged' })
    return true
  }

  settleAgent(
    agentId: string,
    kind: DeliveryRecord['kind'] | undefined,
    state: 'acknowledged' | 'cancelled',
  ): void {
    for (const record of this.records.values()) {
      if (record.agentId !== agentId || (kind !== undefined && record.kind !== kind)) continue
      if (record.state !== 'queued' && record.state !== 'delivered') continue
      this.save({ ...record, settledAt: Date.now(), state })
    }
  }

  pause(): void {
    this.paused = true
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer)
    this.wakeTimer = undefined
  }

  resumeWhenIdle(ctx: Pick<ExtensionContext, 'isIdle' | 'sessionManager'>): void {
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer)
    const owner = this.owner
    const poll = (): void => {
      this.wakeTimer = undefined
      if (owner !== this.owner || ctx.sessionManager.getSessionId() !== owner) return
      if (!ctx.isIdle()) {
        this.wakeTimer = setTimeout(poll, 25)
        this.wakeTimer.unref()
        return
      }
      this.paused = false
      for (const record of this.records.values()) {
        if (record.state === 'queued' && !this.dispatched.has(record.id)) this.dispatch(record)
      }
    }
    this.wakeTimer = setTimeout(poll, 0)
    this.wakeTimer.unref()
  }

  compact(): void {
    this.compactedAt = Date.now()
  }

  context(messages: AgentMessage[], current: (record: DeliveryRecord) => boolean): AgentMessage[] {
    this.paused = false
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer)
    this.wakeTimer = undefined
    const seen = new Set<string>()
    const output: AgentMessage[] = []
    const include = (record: DeliveryRecord): boolean => {
      if (record.state !== 'queued' && record.state !== 'delivered') return false
      if (current(record)) return true
      this.save({ ...record, settledAt: Date.now(), state: 'superseded' })
      return false
    }
    for (const entry of messages) {
      const reference = entry.role === 'custom' ? deliveryReference(entry.details) : undefined
      if (reference === undefined) {
        output.push(entry)
        continue
      }
      if (reference.ownerSessionId !== this.owner || seen.has(reference.deliveryId)) continue
      seen.add(reference.deliveryId)
      const record = this.records.get(reference.deliveryId)
      if (record !== undefined && include(record)) {
        this.delivered(record)
        output.push(entry)
      }
    }
    for (const record of this.records.values()) {
      if (seen.has(record.id) || !include(record)) continue
      if (record.deliveredAt !== undefined && record.deliveredAt <= this.compactedAt) continue
      this.delivered(record)
      output.push(message(record))
    }
    return output
  }

  private dispatch(record: DeliveryRecord): void {
    const outgoing = message(record)
    if (outgoing.role !== 'custom') throw new Error('The notification message is invalid.')
    try {
      this.pi.sendMessage(outgoing, { deliverAs: 'steer', triggerTurn: true })
      this.dispatched.add(record.id)
    } catch (error) {
      this.save({ ...record, error: error instanceof Error ? error.message : String(error) })
    }
  }

  private delivered(record: DeliveryRecord): void {
    if (record.state === 'queued')
      this.save({ ...record, deliveredAt: Date.now(), state: 'delivered' })
  }

  private save(record: DeliveryRecord): void {
    const wasRetained = this.unresolvedAgentIds().includes(record.agentId)
    this.pi.appendEntry(ENTRY_TYPE, record)
    this.records.set(record.id, record)
    this.prune()
    const retained = this.unresolvedAgentIds().includes(record.agentId)
    if (retained !== wasRetained) this.onRetain?.(record.agentId, retained)
  }

  private prune(): void {
    const terminal = [...this.records.values()].filter(
      (record) => record.state !== 'queued' && record.state !== 'delivered',
    )
    for (const record of terminal.slice(0, Math.max(0, this.records.size - MAX_HISTORY))) {
      this.records.delete(record.id)
      this.dispatched.delete(record.id)
    }
  }
}
