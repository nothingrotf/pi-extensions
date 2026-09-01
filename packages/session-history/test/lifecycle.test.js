import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DefaultResourceLoader, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import sessionHistory from '../src/index.ts'

function harness() {
  let registered
  const api = {
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
      const result = await harness().execute(
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

      expect(result.details).toEqual(
        expect.objectContaining({
          action: 'read',
          error: expect.objectContaining({ code: 'RESULT_LIMIT_EXCEEDED' }),
        }),
      )
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('registers the real tool name and discriminated schema', () => {
    const tool = harness()

    expect(tool.name).toBe('session_history')
    expect(tool.parameters.anyOf).toHaveLength(5)
    expect(tool.parameters.anyOf.map((schema) => schema.properties.action.const)).toEqual([
      'list',
      'search',
      'read',
      'timeline',
      'tool_activity',
    ])
  })
})
