import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { SessionManager, type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import { DeliveryJournal, type DeliveryInput } from '../src/delivery.ts'

function harness() {
  const sessionManager = SessionManager.inMemory()
  const sent: Array<{
    message: Parameters<ExtensionAPI['sendMessage']>[0]
    options: Parameters<ExtensionAPI['sendMessage']>[1]
  }> = []
  const host: Pick<ExtensionAPI, 'appendEntry' | 'sendMessage'> = {
    appendEntry: (type, data) => {
      sessionManager.appendCustomEntry(type, data)
    },
    sendMessage: (message, options) => {
      sent.push({ message, options })
    },
  }
  const journal = new DeliveryJournal(host)
  journal.restore({ sessionManager })
  const input: DeliveryInput = {
    agentId: 'child',
    content: 'A dependency changed.',
    customType: 'subagent-intercom',
    display: true,
    kind: 'notice',
    level: 'warning',
    ownerSessionId: sessionManager.getSessionId(),
    runGeneration: 1,
  }
  return { host, input, journal, sent, sessionManager }
}

describe('parent delivery journal', () => {
  it('persists before steering and distinguishes queued from context delivery', () => {
    const h = harness()
    const queued = h.journal.enqueue(h.input)
    expect(queued.state).toBe('queued')
    expect(queued.deliveredAt).toBeUndefined()
    expect(h.sessionManager.getEntries()).toHaveLength(1)
    expect(h.sent[0]?.options).toEqual({ deliverAs: 'steer', triggerTurn: true })
    const messages = h.journal.context([], () => true)
    expect(messages).toHaveLength(1)
    expect(h.journal.get(queued.id)?.state).toBe('delivered')
    expect(h.journal.get(queued.id)?.deliveredAt).toBeGreaterThanOrEqual(queued.sentAt)
    expect(h.journal.context(messages, () => true)).toHaveLength(1)
  })

  it('deduplicates exact notices but preserves changed warnings', () => {
    const h = harness()
    const first = h.journal.enqueue(h.input)
    expect(h.journal.enqueue(h.input).id).toBe(first.id)
    expect(h.journal.enqueue({ ...h.input, content: 'A second dependency changed.' }).id).not.toBe(
      first.id,
    )
    expect(h.sent).toHaveLength(2)
  })

  it('recovers an undelivered notice without starting a turn on restore', () => {
    const h = harness()
    const first = h.journal.enqueue(h.input)
    const restored = new DeliveryJournal(h.host)
    restored.restore(h)
    expect(h.sent).toHaveLength(1)
    expect(restored.context([], () => true)).toHaveLength(1)
    expect(restored.get(first.id)?.state).toBe('delivered')
  })

  it('suppresses stale generations and acknowledged completions', () => {
    const h = harness()
    const stale = h.journal.enqueue(h.input)
    expect(h.journal.context([], () => false)).toEqual([])
    expect(h.journal.get(stale.id)?.state).toBe('superseded')
    const completion = h.journal.enqueue({ ...h.input, kind: 'completion' })
    expect(h.journal.acknowledge(completion.id)).toBe(true)
    expect(h.journal.context([], () => true)).toEqual([])
  })

  it('does not replay summarized notices but retains undelivered warnings', () => {
    const h = harness()
    h.journal.enqueue(h.input)
    const messages = h.journal.context([], () => true)
    h.journal.compact()
    expect(h.journal.context([], () => true)).toEqual([])
    expect(h.journal.context(messages, () => true)).toHaveLength(1)
    h.journal.enqueue({ ...h.input, content: 'Not delivered before compaction.' })
    h.journal.compact()
    expect(h.journal.context([], () => true)).toHaveLength(1)
  })

  it('fences another owner and deduplicates repeated context messages', () => {
    const h = harness()
    h.journal.enqueue(h.input)
    const messages = h.journal.context([], () => true)
    expect(h.journal.context([...messages, ...messages], () => true)).toHaveLength(1)
    h.sessionManager.newSession()
    h.journal.restore(h)
    expect(h.journal.context(messages, () => true)).toEqual([])
    expect(() => h.journal.enqueue(h.input)).toThrow('owner is stale')
  })

  it('retains dispatch errors and recovers them at the next context boundary', () => {
    const h = harness()
    const journal = new DeliveryJournal({
      ...h.host,
      sendMessage: () => {
        throw new Error('Dispatch unavailable')
      },
    })
    journal.restore(h)
    const receipt = journal.enqueue(h.input)
    expect(receipt).toMatchObject({ error: 'Dispatch unavailable', state: 'queued' })
    expect(journal.context([], () => true)).toHaveLength(1)
    expect(journal.get(receipt.id)?.state).toBe('delivered')
  })

  it('bounds pending notices without dropping accepted messages', () => {
    const h = harness()
    h.journal.pause()
    for (let index = 0; index < 256; index += 1)
      h.journal.enqueue({ ...h.input, content: `Notice ${index}` })
    expect(() => h.journal.enqueue(h.input)).toThrow('inbox is full')
    expect(h.sent).toHaveLength(0)
    expect(h.journal.context([], () => true)).toHaveLength(256)
  })

  it('records completion overflow without turning successful work into a failure', () => {
    const h = harness()
    h.journal.pause()
    for (let index = 0; index < 256; index += 1)
      h.journal.enqueue({ ...h.input, content: `Notice ${index}` })
    const completion = h.journal.enqueue({
      ...h.input,
      kind: 'completion',
      content: 'Completed work',
      status: 'success',
    })
    expect(completion).toMatchObject({
      state: 'failed',
      status: 'success',
      content: 'Completed work',
    })
    expect(completion.error).toContain('inbox is full')
    expect(h.journal.get(completion.id)).toEqual(completion)
    expect(h.journal.context([], () => true)).toHaveLength(256)
    expect(h.sent).toHaveLength(0)
  })

  it('keeps unresolved deliveries and suppresses pruned acknowledgments', () => {
    const h = harness()
    const resolved = h.journal.enqueue(h.input)
    const transcript = h.journal.context([], () => true)
    h.journal.acknowledge(resolved.id)
    const unresolved = h.journal.enqueue({ ...h.input, content: 'Still needs acknowledgment' })
    h.journal.context([], () => true)
    for (let index = 0; index < 513; index += 1) {
      const next = h.journal.enqueue({ ...h.input, content: `Settled ${index}` })
      h.journal.acknowledge(next.id)
    }
    expect(h.journal.get(resolved.id)).toBeUndefined()
    expect(h.journal.context(transcript, () => true)).toHaveLength(1)
    expect(h.journal.get(unresolved.id)?.state).toBe('delivered')
    expect(h.journal.acknowledge(unresolved.id)).toBe(true)
    expect(h.journal.context(transcript, () => true)).toEqual([])
    expect(h.journal.list().length).toBeLessThanOrEqual(512)
  })

  it('cancels pending notices without claiming model acknowledgment', () => {
    const h = harness()
    const first = h.journal.enqueue(h.input)
    const messages: AgentMessage[] = h.journal.context([], () => true)
    h.journal.settleAgent('child', undefined, 'cancelled')
    expect(h.journal.context(messages, () => true)).toEqual([])
    expect(h.journal.get(first.id)?.state).toBe('cancelled')
    expect(h.journal.acknowledge(first.id)).toBe(false)
  })
})
