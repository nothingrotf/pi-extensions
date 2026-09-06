import { execFile } from 'node:child_process'
import { appendFile, copyFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { afterEach, expect, it } from 'vite-plus/test'

import { SessionDiscovery } from '../src/discovery.ts'
import sessionHistory from '../src/index.ts'
import { type SessionHistoryInput } from '../src/schema.ts'
import { SessionHistoryStore } from '../src/sessions.ts'
import { HistoryWork, historyLimits } from '../src/work.ts'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function activity(manager: SessionManager): string {
  const entry = manager.appendMessage({ role: 'user', content: 'target evidence', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'command', name: 'bash', arguments: { command: 'true' } }],
    api: 'openai-responses',
    provider: 'fixture',
    model: 'fixture',
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
  })
  manager.appendMessage({
    role: 'toolResult',
    toolCallId: 'command',
    toolName: 'bash',
    content: [{ type: 'text', text: 'target evidence' }],
    isError: false,
    timestamp: 3,
  })
  return entry
}

function sessionFile(manager: SessionManager): string {
  const path = manager.getSessionFile()
  if (path === undefined) throw new Error('Expected a persistent SDK session.')
  return path
}

it('serves exact SDK-session targets without consuming an unrelated oversized body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-targeted-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory)
  activity(current)
  const target = SessionManager.create(root, directory)
  const entryId = activity(target)
  target.appendSessionInfo('Target evidence name')
  const unrelated = SessionManager.create(root, directory)
  activity(unrelated)
  unrelated.appendCustomEntry('large-unrelated-payload', 'x'.repeat(historyLimits.fileBytes))
  expect((await stat(sessionFile(unrelated))).size).toBeGreaterThan(historyLimits.fileBytes)
  const work = new HistoryWork()
  const identity = await new SessionDiscovery().identity(
    sessionFile(unrelated),
    await stat(sessionFile(unrelated)),
    work,
  )
  expect(identity?.id).toBe(unrelated.getSessionId())
  expect(identity).not.toHaveProperty('messageCount')
  expect(identity).not.toHaveProperty('firstMessage')
  expect(work.usage().bytesRead).toBeLessThanOrEqual(1024)
  expect(work.usage().visitedEntries).toBe(0)
  await expect(
    new SessionHistoryStore(current).execute({
      action: 'read',
      session_id: unrelated.getSessionId(),
    }),
  ).rejects.toMatchObject({ code: 'WORK_LIMIT_EXCEEDED' })
  const settingsManager = SettingsManager.inMemory()
  const resourceLoader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, 'agent'),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    extensionFactories: [sessionHistory],
  })
  await resourceLoader.reload()
  const modelRuntime = await ModelRuntime.create({
    authPath: join(root, 'auth.json'),
    modelsPath: join(root, 'models.json'),
    modelsStorePath: join(root, 'models-store.json'),
  })
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, 'agent'),
    sessionManager: current,
    resourceLoader,
    settingsManager,
    modelRuntime,
    tools: ['session_history'],
  })
  try {
    const tool = session.agent.state.tools.find((candidate) => candidate.name === 'session_history')
    if (tool === undefined) throw new Error('Expected the registered history tool.')
    const result = await tool.execute('targeted-repro', {
      action: 'tool_activity',
      session_id: target.getSessionId(),
      tool_names: ['bash'],
      limit: 12,
    })
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('"status":"completed"'),
      }),
    )
  } finally {
    session.dispose()
  }
  const inputs: SessionHistoryInput[] = [
    { action: 'tool_activity', session_id: target.getSessionId(), tool_names: ['bash'], limit: 12 },
    { action: 'read', session_id: target.getSessionId() },
    { action: 'timeline', session_id: target.getSessionId() },
    { action: 'content', session_id: target.getSessionId(), entry_id: entryId },
    { action: 'search', session_ids: [target.getSessionId()], query: 'target evidence' },
  ]
  for (const input of inputs) {
    const result = await new SessionHistoryStore(current).execute(input)
    expect(result.data.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).not.toContain(unrelated.getSessionId())
    if (input.action === 'tool_activity') {
      expect(result.data).toEqual([expect.objectContaining({ status: 'completed' })])
    }
    if (input.action === 'search') {
      expect(result.data).toContainEqual(expect.objectContaining({ score: 1702 }))
    }
  }
})

