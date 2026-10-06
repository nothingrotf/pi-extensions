import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAgentSession,
  createReadToolDefinition,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type ToolResultEvent,
} from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { createBoundedReadTool } from '../../filetools/src/read.ts'
import { cloakText, loadState, type CloakConfig } from '../src/cloak.ts'
import cloak, { cloakReadResult } from '../src/index.ts'

const directories: string[] = []
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'pi-cloak-'))
  directories.push(dir)
  return dir
}
async function configuration(config: CloakConfig) {
  const path = join(await fixture(), 'cloak.json')
  await writeFile(path, JSON.stringify(config))
  return loadState(path)
}
function readEvent(path: string, text: string): ToolResultEvent {
  return {
    type: 'tool_result',
    toolCallId: 'read-test',
    toolName: 'read',
    input: { path },
    content: [{ type: 'text', text }],
    details: undefined,
    isError: false,
  }
}
const envRule = {
  filePattern: ['.env', '.env.*'],
  cloakPattern: '^(\\w+=).+',
  replace: '$1',
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('cloak configuration and masking', () => {
  it('loads safe defaults and leaves unmatched or disabled reads unchanged', async () => {
    const defaults = await configuration({})
    expect(defaults.error).toBeUndefined()
    expect(cloakText('secret', '.env', '/', defaults)).toBe('secret')
    const state = await configuration({ patterns: [envRule] })
    expect(cloakText('KEY=secret', 'plain.txt', '/', state)).toBe('KEY=secret')
    const disabled = await configuration({ enabled: false, patterns: [envRule] })
    expect(cloakText('KEY=secret', '.env', '/', disabled)).toBe('KEY=secret')
  })

  it('matches basenames, globstar, question marks, absolute, home, and attachment paths', async () => {
    const state = await configuration({ patterns: [envRule] })
    for (const path of ['.env', '@.env', '/work/.env', 'nested\\.env.production', '~/.env']) {
      expect(cloakText('KEY=secret', path, '/work', state)).toBe('KEY=******')
    }
    for (const filePattern of ['**/config?.txt', '/work/**/config?.txt', '~/config?.txt']) {
      const configured = await configuration({
        patterns: [{ filePattern, cloakPattern: 'secret' }],
      })
      const path = filePattern.startsWith('~') ? join(homedir(), 'config1.txt') : 'config1.txt'
      expect(cloakText('secret', path, '/work', configured)).toBe('s*****')
    }
  })

  it('preserves mixed newlines and masks every match on every line', async () => {
    const state = await configuration({
      patterns: [{ filePattern: '*.txt', cloakPattern: 'secret' }],
    })
    expect(cloakText('secret secret\r\nsecret\nsecret\r\n', 'a.txt', '/', state)).toBe(
      's***** s*****\r\ns*****\ns*****\r\n',
    )
    expect(cloakText('secret', 'a.txt', '/', state)).toBe('s*****')
  })

  it('supports capture templates, named captures, flags, and replacement precedence', async () => {
    const state = await configuration({
      patterns: [
        {
          filePattern: '*',
          replace: 'ignored',
          cloakPattern: { pattern: '(?<key>key=)(secret)', flags: 'i', replace: '$1' },
        },
      ],
    })
    expect(cloakText('KEY=SECRET', '.env', '/', state)).toBe('KEY=******')
    const template = await configuration({
      cloakLength: 10,
      patterns: [
        {
          filePattern: '*',
          cloakPattern: '(a)(b)',
          replace: '$$-$2-$99$0',
        },
      ],
    })
    expect(cloakText('ab', '.env', '/', template)).toBe('$-b-******')
    const expose = await configuration({
      patterns: [{ filePattern: '*', cloakPattern: 'secret', replace: '$&' }],
    })
    expect(cloakText('secret', '.env', '/', expose)).toBe('secret')
  })

  it('handles fixed length, truncation, multi-character masks, and zero-length regex matches', async () => {
    const state = await configuration({ cloakLength: 8, cloakCharacter: 'xy', patterns: [envRule] })
    expect(cloakText('KEY=secret', '.env', '/', state)).toBe('KEY=xyxy')
    const short = await configuration({ cloakLength: 2, patterns: [envRule] })
    expect(cloakText('KEY=secret', '.env', '/', short)).toBe('KE')
    const empty = await configuration({ cloakLength: 0, patterns: [envRule] })
    expect(cloakText('KEY=secret', '.env', '/', empty)).toBe('')
    const zeroMatch = await configuration({ patterns: [{ filePattern: '*', cloakPattern: '^' }] })
    expect(cloakText('secret', '.env', '/', zeroMatch)).toBe('secret')
  })

  it('stops after a changing pattern per rule and still processes later rules', async () => {
    const patterns = [
      { filePattern: '*', cloakPattern: ['alpha', 'beta'] },
      { filePattern: '*', cloakPattern: 'gamma' },
    ]
    const first = await configuration({ tryAllPatterns: false, patterns })
    const all = await configuration({ patterns })
    expect(cloakText('alpha beta gamma', '.env', '/', first)).toBe('a**** beta g****')
    expect(cloakText('alpha beta gamma', '.env', '/', all)).toBe('a**** b*** g****')
  })

  it('reports missing, malformed, and invalid configurations without exposing their contents', async () => {
    expect(loadState(join(await fixture(), 'missing.json')).error).toContain('config not found')
    for (const config of [
      null,
      [],
      { enabled: 'yes' },
      { cloakLength: -1 },
      { patterns: [{ filePattern: '*', cloakPattern: '[' }] },
      { patterns: [{ filePattern: '*', cloakPattern: { pattern: 'secret', flags: 'z' } }] },
    ]) {
      const path = join(await fixture(), 'cloak.json')
      await writeFile(path, JSON.stringify(config))
      const state = loadState(path)
      expect(state.error).toBeDefined()
      expect(state.error).not.toContain('secret')
      expect(cloakText('KEY=secret', '.env', '/', state)).toBe('KEY=secret')
    }
    const path = join(await fixture(), 'cloak.json')
    await writeFile(path, '{"secret": PRIVATE_VALUE')
    expect(loadState(path).error).not.toContain('PRIVATE_VALUE')
  })
})

describe('read result integration', () => {
  it('preserves images and leaves unrelated tools and no-op results unchanged', async () => {
    const state = await configuration({ patterns: [envRule] })
    const event = readEvent('.env', 'KEY=secret')
    const image = { type: 'image', data: 'image-data', mimeType: 'image/png' }
    event.content.push({ type: 'image', data: image.data, mimeType: image.mimeType })
    const result = cloakReadResult(event, '/', state)
    expect(result?.content?.[0]).toEqual({ type: 'text', text: 'KEY=******' })
    expect(result?.content?.[1]).toBe(event.content[1])
    expect(event.content[0]).toEqual({ type: 'text', text: 'KEY=secret' })
    expect(cloakReadResult({ ...event, toolName: 'bash' }, '/', state)).toBeUndefined()
    expect(cloakReadResult(readEvent('a.txt', 'KEY=secret'), '/', state)).toBeUndefined()
    expect(cloakReadResult({ ...event, input: {} }, '/', state)).toBeUndefined()
  })

  it('masks multi-file text and structured results without leaking JSON projection values', async () => {
    const state = await configuration({ patterns: [envRule] })
    const event: ToolResultEvent = {
      ...readEvent('.env', ''),
      input: { paths: ['.env', 'public.txt'] },
      content: [
        { type: 'text', text: '===== .env =====' },
        { type: 'text', text: 'KEY=secret' },
        { type: 'text', text: '===== public.txt =====' },
        { type: 'text', text: 'KEY=secret' },
      ],
      structuredContent: {
        files: [
          { path: '.env', text: 'KEY=secret', bounded: false, images: 0 },
          { path: 'public.txt', text: 'KEY=secret', bounded: false, images: 0 },
        ],
        unread: ['later.txt'],
        value: 'secret',
      },
    }
    const result = cloakReadResult(event, '/', state)
    expect(result?.content).toEqual([
      { type: 'text', text: '===== .env =====' },
      { type: 'text', text: 'KEY=******' },
      { type: 'text', text: '===== public.txt =====' },
      { type: 'text', text: 'KEY=secret' },
    ])
    expect(result?.structuredContent).toEqual({
      files: [
        { path: '.env', text: 'KEY=******', bounded: false, images: 0 },
        { path: 'public.txt', text: 'KEY=secret', bounded: false, images: 0 },
      ],
      unread: ['later.txt'],
    })
  })

  it('runs the registered hook against real native and filetools reads and reloads through the command', async () => {
    const dir = await fixture()
    const agentDir = join(dir, 'agent')
    await mkdir(agentDir)
    vi.stubEnv('PI_CODING_AGENT_DIR', agentDir)
    await writeFile(
      join(agentDir, 'cloak.json'),
      JSON.stringify({
        patterns: [envRule, { filePattern: 'secrets.json', cloakPattern: 'secret' }],
      }),
    )
    await writeFile(join(dir, '.env'), 'KEY=secret')
    await writeFile(join(dir, 'public.txt'), 'KEY=public')
    await writeFile(join(dir, 'secrets.json'), JSON.stringify({ token: 'secret' }))
    const runtime = await ModelRuntime.create({ refreshOnCreate: false })
    const loader = new DefaultResourceLoader({
      agentDir,
      cwd: dir,
      extensionFactories: [cloak],
      noExtensions: true,
      noContextFiles: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: dir,
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(dir),
    })
    try {
      const ctx = session.extensionRunner.createToolContext('cloak-read', undefined)
      const native = await createReadToolDefinition(dir).execute(
        'native',
        { path: '.env' },
        undefined,
        undefined,
        ctx,
      )
      const nativeResult = await session.extensionRunner.emitToolResult({
        ...readEvent('.env', ''),
        content: native.content,
      })
      expect(nativeResult?.content).toEqual([{ type: 'text', text: 'KEY=******' }])
      const bounded = await createBoundedReadTool(dir).execute(
        'files',
        { paths: ['.env', 'public.txt'] },
        undefined,
        undefined,
        ctx,
      )
      if (bounded.structuredContent === undefined) throw new Error('Missing structured read result')
      const transformed = await session.extensionRunner.emitToolResult({
        ...readEvent('', ''),
        input: { paths: ['.env', 'public.txt'] },
        content: bounded.content,
        structuredContent: bounded.structuredContent,
      })
      expect(JSON.stringify(transformed)).not.toContain('KEY=secret')
      expect(JSON.stringify(transformed)).toContain('KEY=public')
      const projection = await createBoundedReadTool(dir).execute(
        'projection',
        { path: 'secrets.json', json: '.token' },
        undefined,
        undefined,
        ctx,
      )
      if (projection.structuredContent === undefined) throw new Error('Missing JSON projection')
      const maskedProjection = await session.extensionRunner.emitToolResult({
        ...readEvent('secrets.json', ''),
        content: projection.content,
        structuredContent: projection.structuredContent,
      })
      expect(maskedProjection?.content).toEqual([{ type: 'text', text: '"s*****"' }])
      expect(maskedProjection?.structuredContent).not.toHaveProperty('value')
      await writeFile(
        join(agentDir, 'cloak.json'),
        JSON.stringify({ enabled: false, patterns: [envRule] }),
      )
      const command = session.extensionRunner.getCommand('cloak-status')
      expect(command).toBeDefined()
      if (command === undefined) throw new Error('Missing cloak-status command')
      await command.handler('', session.extensionRunner.createCommandContext())
      const unmasked = await session.extensionRunner.emitToolResult({
        ...readEvent('.env', ''),
        content: native.content,
      })
      expect(unmasked).toBeUndefined()
      expect(native.content).toEqual([{ type: 'text', text: 'KEY=secret' }])
    } finally {
      session.dispose()
    }
  })
})
