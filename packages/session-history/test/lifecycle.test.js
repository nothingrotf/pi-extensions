import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import sessionHistory from '../src/index.ts'

function harness() {
  let registered
  const api = {
    events: { emit() {}, on: () => () => undefined },
    on() {},
    registerTool(tool) {
      registered = tool
    },
  }
  sessionHistory(api)
  if (registered === undefined) throw new Error('The session_history tool was not registered.')
  return registered
}

describe('session history lifecycle', () => {
  it('loads through the Pi resource runtime', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'session-history-loader-'))
    try {
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        additionalExtensionPaths: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
        noContextFiles: true,
        noExtensions: true,
        noPromptTemplates: true,
        noSkills: true,
        noThemes: true,
      })
      await loader.reload()
      const loaded = loader.getExtensions()
      const tools = loaded.extensions.flatMap((extension) => [...extension.tools.values()])

      expect(loaded.errors).toEqual([])
      expect(tools).toContainEqual(
        expect.objectContaining({
          definition: expect.objectContaining({ name: 'session_history' }),
        }),
      )
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('keeps the action on an oversized response error', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'session-history-response-'))
    try {
      const directory = join(cwd, 'sessions')
      const manager = SessionManager.create(cwd, directory, { id: 'response-session' })
      for (let index = 0; index < 100; index += 1) {
        manager.appendMessage({ role: 'user', content: 'x'.repeat(3_000), timestamp: index })
      }
      const path = manager.getSessionFile()
      const header = manager.getHeader()
      if (path === undefined || header === null)
        throw new Error('The response fixture must persist.')
      await writeFile(
        path,
        `${[header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
      )
      const execution = harness().execute(
        'call-1',
        {
          action: 'read',
          session_id: manager.getSessionId(),
          view: 'audit',
          include_tool_payloads: true,
          limit: 100,
        },
        undefined,
        undefined,
        { sessionManager: manager },
      )

      await expect(execution).rejects.toThrow('RESULT_LIMIT_EXCEEDED')
      await expect(execution).rejects.toThrow('"action":"read"')
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('pages long content through the registered tool', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'history-content-tool-'))
    try {
      const manager = SessionManager.create(cwd, join(cwd, 'sessions'))
      const entry_id = manager.appendMessage({
        role: 'user',
        content: 'x'.repeat(5_000),
        timestamp: 1,
      })
      const tool = harness()
      const input = { action: 'content', session_id: manager.getSessionId(), entry_id }
      const first = await tool.execute('first', input, undefined, undefined, {
        sessionManager: manager,
      })
      expect(JSON.parse(first.content[0].text)).toEqual(first.details)
      expect(first.details.data[0].content).toHaveLength(2_000)
      const second = await tool.execute(
        'second',
        { ...input, cursor: first.details.pagination.cursor },
        undefined,
        undefined,
        { sessionManager: manager },
      )
      expect(second.details.pagination.offset).toBe(2_000)
      const previous = await tool.execute(
        'previous',
        { ...input, cursor: second.details.pagination.previousCursor },
        undefined,
        undefined,
        { sessionManager: manager },
      )
      expect(previous).toEqual(first)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('throws scoped errors so Pi records failed tool execution', async () => {
    const manager = SessionManager.inMemory('/missing-session-history-project')
    await expect(
      harness().execute(
        'call-error',
        { action: 'read', session_id: 'invisible' },
        undefined,
        undefined,
        { sessionManager: manager },
      ),
    ).rejects.toThrow('OUT_OF_SCOPE')
  })

  it('reports work exhaustion as an explicit failed tool call', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'history-work-error-'))
    try {
      const directory = join(cwd, 'sessions')
      await mkdir(directory)
      const path = join(directory, 'oversized.jsonl')
      await writeFile(path, '')
      await truncate(path, 33 * 1024 * 1024)
      const manager = SessionManager.create(cwd, directory, { id: 'work-current' })
      const execution = harness().execute('call-work', { action: 'list' }, undefined, undefined, {
        sessionManager: manager,
      })
      await expect(execution).rejects.toThrow('WORK_LIMIT_EXCEEDED')
      await expect(execution).rejects.not.toThrow(cwd)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('honors cancellation before reading session history', async () => {
    const manager = SessionManager.inMemory('/missing-session-history-project')
    const controller = new AbortController()
    controller.abort(new Error('cancelled evaluation'))
    await expect(
      harness().execute('call-abort', { action: 'list' }, controller.signal, undefined, {
        sessionManager: manager,
      }),
    ).rejects.toThrow('cancelled evaluation')
  })

  it('registers the real tool name and discriminated schema', () => {
    const tool = harness()

    expect(tool.name).toBe('session_history')
    expect(tool.parameters.anyOf).toHaveLength(6)
    expect(tool.parameters.anyOf.map((schema) => schema.properties.action.const)).toEqual([
      'list',
      'search',
      'read',
      'timeline',
      'tool_activity',
      'content',
    ])
  })
})