it('keeps aggregate unrelated bodies outside the request budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-targeted-aggregate-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory)
  activity(current)
  const target = SessionManager.create(root, directory)
  activity(target)
  let bytes = 0
  const work = new HistoryWork()
  const discovery = new SessionDiscovery()
  for (let index = 0; index < 5; index += 1) {
    const unrelated = SessionManager.create(root, directory)
    activity(unrelated)
    unrelated.appendCustomEntry('unrelated', 'x'.repeat(27 * 1024 * 1024))
    const path = sessionFile(unrelated)
    const stats = await stat(path)
    expect(stats.size).toBeLessThan(historyLimits.fileBytes)
    bytes += stats.size
    await discovery.identity(path, stats, work)
  }
  expect(bytes).toBeGreaterThan(historyLimits.requestBytes)
  expect(work.usage().bytesRead).toBeLessThanOrEqual(5 * 1024)
  expect(
    (
      await new SessionHistoryStore(current).execute({
        action: 'tool_activity',
        session_id: target.getSessionId(),
        tool_names: ['bash'],
        limit: 12,
      })
    ).data,
  ).toEqual([expect.objectContaining({ status: 'completed' })])
})

it('quarantines arbitrary-named duplicate headers even when their bodies are corrupt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-targeted-duplicate-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory)
  activity(current)
  const target = SessionManager.create(root, directory)
  const entryId = activity(target)
  const child = SessionManager.create(root, directory, { parentSession: sessionFile(target) })
  activity(child)
  const duplicate = join(directory, 'arbitrary-name.jsonl')
  await copyFile(sessionFile(target), duplicate)
  await appendFile(duplicate, '{broken json\n')
  const store = new SessionHistoryStore(current)
  const inputs: SessionHistoryInput[] = [
    { action: 'read', session_id: target.getSessionId() },
    { action: 'timeline', session_id: target.getSessionId() },
    { action: 'tool_activity', session_id: child.getSessionId() },
    { action: 'content', session_id: target.getSessionId(), entry_id: entryId },
    { action: 'search', session_ids: [target.getSessionId()], query: 'evidence' },
  ]
  for (const input of inputs) {
    await expect(store.execute(input)).rejects.toMatchObject({ code: 'MALFORMED_SESSION' })
  }
  await writeFile(
    duplicate,
    `${JSON.stringify({ ...target.getHeader(), cwd: join(root, 'foreign-project') })}\n{broken json\n`,
  )
  expect(
    (await store.execute({ action: 'read', session_id: target.getSessionId() })).data.length,
  ).toBeGreaterThan(0)
  await rm(duplicate)
  expect(
    (await store.execute({ action: 'read', session_id: child.getSessionId() })).data.length,
  ).toBeGreaterThan(0)
})

it.each(['json', 'entry-parent', 'version'])(
  'rejects a %s-invalid ancestor and recovers after repair',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'history-targeted-ancestor-'))
    directories.push(root)
    const directory = join(root, 'sessions')
    const current = SessionManager.create(root, directory)
    activity(current)
    const parent = SessionManager.create(root, directory)
    activity(parent)
    await promisify(execFile)('git', ['init', '-q', root])
    const managed = join(root, '.git', 'pi-subagent', 'worktrees', 'workspace', 'root')
    const child = SessionManager.create(managed, directory, { parentSession: sessionFile(parent) })
    activity(child)
    const path = sessionFile(parent)
    const original = await readFile(path, 'utf8')
    if (mode === 'json') await appendFile(path, '{broken json\n')
    if (mode === 'entry-parent') {
      await writeFile(
        path,
        [
          parent.getHeader(),
          ...parent.getEntries().map((entry) => ({
            ...entry,
            parentId: 'missing-entry',
          })),
        ]
          .map((entry) => JSON.stringify(entry))
          .join('\n'),
      )
    }
    if (mode === 'version') {
      await writeFile(
        path,
        [{ ...parent.getHeader(), version: 999 }, ...parent.getEntries()]
          .map((entry) => JSON.stringify(entry))
          .join('\n'),
      )
    }
    const store = new SessionHistoryStore(current)
    await expect(
      store.execute({ action: 'tool_activity', session_id: child.getSessionId() }),
    ).rejects.toMatchObject({ code: 'MALFORMED_SESSION' })
    await writeFile(path, original)
    expect(
      (await store.execute({ action: 'tool_activity', session_id: child.getSessionId() })).data,
    ).toEqual([
      expect.objectContaining({ status: 'completed', parentSessionId: parent.getSessionId() }),
    ])
  },
)

it('does not hydrate omitted descendant bodies while retaining required ancestor limits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-targeted-cap-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory)
  activity(current)
  const target = SessionManager.create(root, directory)
  activity(target)
  let leaf = target
  let omittedBytes = 0
  for (let index = 1; index < historyLimits.sessions + 6; index += 1) {
    const child = SessionManager.create(root, directory, { parentSession: sessionFile(leaf) })
    activity(child)
    if (index >= historyLimits.sessions && index < historyLimits.sessions + 5) {
      child.appendCustomEntry('omitted-payload', 'x'.repeat(27 * 1024 * 1024))
      const bytes = (await stat(sessionFile(child))).size
      expect(bytes).toBeLessThan(historyLimits.fileBytes)
      omittedBytes += bytes
    }
    leaf = child
  }
  expect(omittedBytes).toBeGreaterThan(historyLimits.requestBytes)
  const actions: Array<'timeline' | 'tool_activity'> = ['timeline', 'tool_activity']
  for (const action of actions) {
    const response = await new SessionHistoryStore(current).execute({
      action,
      session_id: target.getSessionId(),
      include_children: true,
    })
    expect(response.omittedSessions).toBe(6)
    expect(response.skippedSessions).toBe(0)
    expect(response.truncated).toBe(true)
    expect(response.data.length).toBeGreaterThan(0)
    if (action === 'tool_activity') expect(response.pagination.total).toBe(historyLimits.sessions)
  }
  await expect(
    new SessionHistoryStore(current).execute({ action: 'read', session_id: leaf.getSessionId() }),
  ).rejects.toMatchObject({ code: 'WORK_LIMIT_EXCEEDED' })
}, 30_000)

