import { getEventListeners } from 'node:events'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it, vi } from 'vite-plus/test'

import { ParentDecisions } from '../src/decisions.ts'
import { DeliveryJournal } from '../src/delivery.ts'

function harness(timeoutMs = 1000) {
  const sessionManager = SessionManager.inMemory()
  const deliveries = new DeliveryJournal({
    appendEntry: (type, data) => {
      sessionManager.appendCustomEntry(type, data)
    },
    sendMessage: () => undefined,
  })
  deliveries.restore({ sessionManager })
  const broker = new ParentDecisions(deliveries, timeoutMs)
  const handle = {
    agentId: 'child',
    ownerGeneration: 1,
    ownerSessionId: sessionManager.getSessionId(),
    runGeneration: 1,
  }
  const controller = new AbortController()
  return { broker, controller, deliveries, handle }
}

function requestId(h: ReturnType<typeof harness>): string {
  const id = h.deliveries.list()[0]?.requestId
  if (id === undefined) throw new Error('The decision request is missing.')
  return id
}

describe('real parent decisions', () => {
  it('waits for the matching coordinator reply and rejects duplicates', async () => {
    const h = harness()
    const response = h.broker.request(h.handle, 'Can I change the scope?', h.controller.signal)
    const id = requestId(h)
    expect(h.broker.reply('other-child', id, 'yes', () => true).outcome).toBe('rejected')
    expect(h.broker.reply('child', id, 'yes', () => false).reason).toBe('stale-owner')
    expect(h.broker.reply('child', id, ' ', () => true).reason).toBe('empty')
    expect(
      h.broker.reply('child', id, 'No. Preserve the assigned scope.', () => true).outcome,
    ).toBe('answered')
    expect(await response).toBe('No. Preserve the assigned scope.')
    expect(h.broker.reply('child', id, 'yes', () => true).reason).toBe('not-pending')
    expect(h.deliveries.list()[0]?.state).toBe('acknowledged')
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0)
  })

  it('cancels a waiting decision and refuses a late reply', async () => {
    const h = harness()
    const response = h.broker.request(h.handle, 'A decision', h.controller.signal)
    const rejection = expect(response).rejects.toThrow('cancelled')
    const id = requestId(h)
    h.controller.abort()
    await rejection
    expect(h.deliveries.list()[0]?.state).toBe('cancelled')
    expect(h.broker.reply('child', id, 'yes', () => true).outcome).toBe('rejected')
    expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0)
  })

  it('times out without granting authorization', async () => {
    vi.useFakeTimers()
    try {
      const h = harness()
      const response = h.broker.request(h.handle, 'A decision', h.controller.signal)
      const rejection = expect(response).rejects.toThrow('No authorization was granted')
      await vi.advanceTimersByTimeAsync(1000)
      await rejection
      expect(h.deliveries.list()[0]?.state).toBe('cancelled')
      expect(getEventListeners(h.controller.signal, 'abort')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects concurrent requests and does not publish pre-cancelled questions', async () => {
    const h = harness()
    const response = h.broker.request(h.handle, 'First question', h.controller.signal)
    const rejection = expect(response).rejects.toThrow('cancelled')
    await expect(
      h.broker.request(h.handle, 'Second question', h.controller.signal),
    ).rejects.toThrow('already has a pending')
    h.controller.abort()
    await rejection
    await expect(h.broker.request(h.handle, 'Third question', h.controller.signal)).rejects.toThrow(
      'cancelled',
    )
    expect(h.deliveries.list()).toHaveLength(1)
  })
})
