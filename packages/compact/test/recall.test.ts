import { SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, test } from 'vite-plus/test'

import { recall } from '../src/recall.ts'
import { entry, user } from './fixtures.ts'

describe('source-linked recall', () => {
  test('searches full content beyond excerpts and expands by stable entry ID', async () => {
    const text = `${'padding '.repeat(5000)}critical-diagnostic${' trailing'.repeat(2000)}`
    const entries = [entry('evidence', user(text))]
    const result = await recall(entries, { query: 'critical-diagnostic' })
    expect(result).toContain('[evidence]')
    expect(result).toContain('critical-diagnostic')
    expect(result.length).toBeLessThan(5000)
    const expanded = await recall(entries, { entryId: 'evidence', offset: 40_000, limit: 19 })
    expect(expanded).toContain('critical-diagnostic')
    expect(expanded).toContain('Continue with offset: 40019')
  })

  test('keeps default lineage separate from other branches after compaction', async () => {
    const manager = SessionManager.inMemory()
    const root = manager.appendMessage(user('Shared objective'))
    const abandoned = manager.appendMessage(user('Abandoned zebra approach'))
    manager.branch(root)
    const active = manager.appendMessage(user('Active otter approach'))
    manager.appendCompaction('A deliberately lossy summary', active, 5000)
    expect(await recall(manager.getBranch(), { query: 'zebra' })).toContain('No matches')
    expect(await recall(manager.getEntries(), { query: 'zebra', allBranches: true })).toContain(
      abandoned,
    )
    await expect(recall(manager.getBranch(), { entryId: abandoned })).rejects.toThrow(
      'outside the selected session scope',
    )
    expect(await recall(manager.getBranch(), { entryId: root })).toContain('Shared objective')
  })

  test('uses Unicode keywords and pages without silently dropping matches', async () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      entry(`e${i}`, user(`Configuração número ${i}`)),
    )
    expect(await recall(entries, { query: 'configuração', page: 3 })).toContain(
      'Page 3/3, 12 matches',
    )
    await expect(recall(entries, { query: 'configuração', page: 4 })).rejects.toThrow(
      'available range 1-3',
    )
  })

  test('rejects invalid expansion combinations and honors cancellation', async () => {
    const entries = [entry('a', user('text'))]
    await expect(recall(entries, { query: 'text', entryId: 'a' })).rejects.toThrow(
      'either entryId or query',
    )
    await expect(recall(entries, { entryId: 'a', offset: 4 })).rejects.toThrow('Offset is outside')
    await expect(recall(entries, { limit: 1 })).rejects.toThrow('require entryId')
    const controller = new AbortController()
    const pending = recall(entries, {}, controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow(/abort/i)
  })
})