it('does not refill capped expansion from omitted bodies after ancestry quarantine', async () => {
  const root = await mkdtemp(join(tmpdir(), 'history-targeted-cap-quarantine-'))
  directories.push(root)
  const directory = join(root, 'sessions')
  const current = SessionManager.create(root, directory)
  activity(current)
  const target = SessionManager.create(root, directory)
  activity(target)
  const children: SessionManager[] = []
  for (let index = 0; index < historyLimits.sessions - 2; index += 1) {
    const child = SessionManager.create(root, directory, { parentSession: sessionFile(target) })
    activity(child)
    children.push(child)
  }
  const first = children[0]
  const second = children[1]
  if (first === undefined || second === undefined) throw new Error('Expected fixture children.')
  const selected = SessionManager.create(root, directory, { parentSession: sessionFile(first) })
  activity(selected)
  const omitted = SessionManager.create(root, directory, { parentSession: sessionFile(second) })
  activity(omitted)
  omitted.appendCustomEntry('omitted-payload', 'x'.repeat(historyLimits.fileBytes))
  await appendFile(sessionFile(first), '{broken json\n')
  const actions: Array<'timeline' | 'tool_activity'> = ['timeline', 'tool_activity']
  for (const action of actions) {
    const response = await new SessionHistoryStore(current).execute({
      action,
      session_id: target.getSessionId(),
      include_children: true,
    })
    expect(response.omittedSessions).toBe(1)
    expect(response.skippedSessions).toBe(2)
    expect(response.data.length).toBeGreaterThan(0)
    if (action === 'tool_activity')
      expect(response.pagination.total).toBe(historyLimits.sessions - 2)
  }
})

const expandedActions: Array<'timeline' | 'tool_activity'> = ['timeline', 'tool_activity']
const rootFailureCases = expandedActions.flatMap((action) =>
  ['version', 'mutation'].map((failure) => ({ action, failure })),
)

it.each(rootFailureCases)(
  'preserves direct $action root $failure failures with child expansion',
  async ({ action, failure }) => {
    const root = await mkdtemp(join(tmpdir(), 'history-targeted-root-failure-'))
    directories.push(root)
    const directory = join(root, 'sessions')
    const current = SessionManager.create(root, directory)
    activity(current)
    const original = SessionManager.create(root, directory)
    activity(original)
    const targetPath = join(directory, '000-target.jsonl')
    await copyFile(sessionFile(original), targetPath)
    await rm(sessionFile(original))
    const target = SessionManager.open(targetPath)
    const child = SessionManager.create(root, directory, { parentSession: targetPath })
    activity(child)
    if (failure === 'version') {
      await writeFile(
        targetPath,
        [{ ...target.getHeader(), version: 999 }, ...target.getEntries()]
          .map((entry) => JSON.stringify(entry))
          .join('\n'),
      )
      for (const includeChildren of [false, true]) {
        await expect(
          new SessionHistoryStore(current).execute({
            action,
            session_id: target.getSessionId(),
            include_children: includeChildren,
          }),
        ).rejects.toMatchObject({ code: 'UNSUPPORTED_SESSION_VERSION' })
      }
      return
    }
    for (let index = 0; index < historyLimits.concurrentFiles; index += 1) {
      const filler = SessionManager.create(root, directory)
      activity(filler)
    }
    const sentinel = SessionManager.create(root, directory)
    activity(sentinel)
    const sentinelPath = join(directory, 'zzzz-sentinel.jsonl')
    await copyFile(sessionFile(sentinel), sentinelPath)
    await rm(sessionFile(sentinel))
    for (const includeChildren of [false, true]) {
      let mutated = false
      const store = new SessionHistoryStore(current, async (path) => {
        if (path === sentinelPath && !mutated) {
          mutated = true
          await appendFile(targetPath, '\n')
        }
        return stat(path)
      })
      await expect(
        store.execute({
          action,
          session_id: target.getSessionId(),
          include_children: includeChildren,
        }),
      ).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
      expect(mutated).toBe(true)
    }
  },
)
