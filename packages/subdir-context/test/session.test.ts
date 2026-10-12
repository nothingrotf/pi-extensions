import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type JsonObject,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import filetools from '@nothingrotf/filetools'
import { afterEach, expect, test } from 'vite-plus/test'

import subdirContext from '../src/index.ts'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function project(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'subdir-context-'))
  cleanups.push(() => rm(cwd, { force: true, recursive: true }))
  await writeFile(join(cwd, 'AGENTS.md'), 'ROOT_RULE\n')
  await mkdir(join(cwd, 'packages', 'app', 'src', 'deep'), { recursive: true })
  await mkdir(join(cwd, 'packages', 'other'), { recursive: true })
  await writeFile(join(cwd, 'packages', 'AGENTS.md'), 'PACKAGES_RULE\n')
  await writeFile(join(cwd, 'packages', 'app', 'CLAUDE.md'), 'APP_RULE\n')
  await writeFile(join(cwd, 'packages', 'app', 'src', 'deep', 'AGENTS.md'), 'DEEP_RULE\n')
  await writeFile(join(cwd, 'packages', 'app', 'src', 'index.ts'), 'export const a = 1\n')
  await writeFile(join(cwd, 'packages', 'other', 'AGENTS.md'), 'OTHER_RULE\n')
  return cwd
}

function text(context: TranscriptContext): string {
  return context.messages
    .map((message) =>
      Array.isArray(message.content)
        ? message.content.map((part) => (part.type === 'text' ? part.text : '')).join('')
        : message.content,
    )
    .join('\n')
}

type Step = { call?: { name: string; args: JsonObject } }

