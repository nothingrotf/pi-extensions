import { appendFile, mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { SessionHistoryStore } from '../src/sessions.ts'

const directories: string[] = []

interface Fixture {
  cwd: string
  directory: string
  current: SessionManager
  prior: SessionManager
  child: SessionManager
  grandchild: SessionManager
  orphanChild: SessionManager
  branched: SessionManager
}

function timestamp(day: number): string {
  return `2026-01-${String(day).padStart(2, '0')}T00:00:00.000Z`
}

async function persistSession(manager: SessionManager): Promise<void> {
  const path = manager.getSessionFile()
  const header = manager.getHeader()
  if (path === undefined || header === null) throw new Error('The fixture session must persist.')
  await writeFile(
    path,
    `${[header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
  )
}

async function writeSimpleSession(
  cwd: string,
  directory: string,
  id: string,
  content: string,
  index: number,
): Promise<string> {
  const path = join(directory, `${String(index).padStart(4, '0')}_${id}.jsonl`)
  const created = new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  await writeFile(
    path,
    `${JSON.stringify({ type: 'session', version: 3, id, timestamp: created, cwd })}\n${JSON.stringify({ type: 'message', id: `${id}-entry`, parentId: null, timestamp: created, message: { role: 'user', content, timestamp: index + 1 } })}\n`,
  )
  return path
}

async function writeToolSession(cwd: string, directory: string): Promise<SessionManager> {
  const path = join(directory, '2026-01-01T00-00-00-000Z_prior-session.jsonl')
  const entries = [
    { type: 'session', version: 3, id: 'prior-session', timestamp: timestamp(1), cwd },
    {
      type: 'message',
      id: 'user-entry',
      parentId: null,
      timestamp: timestamp(1),
      message: { role: 'user', content: 'alpha beta decision', timestamp: 1 },
    },
    {
      type: 'message',
      id: 'assistant-entry',
      parentId: 'user-entry',
      timestamp: timestamp(2),
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'persisted analysis' },
          { type: 'text', text: 'assistant evidence' },
          {
            type: 'toolCall',
            id: 'completed-call',
            name: 'bash',
            arguments: { command: 'bun test', token: 'private-token' },
          },
          { type: 'toolCall', id: 'missing-call', name: 'read', arguments: { path: 'README.md' } },
          { type: 'toolCall', id: 'failed-call', name: 'bash', arguments: { command: 'false' } },
        ],
        api: 'test',
        provider: 'test',
        model: 'test',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: 2,
      },
    },
    {
      type: 'message',
      id: 'completed-result',
      parentId: 'assistant-entry',
      timestamp: timestamp(3),
      message: {
        role: 'toolResult',
        toolCallId: 'completed-call',
        toolName: 'bash',
        content: [{ type: 'text', text: `tests passed ${'x'.repeat(800)}` }],
        isError: false,
        timestamp: 3,
      },
    },
    {
      type: 'message',
      id: 'failed-result',
      parentId: 'completed-result',
      timestamp: timestamp(4),
      message: {
        role: 'toolResult',
        toolCallId: 'failed-call',
        toolName: 'bash',
        content: [{ type: 'text', text: 'command failed' }],
        isError: true,
        timestamp: 4,
      },
    },
    {
      type: 'custom_message',
      id: 'custom-entry',
      parentId: 'failed-result',
      timestamp: timestamp(5),
      customType: 'fixture',
      content: 'custom retained context',
      display: false,
    },
    {
      type: 'session_info',
      id: 'name-entry',
      parentId: 'custom-entry',
      timestamp: timestamp(6),
      name: 'Alpha beta project',
    },
  ]
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`)
  return SessionManager.open(path)
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'session-history-integration-'))
  directories.push(root)
  const cwd = join(root, 'project')
  const directory = join(root, 'sessions')
  const current = SessionManager.create(cwd, directory, { id: 'current-session' })
  current.appendMessage({ role: 'user', content: 'current private context', timestamp: 10 })
  await persistSession(current)
  const prior = await writeToolSession(cwd, directory)
  const priorPath = prior.getSessionFile()
  if (priorPath === undefined) throw new Error('The prior fixture must persist.')
  const child = SessionManager.create(cwd, directory, {
    id: 'child-session',
    parentSession: priorPath,
  })
  child.appendMessage({ role: 'user', content: 'child context', timestamp: 20 })
  await persistSession(child)
  const childPath = child.getSessionFile()
  if (childPath === undefined) throw new Error('The child fixture must persist.')
  const grandchild = SessionManager.create(cwd, directory, {
    id: 'grandchild-session',
    parentSession: childPath,
  })
  grandchild.appendMessage({ role: 'user', content: 'grandchild context', timestamp: 21 })
  await persistSession(grandchild)
  const orphanChild = SessionManager.create(cwd, directory, {
    id: 'orphan-child-session',
    parentSession: join(directory, 'missing-parent.jsonl'),
  })
  orphanChild.appendMessage({ role: 'user', content: 'orphan child context', timestamp: 22 })
  await persistSession(orphanChild)
  const branched = SessionManager.create(cwd, directory, { id: 'branched-session' })
  const rootId = branched.appendMessage({ role: 'user', content: 'branch root', timestamp: 30 })
  branched.appendMessage({ role: 'user', content: 'abandoned branch evidence', timestamp: 31 })
  branched.branch(rootId)
  branched.appendMessage({ role: 'user', content: 'active branch evidence', timestamp: 32 })
  await persistSession(branched)
  const other = SessionManager.create(join(root, 'other-project'), directory, {
    id: 'other-session',
  })
  other.appendMessage({ role: 'user', content: 'other project evidence', timestamp: 40 })
  await persistSession(other)
  await writeFile(join(directory, 'invalid.jsonl'), '{invalid json\n')
  return { cwd, directory, current, prior, child, grandchild, orphanChild, branched }
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('session history integration', () => {
  it('lists only root sessions from the current project by default', async () => {
    const state = await fixture()
    const result = await new SessionHistoryStore(state.current).execute({
      action: 'list',
      limit: 50,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'prior-session', isChild: false }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'branched-session', isChild: false }),
    )
    expect(result.data).not.toContainEqual(
      expect.objectContaining({ sessionId: 'current-session' }),
    )
    expect(result.data).not.toContainEqual(expect.objectContaining({ sessionId: 'child-session' }))
    expect(result.data).not.toContainEqual(expect.objectContaining({ sessionId: 'other-session' }))
    expect(JSON.stringify(result)).not.toContain(state.directory)
  })

  it('reads an unpersisted current session and reports list truncation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-current-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    const current = SessionManager.create(cwd, directory, { id: 'unpersisted-current' })
    current.appendMessage({ role: 'user', content: `current ${'x'.repeat(500)}`, timestamp: 1 })
    current.appendSessionInfo('n'.repeat(500))
    const store = new SessionHistoryStore(current)

    const listed = await store.execute({
      action: 'list',
      include_current: true,
      limit: 50,
    })
    const read = await store.execute({
      action: 'read',
      session_id: current.getSessionId(),
      view: 'active',
      limit: 10,
    })

    expect(listed.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'unpersisted-current',
        firstMessageTruncated: true,
        nameTruncated: true,
      }),
    )
    expect(listed.truncated).toBe(true)
    expect(JSON.stringify(read.data)).toContain('current')
  })

  it('includes current and child sessions only when requested', async () => {
    const state = await fixture()
    const result = await new SessionHistoryStore(state.current).execute({
      action: 'list',
      include_current: true,
      include_children: true,
      limit: 50,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'current-session', isCurrent: true }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'child-session',
        isChild: true,
        parentSessionId: 'prior-session',
      }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'grandchild-session',
        parentSessionId: 'child-session',
        mainSessionId: 'prior-session',
      }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'orphan-child-session',
        parentSessionId: null,
      }),
    )
  })

  it('includes sessions whose project path uses a symbolic link', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-project-link-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const linkedCwd = join(root, 'linked-project')
    const directory = join(root, 'sessions')
    await Promise.all([mkdir(cwd), mkdir(directory)])
    await symlink(cwd, linkedCwd)
    const current = SessionManager.create(cwd, directory, { id: 'project-link-current' })
    current.appendMessage({ role: 'user', content: 'current', timestamp: 1 })
    await persistSession(current)
    await writeSimpleSession(linkedCwd, directory, 'linked-project-session', 'linked', 1)

    const result = await new SessionHistoryStore(current).execute({
      action: 'list',
      limit: 50,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'linked-project-session' }),
    )
  })

  it('resolves parent sessions through symbolic links', async () => {
    const state = await fixture()
    const priorPath = state.prior.getSessionFile()
    if (priorPath === undefined) throw new Error('The prior fixture must persist.')
    const linkedDirectory = join(dirname(state.directory), 'linked-sessions')
    await symlink(state.directory, linkedDirectory)
    const linkedChild = SessionManager.create(state.cwd, state.directory, {
      id: 'linked-child-session',
      parentSession: join(linkedDirectory, basename(priorPath)),
    })
    linkedChild.appendMessage({ role: 'user', content: 'linked child', timestamp: 23 })
    await persistSession(linkedChild)

    const result = await new SessionHistoryStore(state.current).execute({
      action: 'list',
      include_current: true,
      include_children: true,
      limit: 50,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'linked-child-session',
        parentSessionId: 'prior-session',
      }),
    )
  })

  it('searches messages, thought, tool calls, results, and custom context', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.current)
    const queries = [
      'alpha beta',
      'persisted analysis',
      'bun test',
      'tests passed',
      'custom retained',
    ]
    for (const query of queries) {
      const result = await store.execute({ action: 'search', query, limit: 50 })
      expect(result.data.length).toBeGreaterThan(0)
      expect(JSON.stringify(result.data)).toContain('pi-session://prior-session/')
    }
    const secretResult = await store.execute({ action: 'search', query: 'bun test', limit: 50 })
    expect(JSON.stringify(secretResult)).not.toContain('private-token')
    expect(secretResult.redacted).toBe(true)
    expect(secretResult.skippedSessions).toBe(1)
  })

  it('distinguishes active and audit branch views', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.current)
    const active = await store.execute({
      action: 'read',
      session_id: state.branched.getSessionId(),
      view: 'active',
      limit: 100,
    })
    const audit = await store.execute({
      action: 'read',
      session_id: state.branched.getSessionId(),
      view: 'audit',
      limit: 100,
    })

    expect(JSON.stringify(active.data)).toContain('active branch evidence')
    expect(JSON.stringify(active.data)).not.toContain('abandoned branch evidence')
    expect(audit.data).toContainEqual(
      expect.objectContaining({ content: 'abandoned branch evidence', branchState: 'abandoned' }),
    )
  })

  it('limits tool payloads in read responses and redacts included payloads', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.current)
    const omitted = await store.execute({
      action: 'read',
      session_id: state.prior.getSessionId(),
      view: 'audit',
      limit: 100,
    })
    const included = await store.execute({
      action: 'read',
      session_id: state.prior.getSessionId(),
      view: 'audit',
      include_tool_payloads: true,
      limit: 100,
    })

    expect(JSON.stringify(omitted.data)).toContain('[tool input payload omitted]')
    expect(JSON.stringify(omitted.data)).toContain('[tool result payload omitted]')
    expect(omitted.truncated).toBe(true)
    expect(JSON.stringify(included.data)).toContain('bun test')
    expect(JSON.stringify(included.data)).not.toContain('private-token')
    expect(included.redacted).toBe(true)
  })

  it('reports completed, failed, and missing tool results without inference', async () => {
    const state = await fixture()
    const result = await new SessionHistoryStore(state.current).execute({
      action: 'tool_activity',
      session_id: state.prior.getSessionId(),
      limit: 50,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({
        toolCallId: 'completed-call',
        status: 'completed',
        resultTruncated: true,
      }),
    )
    expect(result.truncated).toBe(true)
    expect(result.data).toContainEqual(
      expect.objectContaining({ toolCallId: 'failed-call', status: 'failed' }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({ toolCallId: 'missing-call', status: 'missing_result' }),
    )
  })

  it('builds a compact timeline and preserves child origins', async () => {
    const state = await fixture()
    state.child.appendSessionInfo('n'.repeat(800))
    await persistSession(state.child)
    const result = await new SessionHistoryStore(state.current).execute({
      action: 'timeline',
      session_id: state.prior.getSessionId(),
      include_children: true,
      view: 'audit',
      limit: 200,
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'prior-session', source: 'tool_call' }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'child-session',
        parentSessionId: 'prior-session',
        type: 'child_session',
        truncated: true,
      }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({
        sessionId: 'grandchild-session',
        parentSessionId: 'child-session',
        mainSessionId: 'prior-session',
      }),
    )
    expect(result.data).toContainEqual(
      expect.objectContaining({ isError: true, source: 'tool_result' }),
    )
    expect(JSON.stringify(result.data)).not.toContain('tests passed')
  })

  it('rejects out-of-scope identifiers and stale cursors', async () => {
    const state = await fixture()
    const store = new SessionHistoryStore(state.current)
    await expect(
      store.execute({ action: 'read', session_id: 'other-session' }),
    ).rejects.toMatchObject({ code: 'OUT_OF_SCOPE' })
    const first = await store.execute({ action: 'list', include_current: true, limit: 1 })
    const cursor = first.pagination.cursor
    expect(cursor).not.toBeNull()
    if (cursor === null) throw new Error('The fixture must produce a cursor.')
    const priorPath = state.prior.getSessionFile()
    if (priorPath === undefined) throw new Error('The prior fixture must persist.')
    await appendFile(
      priorPath,
      `${JSON.stringify({ type: 'custom', id: 'changed', parentId: 'name-entry', timestamp: timestamp(7), customType: 'change', data: true })}\n`,
    )
    await expect(
      store.execute({ action: 'list', include_current: true, limit: 1, cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
  })

  it('searches text after the output character limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-long-search-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    await mkdir(directory)
    const current = SessionManager.create(cwd, directory, { id: 'long-search-current' })
    current.appendMessage({ role: 'user', content: 'current', timestamp: 1 })
    await persistSession(current)
    await writeSimpleSession(
      cwd,
      directory,
      'long-search-session',
      `${'x'.repeat(3_000)} tail_needle`,
      1,
    )

    const result = await new SessionHistoryStore(current).execute({
      action: 'search',
      query: 'tail_needle',
    })

    expect(result.data).toContainEqual(
      expect.objectContaining({ sessionId: 'long-search-session' }),
    )
    expect(result.truncated).toBe(true)
  })

  it('reports the deterministic limit for searched sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-limit-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    await mkdir(directory)
    const current = SessionManager.create(cwd, directory, { id: 'limit-current-session' })
    current.appendMessage({ role: 'user', content: 'current', timestamp: 1 })
    await persistSession(current)
    for (let index = 0; index < 101; index += 1) {
      await writeSimpleSession(
        cwd,
        directory,
        `candidate-${String(index).padStart(3, '0')}`,
        'candidate phrase',
        index,
      )
    }

    const result = await new SessionHistoryStore(current).execute({
      action: 'search',
      query: 'candidate phrase',
      limit: 1,
    })

    expect(result.limits.sessionLimit).toBe(100)
    expect(result.omittedSessions).toBe(1)
    expect(result.pagination.total).toBe(100)
  })

  it('does not cache one session above the memory limit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-cache-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    await mkdir(directory)
    const current = SessionManager.create(cwd, directory, { id: 'cache-current-session' })
    current.appendMessage({ role: 'user', content: 'current', timestamp: 1 })
    await persistSession(current)
    const padding = 'x'.repeat(17 * 1024 * 1024)
    const path = await writeSimpleSession(
      cwd,
      directory,
      'large-session',
      `old_marker ${padding}`,
      1,
    )
    const store = new SessionHistoryStore(current)
    const first = await store.execute({ action: 'search', query: 'old_marker' })
    expect(first.data.length).toBe(1)
    const fileStat = await stat(path)
    await writeSimpleSession(cwd, directory, 'large-session', `new_marker ${padding}`, 1)
    await utimes(path, fileStat.atime, fileStat.mtime)

    const second = await store.execute({ action: 'search', query: 'new_marker' })
    expect(second.data.length).toBe(1)
  })

  it('rejects circular child relationships', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-history-circular-'))
    directories.push(root)
    const cwd = join(root, 'project')
    const directory = join(root, 'sessions')
    await mkdir(directory)
    const firstPath = join(directory, '2026-01-01T00-00-00-000Z_first-session.jsonl')
    const secondPath = join(directory, '2026-01-02T00-00-00-000Z_second-session.jsonl')
    await writeFile(
      firstPath,
      `${JSON.stringify({ type: 'session', version: 3, id: 'first-session', timestamp: timestamp(1), cwd, parentSession: secondPath })}\n${JSON.stringify({ type: 'message', id: 'first-entry', parentId: null, timestamp: timestamp(1), message: { role: 'user', content: 'first', timestamp: 1 } })}\n`,
    )
    await writeFile(
      secondPath,
      `${JSON.stringify({ type: 'session', version: 3, id: 'second-session', timestamp: timestamp(2), cwd, parentSession: firstPath })}\n${JSON.stringify({ type: 'message', id: 'second-entry', parentId: null, timestamp: timestamp(2), message: { role: 'user', content: 'second', timestamp: 2 } })}\n`,
    )

    await expect(
      new SessionHistoryStore(SessionManager.open(firstPath)).execute({
        action: 'list',
        include_children: true,
      }),
    ).rejects.toMatchObject({ code: 'MALFORMED_SESSION' })
  })

  it('keeps valid search results when another file is malformed', async () => {
    const state = await fixture()
    const result = await new SessionHistoryStore(state.current).execute({
      action: 'search',
      query: 'alpha beta',
      limit: 50,
    })

    expect(result.data.length).toBeGreaterThan(0)
  })
})
