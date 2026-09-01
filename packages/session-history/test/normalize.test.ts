import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { limitNormalizedEntries, normalizeEntries } from '../src/normalize.ts'

const directories: string[] = []

async function manager(): Promise<SessionManager> {
  const directory = await mkdtemp(join(tmpdir(), 'session-history-normalize-'))
  directories.push(directory)
  return SessionManager.create(directory, join(directory, 'sessions'), { id: 'normalize-session' })
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('entry normalization', () => {
  it('normalizes text, image metadata, and custom context messages', async () => {
    const session = await manager()
    session.appendMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'visible text' },
        { type: 'image', data: 'private-image-data', mimeType: 'image/png' },
      ],
      timestamp: 1,
    })
    session.appendCustomMessageEntry('fixture', 'custom context', true)
    const entries = session.getEntries()
    const normalized = normalizeEntries(
      entries,
      session.getSessionId(),
      new Set(entries.map((entry) => entry.id)),
    )

    expect(normalized.map((entry) => entry.content)).toEqual([
      'visible text\n[image image/png]',
      'custom context',
    ])
    expect(JSON.stringify(normalized)).not.toContain('private-image-data')
    expect(
      normalized.every((entry) => entry.reference.startsWith('pi-session://normalize-session/')),
    ).toBe(true)
  })

  it('marks abandoned entries and truncates long content', async () => {
    const session = await manager()
    const rootId = session.appendMessage({ role: 'user', content: 'root', timestamp: 1 })
    const abandonedId = session.appendMessage({
      role: 'user',
      content: 'x'.repeat(3_000),
      timestamp: 2,
    })
    session.branch(rootId)
    session.appendMessage({ role: 'user', content: 'active branch', timestamp: 3 })
    const activeEntries = session.buildContextEntries()
    const normalized = limitNormalizedEntries(
      normalizeEntries(
        session.getEntries(),
        session.getSessionId(),
        new Set(activeEntries.map((entry) => entry.id)),
      ),
    )
    const abandoned = normalized.find((entry) => entry.id === abandonedId)

    expect(abandoned?.branchState).toBe('abandoned')
    expect(abandoned?.truncated).toBe(true)
    expect(abandoned?.content.length).toBe(2_000)
  })

  it('preserves compaction summaries as audit events', async () => {
    const session = await manager()
    const oldId = session.appendMessage({ role: 'user', content: 'old context', timestamp: 1 })
    const keptId = session.appendMessage({ role: 'user', content: 'kept context', timestamp: 2 })
    session.appendCompaction('compact summary', keptId, 500)
    const entries = session.getEntries()
    const normalized = normalizeEntries(
      entries,
      session.getSessionId(),
      new Set(session.getBranch().map((entry) => entry.id)),
    )

    expect(normalized).toContainEqual(
      expect.objectContaining({ source: 'compaction_summary', content: 'compact summary' }),
    )
    expect(normalized).toContainEqual(expect.objectContaining({ id: oldId, branchState: 'active' }))
  })

  it('marks structural payload truncation', async () => {
    const session = await manager()
    session.appendCustomEntry(
      'large-payload',
      Object.fromEntries(
        Array.from({ length: 51 }, (_, index) => [`field-${index}`, `value-${index}`]),
      ),
    )
    const entries = session.getEntries()
    const normalized = normalizeEntries(
      entries,
      session.getSessionId(),
      new Set(entries.map((entry) => entry.id)),
    )

    expect(normalized[0]?.content).toContain('[TRUNCATED]')
    expect(normalized[0]?.truncated).toBe(true)
  })

  it('redacts known secret fields in custom payloads', async () => {
    const session = await manager()
    session.appendCustomEntry('secrets', {
      nested: { authorization: 'Bearer private', cookie: 'session=value' },
      password: 'private-password',
      safe: 'visible',
      secret: 'private-secret',
      token: 'private-token',
    })
    const entries = session.getEntries()
    const normalized = normalizeEntries(
      entries,
      session.getSessionId(),
      new Set(entries.map((entry) => entry.id)),
    )
    const text = normalized[0]?.content ?? ''

    expect(text).toContain('[REDACTED]')
    expect(text).toContain('visible')
    expect(text).not.toContain('private')
    expect(normalized[0]?.redacted).toBe(true)
  })
})