async function run(
  cwd: string,
  steps: readonly Step[],
  options: {
    codemode?: boolean
    filetools?: boolean
    noContextFiles?: boolean
    sessionManager?: SessionManager
  } = {},
) {
  const loader = new DefaultResourceLoader({
    agentDir: join(cwd, '.agent'),
    cwd,
    extensionFactories: [
      ...(options.codemode === true ? [createCodemodeExtension({ models: false })] : []),
      ...(options.filetools === true ? [filetools] : []),
      subdirContext,
    ],
    noContextFiles: options.noContextFiles ?? false,
    noExtensions: true,
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
    settingsManager: SettingsManager.inMemory(),
  })
  await loader.reload()
  const contexts: string[] = []
  const faux = fauxProvider({ models: [{ id: 'plain' }], provider: 'subdir-test' })
  faux.setResponses(
    steps.map((step, index) => (context: TranscriptContext) => {
      contexts.push(text(context))
      return step.call === undefined
        ? fauxAssistantMessage(fauxText('done'))
        : fauxAssistantMessage(fauxToolCall(step.call.name, step.call.args, { id: `c${index}` }), {
            stopReason: 'toolUse',
          })
    }),
  )
  const modelRuntime = await ModelRuntime.create({ refreshOnCreate: false })
  modelRuntime.registerNativeProvider(faux.provider)
  const model = modelRuntime.getModel('subdir-test', 'plain')
  if (model === undefined) throw new Error('The test model was not registered.')
  const sessionManager = options.sessionManager ?? SessionManager.inMemory(cwd)
  const { session } = await createAgentSession({
    cwd,
    model,
    modelRuntime,
    resourceLoader: loader,
    sessionManager,
    settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
    tools: [
      'read',
      'write',
      'ls',
      'find',
      'grep',
      ...(options.codemode === true ? ['codemode'] : []),
    ],
  })
  try {
    await session.prompt('Work.')
  } finally {
    session.dispose()
  }
  return { contexts, sessionManager }
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

test('loads the instruction chain of a read file once, outer first', async () => {
  const cwd = await project()
  const { contexts } = await run(cwd, [
    { call: { args: { path: 'packages/app/src/index.ts' }, name: 'read' } },
    { call: { args: { path: 'packages/app/src/index.ts' }, name: 'read' } },
    {},
  ])

  expect(contexts[0]).not.toContain('PACKAGES_RULE')
  const after = contexts[1] ?? ''
  expect(after.indexOf('PACKAGES_RULE')).toBeGreaterThan(-1)
  expect(after.indexOf('PACKAGES_RULE')).toBeLessThan(after.indexOf('APP_RULE'))
  expect(after).toContain('## packages/app/CLAUDE.md')
  expect(after).not.toContain('DEEP_RULE')
  expect(after).not.toContain('OTHER_RULE')
  expect(occurrences(contexts[2] ?? '', 'APP_RULE')).toBe(1)
})

test('loads every chain of a multi-file read and nothing for listed children', async () => {
  const cwd = await project()
  const { contexts } = await run(
    cwd,
    [
      { call: { args: { path: 'packages' }, name: 'ls' } },
      {
        call: {
          args: { paths: ['packages/other/AGENTS.md', 'packages/app/src/deep/AGENTS.md'] },
          name: 'read',
        },
      },
      {},
    ],
    { filetools: true },
  )

  expect(contexts[1]).toContain('PACKAGES_RULE')
  expect(contexts[1]).not.toContain('OTHER_RULE')
  expect(contexts[1]).not.toContain('APP_RULE')
  const after = contexts[2] ?? ''
  expect(after).toContain('OTHER_RULE')
  expect(after).toContain('APP_RULE')
  expect(after).toContain('DEEP_RULE')
  expect(occurrences(after, '## packages/AGENTS.md')).toBe(1)
})

test('treats calls from codemode scripts like direct calls', async () => {
  const cwd = await project()
  const { contexts } = await run(
    cwd,
    [
      {
        call: {
          args: { code: "return await tools.read({ path: 'packages/other/AGENTS.md' })" },
          name: 'codemode',
        },
      },
      {},
    ],
    { codemode: true },
  )

  expect(occurrences(contexts[1] ?? '', '## packages/other/AGENTS.md')).toBe(1)
})

test('reloads a changed file and keeps unchanged files out after resume', async () => {
  const cwd = await project()
  const sessionManager = SessionManager.inMemory(cwd)
  await run(cwd, [{ call: { args: { path: 'packages/other' }, name: 'ls' } }, {}], {
    sessionManager,
  })
  await writeFile(join(cwd, 'packages', 'AGENTS.md'), 'PACKAGES_RULE_V2\n')
  const { contexts } = await run(
    cwd,
    [{ call: { args: { path: 'packages/other' }, name: 'ls' } }, {}],
    { sessionManager },
  )

  const after = contexts[1] ?? ''
  expect(after).toContain('## packages/AGENTS.md (changed since it was loaded)')
  expect(after).toContain('PACKAGES_RULE_V2')
  expect(occurrences(after, 'OTHER_RULE')).toBe(1)
})

test('ignores paths outside the session root and symlinks that leave it', async () => {
  const cwd = await project()
  const outside = await mkdtemp(join(tmpdir(), 'subdir-context-outside-'))
  cleanups.push(() => rm(outside, { force: true, recursive: true }))
  await mkdir(join(outside, 'lib'))
  await writeFile(join(outside, 'lib', 'AGENTS.md'), 'OUTSIDE_RULE\n')
  await writeFile(join(outside, 'lib', 'file.ts'), 'x\n')
  const { symlink } = await import('node:fs/promises')
  await symlink(join(outside, 'lib'), join(cwd, 'linked'))
  const { contexts } = await run(cwd, [
    { call: { args: { path: join(outside, 'lib', 'file.ts') }, name: 'read' } },
    { call: { args: { path: 'linked/file.ts' }, name: 'read' } },
    {},
  ])

  expect(contexts.join('\n')).not.toContain('OUTSIDE_RULE')
})

test('skips a nested copy of an instruction file that Pi already loaded', async () => {
  const cwd = await project()
  await mkdir(join(cwd, 'worktrees', 'feature'), { recursive: true })
  await writeFile(join(cwd, 'worktrees', 'feature', 'AGENTS.md'), 'ROOT_RULE\n')
  const { contexts } = await run(cwd, [
    { call: { args: { path: 'worktrees/feature' }, name: 'ls' } },
    {},
  ])

  expect(contexts[1]).not.toContain('worktrees/feature/AGENTS.md')
})

test('loads nothing when the host disabled context files', async () => {
  const cwd = await project()
  const { contexts } = await run(
    cwd,
    [{ call: { args: { path: 'packages/app/src/index.ts' }, name: 'read' } }, {}],
    { noContextFiles: true },
  )

  expect(contexts[1]).not.toContain('APP_RULE')
})
