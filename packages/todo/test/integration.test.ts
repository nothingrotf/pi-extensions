import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  type AssistantMessage,
  type Context,
} from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent'
import { describe, expect, test } from 'vite-plus/test'

import type { AskQuestionInput } from '../../ask/src/domain.ts'
import ask from '../../ask/src/index.ts'
import todo from '../src/index.ts'
import { questionUI } from './question-ui.js'

type Content = AssistantMessage['content']

function text(value = 'Stopped.'): Content {
  return [{ type: 'text', text: value }]
}

function call(
  name: string,
  args:
    | AskQuestionInput
    | {
        merge?: boolean
        todos?: { id: string; content: string; status: string; dependencies?: string[] }[]
        path?: string
        content?: string
        command?: string
      },
): Content {
  return [{ type: 'toolCall', id: crypto.randomUUID(), name, arguments: args }]
}

function seed(): Content {
  return call('todo_write', {
    merge: false,
    todos: [{ id: 'task', content: 'Inspect the isolated test workspace', status: 'pending' }],
  })
}

function contentText(content: Context['messages'][number]['content']): string {
  return Array.isArray(content)
    ? content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    : content
}

async function harness(extra?: ExtensionFactory, extraFirst = false, interactive = false) {
  const dir = await mkdtemp(join(tmpdir(), 'pi-todo-test-'))
  const events: string[] = []
  const requests: string[][] = []
  const steps: Content[] = []
  const extensionErrors: string[] = []
  let unexpectedRequests = 0
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  })
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: join(dir, 'models.json'),
    modelsStorePath: join(dir, 'models-store.json'),
    allowModelNetwork: false,
  })
  modelRuntime.registerProvider('todo-test', {
    api: 'todo-test',
    apiKey: 'local-test',
    baseUrl: 'http://127.0.0.1/unused',
    models: [
      {
        id: 'scripted',
        name: 'Scripted test',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 100_000,
        maxTokens: 8_000,
      },
    ],
    streamSimple(model, context) {
      requests.push(context.messages.map((message) => contentText(message.content)))
      const next = steps.shift()
      if (next === undefined) unexpectedRequests += 1
      const content = next ?? text('Unexpected request. Which task requires user approval?')
      const stopReason = content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop'
      const message: AssistantMessage = {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content,
        stopReason,
        timestamp: Date.now(),
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'start', partial: message })
      stream.push({ type: 'done', reason: stopReason, message })
      stream.end()
      return stream
    },
  })
  const factories: ExtensionFactory[] = [todo]
  if (extra !== undefined) {
    if (extraFirst) factories.unshift(extra)
    else factories.push(extra)
  }
  factories.push((pi) => {
    pi.on('before_agent_start', () => {
      events.push('before_agent_start')
    })
    pi.on('agent_start', () => {
      events.push('agent_start')
    })
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: join(dir, 'agent'),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noThemes: true,
    noPromptTemplates: true,
    systemPromptOverride: () => 'Use the scripted test provider.',
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    extensionFactories: factories,
  })
  await resourceLoader.reload()
  const model = modelRuntime.getModel('todo-test', 'scripted')
  if (model === undefined) throw new Error('The test model is absent.')
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: join(dir, 'agent'),
    model,
    modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(dir),
    thinkingLevel: 'off',
  })
  const ui = questionUI(session.extensionRunner.getUIContext())
  await session.bindExtensions({
    mode: interactive ? 'tui' : 'print',
    uiContext: interactive ? ui.ui : session.extensionRunner.getUIContext(),
    onError: (error) => {
      extensionErrors.push(error.error)
    },
  })
  return {
    events,
    requests,
    session,
    ui,
    async respond(content: Content[], key: string) {
      steps.push(...content)
      ui.press(key)
      await expect.poll(() => steps.length).toBe(0)
      await session.agent.waitForIdle()
      await expect.poll(() => session.isIdle).toBe(true)
      expect(unexpectedRequests).toBe(0)
      expect(extensionErrors).toEqual([])
    },
    async prompt(content: Content[], prompt = 'Perform the test task') {
      steps.push(...content)
      await session.prompt(prompt)
      expect(session.isIdle).toBe(true)
      expect(steps).toHaveLength(0)
      expect(unexpectedRequests).toBe(0)
      expect(extensionErrors).toEqual([])
    },
    customMessages(customType: string) {
      return session.messages.filter(
        (message) => message.role === 'custom' && message.customType === customType,
      )
    },
    async close() {
      await session.abort()
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      ui.close()
      session.dispose()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const question: AskQuestionInput = {
  title: 'Target',
  questions: [
    {
      id: 'target',
      prompt: 'Which target should receive the change?',
      options: [
        { id: 'staging', label: 'Staging' },
        { id: 'production', label: 'Production' },
      ],
      allowMultiple: false,
    },
  ],
}

const materialDecision = [
  'Como você quer finalizar essa skill?',
  '1. Manter como PR próprio empilhado.',
  '2. Mover o commit para dentro do PR existente.',
  '3. Outra alternativa.',
  'Enquanto isso não toco no stack nem spawno mais nada.',
].join('\n')

describe('todo and AskQuestion through AgentSession', () => {
  test.each([true, false])(
    'waits for async answers with ask registered first: %s',
    async (first) => {
      const instance = await harness(ask, first, true)
      try {
        await instance.prompt([
          seed(),
          call('AskQuestion', { ...question, runAsync: true }),
          text('Posso continuar?'),
        ])
        expect(instance.customMessages('todo-reminder')).toHaveLength(0)
        expect(instance.ui.opened).toHaveLength(1)
        await instance.respond(
          [text('Should I continue?'), text('Continuing the approved task.')],
          '\r',
        )
        expect(instance.customMessages('ask-question-completion')).toHaveLength(1)
        expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      } finally {
        await instance.close()
      }
    },
  )

  test.each([true, false])(
    'does not nag after the user skips a form (async: %s)',
    async (runAsync) => {
      const instance = await harness(ask, false, true)
      try {
        const run = instance.prompt([
          seed(),
          call('AskQuestion', { ...question, runAsync }),
          text('Should I continue?'),
        ])
        await expect.poll(() => instance.ui.opened.length).toBe(1)
        instance.ui.press('\u001b')
        await run
        expect(instance.customMessages('todo-reminder')).toHaveLength(0)
        await instance.prompt(
          [text('Should I continue?'), text('Continuing.')],
          'Continue the approved task',
        )
        expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      } finally {
        await instance.close()
      }
    },
  )

  test('keeps waiting when only one of two queued async forms is answered', async () => {
    const instance = await harness(ask, false, true)
    try {
      await instance.prompt([
        seed(),
        call('AskQuestion', { ...question, runAsync: true }),
        call('AskQuestion', { ...question, runAsync: true }),
        text('Should I continue?'),
      ])
      await instance.respond([text('Should I continue?')], '\r')
      expect(instance.ui.opened).toHaveLength(2)
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
      await instance.respond([text('Should I continue?'), text('Continuing.')], '\r')
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('clears synchronous answered questions', async () => {
    const instance = await harness(ask, false, true)
    try {
      const run = instance.prompt([
        seed(),
        call('AskQuestion', question),
        text('Should I continue?'),
        text('Continuing.'),
      ])
      await expect.poll(() => instance.ui.opened.length).toBe(1)
      instance.ui.press('\r')
      await run
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('headless skipped questions do not leave a phantom pending form', async () => {
    const instance = await harness(ask)
    try {
      await instance.prompt([
        seed(),
        call('AskQuestion', { ...question, runAsync: true }),
        text('Should I continue?'),
        text('Continuing.'),
      ])
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      expect(instance.ui.opened).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('keeps material conversational decisions with ask loaded', async () => {
    const instance = await harness(ask)
    try {
      await instance.prompt([seed(), text(materialDecision)])
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('does not nudge while async questions remain open', async () => {
    const instance = await harness(ask, false, true)
    try {
      await instance.prompt([
        seed(),
        call('AskQuestion', { ...question, runAsync: true }),
        ...Array.from({ length: 12 }, (_, index) =>
          call('write', { path: 'result.txt', content: String(index) }),
        ),
        text('Awaiting the open form.'),
      ])
      expect(instance.customMessages('todo-mid-run-nudge')).toHaveLength(0)
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('session shutdown closes an async question without a stale follow-up', async () => {
    const instance = await harness(ask, false, true)
    try {
      await instance.prompt([
        seed(),
        call('AskQuestion', { ...question, runAsync: true }),
        text('Waiting.'),
      ])
      await instance.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'reload' })
      instance.ui.press('\r')
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(instance.customMessages('ask-question-completion')).toHaveLength(0)
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })
})

describe('todo reminders through AgentSession', () => {
  test('waits for a real extension UI prompt even without ask loaded', async () => {
    let opened = false
    let pending: Promise<boolean> | undefined
    const instance = await harness(
      (pi) => {
        pi.on('agent_end', (_event, ctx) => {
          if (opened) return
          opened = true
          pending = ctx.ui.custom<boolean>((_tui, _theme, _keys, done) => ({
            render: () => ['Choose the deployment target'],
            invalidate() {},
            handleInput: () => done(true),
          }))
        })
      },
      false,
      true,
    )
    try {
      await instance.prompt([seed(), text('Should I continue?')])
      expect(instance.ui.opened).toHaveLength(1)
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
      instance.ui.press('\r')
      await pending
      await instance.prompt(
        [text('Should I continue?'), text('Continuing.')],
        'Continue the approved task',
      )
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('respects a real abort while a question tool is running', async () => {
    const instance = await harness(ask, false, true)
    try {
      const run = instance.prompt([seed(), call('AskQuestion', question)])
      await expect.poll(() => instance.ui.opened.length).toBe(1)
      await instance.session.abort()
      await run
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('resets the cycle on each user prompt without a synthetic continuation hook', async () => {
    const instance = await harness()
    try {
      await instance.prompt([seed(), text(), text()])
      expect(instance.events).toEqual(['before_agent_start', 'agent_start', 'agent_start'])
      await instance.prompt([text(), text()], 'Continue the task')
      expect(instance.customMessages('todo-reminder')).toHaveLength(2)
      expect(instance.events.filter((event) => event === 'before_agent_start')).toHaveLength(2)
    } finally {
      await instance.close()
    }
  })

  test.each(['read', 'todo_read'])('does not count %s as progress', async (name) => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        text(),
        call(name, name === 'read' ? { path: 'missing.txt' } : {}),
        text(),
      ])
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('resets the cycle when a queued user message reaches the model', async () => {
    let queued = false
    const instance = await harness((pi) => {
      pi.on('tool_execution_end', (event) => {
        if (queued || event.toolName !== 'todo_read') return
        queued = true
        pi.sendUserMessage('Continue with the next user request', { deliverAs: 'followUp' })
      })
    })
    try {
      await instance.prompt([
        seed(),
        text(),
        call('todo_read', {}),
        text('Which task requires approval?'),
        text(),
        text(),
      ])
      expect(instance.customMessages('todo-reminder')).toMatchObject([
        { details: { attempt: 1 } },
        { details: { attempt: 1 } },
      ])
      expect(instance.events.filter((event) => event === 'before_agent_start')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test.each(['error', 'aborted', 'length'] satisfies AssistantMessage['stopReason'][])(
    'settles the original prompt when a reminder ends with %s',
    async (stopReason) => {
      const instance = await harness((pi) => {
        pi.on('message_end', (event) => {
          if (
            event.message.role !== 'assistant' ||
            !event.message.content.some(
              (part) => part.type === 'text' && part.text === 'Stop the reminder.',
            )
          )
            return
          return {
            message: {
              ...event.message,
              stopReason,
              errorMessage: 'The test interrupted the reminder.',
            },
          }
        })
      })
      try {
        await instance.prompt([seed(), text(), text('Stop the reminder.')])
        expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      } finally {
        await instance.close()
      }
    },
  )

  test('caps continuations at three and resets the cap for the next prompt', async () => {
    const instance = await harness()
    try {
      const writes = Array.from({ length: 3 }, (_, index) => [
        call('write', { path: 'result.txt', content: String(index) }),
        text(),
      ]).flat()
      await instance.prompt([seed(), text(), ...writes])
      expect(instance.customMessages('todo-reminder')).toHaveLength(3)
      await instance.prompt([text(), text()], 'Continue with a fresh prompt')
      expect(instance.customMessages('todo-reminder')).toHaveLength(4)
    } finally {
      await instance.close()
    }
  })

  test.each(['Stop.', 'Cancel the remaining tasks.', 'Please pause.', 'Pare.', 'Não continue.'])(
    'respects user stop requests: %s',
    async (prompt) => {
      const instance = await harness()
      try {
        await instance.prompt([seed(), text('Which target should I use?')])
        await instance.prompt([text('Should I continue?')], prompt)
        expect(instance.customMessages('todo-reminder')).toHaveLength(0)
        await instance.prompt(
          [text('Should I continue?'), text('Continuing.')],
          'Continue the approved task',
        )
        expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      } finally {
        await instance.close()
      }
    },
  )

  test.each(['Posso continuar?', 'Should I continue?', 'Ready. **Posso continuar?**'])(
    'does not let redundant permission silence actionable tasks: %s',
    async (question) => {
      const instance = await harness()
      try {
        await instance.prompt([seed(), text(question), text('Continuing the approved task.')])
        expect(instance.customMessages('todo-reminder')).toHaveLength(1)
      } finally {
        await instance.close()
      }
    },
  )

  test.each([
    materialDecision,
    'Should I continue with the production deployment?',
    'Posso continuar? Which target should I use?',
    'Qual arquivo devo alterar?',
    'Qual opção prefere?',
    'Confirme antes de continuar.',
    '**Which file should I edit?**',
    '## Which file should I edit?',
    '続行しますか？',
  ])('waits for the user after %s', async (question) => {
    const instance = await harness()
    try {
      await instance.prompt([seed(), text(question)])
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
      expect(instance.requests).toHaveLength(2)
    } finally {
      await instance.close()
    }
  })

  test.each([
    'Example:\n```text\nWhich branch should I use?\n```\nWork remains.',
    '> Example:\nWhich branch should I use?\n\nWork remains.',
    '`Example:\nWhich branch should I use?\n`\n\nWork remains.',
  ])('does not treat a question in an example as a user prompt: %s', async (example) => {
    const instance = await harness()
    try {
      await instance.prompt([seed(), text(example), text()])
      expect(instance.customMessages('todo-reminder')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('does not continue an empty assistant response', async () => {
    const instance = await harness()
    try {
      await instance.prompt([seed(), []])
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test.each([true, false])(
    'waits for another extension follow-up with earlier registration %s',
    async (extraFirst) => {
      let sent = false
      const instance = await harness((pi) => {
        pi.on('agent_end', () => {
          if (sent) return
          sent = true
          pi.sendMessage(
            {
              customType: 'other-follow-up',
              content: 'Ask the user before further work.',
              display: false,
            },
            { triggerTurn: true, deliverAs: 'followUp' },
          )
        })
      }, extraFirst)
      try {
        await instance.prompt([seed(), text(), text('Qual arquivo devo alterar?')])
        expect(instance.customMessages('todo-reminder')).toHaveLength(0)
        expect(instance.customMessages('other-follow-up')).toHaveLength(1)
        expect(instance.requests).toHaveLength(3)
      } finally {
        await instance.close()
      }
    },
  )

  test('reports a rejected write as an error and preserves the list', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        call('todo_write', {
          merge: true,
          todos: [
            { id: 'task', content: 'Duplicate one', status: 'pending' },
            { id: 'task', content: 'Duplicate two', status: 'pending' },
          ],
        }),
        call('todo_read', {}),
        text('Which task requires user approval?'),
      ])
      const writes = instance.session.messages.filter(
        (message) => message.role === 'toolResult' && message.toolName === 'todo_write',
      )
      expect(writes[1]).toMatchObject({ isError: true })
      const read = instance.session.messages.find(
        (message) => message.role === 'toolResult' && message.toolName === 'todo_read',
      )
      expect(read).toMatchObject({
        details: {
          todos: [
            { id: 'task', content: 'Inspect the isolated test workspace', status: 'in_progress' },
          ],
        },
      })
    } finally {
      await instance.close()
    }
  })

  test('rejects a cycle introduced by a merge and preserves the dependency graph', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        call('todo_write', {
          merge: false,
          todos: [
            { id: 'a', content: 'First task', status: 'pending' },
            { id: 'b', content: 'Second task', status: 'pending', dependencies: ['a'] },
          ],
        }),
        call('todo_write', {
          merge: true,
          todos: [{ id: 'a', content: 'First task', status: 'pending', dependencies: ['b'] }],
        }),
        call('todo_read', {}),
        text('Which task requires approval?'),
      ])
      const writes = instance.session.messages.filter(
        (message) => message.role === 'toolResult' && message.toolName === 'todo_write',
      )
      expect(writes[1]).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('cycle') }],
      })
      const read = instance.session.messages.find(
        (message) => message.role === 'toolResult' && message.toolName === 'todo_read',
      )
      expect(read).toMatchObject({
        details: {
          todos: [
            { id: 'a', dependencies: [] },
            { id: 'b', dependencies: ['a'] },
          ],
        },
      })
    } finally {
      await instance.close()
    }
  })

  test('does not remind about tasks that wait on blocked dependencies', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        call('todo_write', {
          merge: false,
          todos: [
            { id: 'approval', content: 'Wait for approval', status: 'blocked' },
            {
              id: 'deploy',
              content: 'Deploy the approved change',
              status: 'pending',
              dependencies: ['approval'],
            },
          ],
        }),
        text('The user must approve the change first.'),
      ])
      expect(instance.customMessages('todo-reminder')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('counts task completion but not a no-op write as progress', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        call('todo_write', {
          merge: false,
          todos: [
            { id: 'a', content: 'First tracked task', status: 'pending' },
            { id: 'b', content: 'Second tracked task', status: 'pending' },
          ],
        }),
        text(),
        call('todo_write', {
          merge: true,
          todos: [{ id: 'a', content: 'First tracked task', status: 'completed' }],
        }),
        text(),
        call('todo_write', {
          merge: true,
          todos: [{ id: 'b', content: 'Second tracked task', status: 'in_progress' }],
        }),
        text(),
      ])
      expect(instance.customMessages('todo-reminder')).toHaveLength(2)
    } finally {
      await instance.close()
    }
  })

  test('does not count read-only shell calls as file mutations', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        ...Array.from({ length: 12 }, () => call('bash', { command: 'printf audit' })),
        text('Which task requires user approval?'),
      ])
      expect(instance.customMessages('todo-mid-run-nudge')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('evaluates nudges only after a full tool batch includes its todo update', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        ...Array.from({ length: 11 }, (_, index) =>
          call('write', { path: 'result.txt', content: String(index) }),
        ),
        [...call('write', { path: 'result.txt', content: 'last' }), ...seed()],
        text('Which task requires approval?'),
      ])
      expect(instance.customMessages('todo-mid-run-nudge')).toHaveLength(0)
    } finally {
      await instance.close()
    }
  })

  test('does not let rejected todo updates reset the nudge counter', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        ...Array.from({ length: 11 }, (_, index) =>
          call('write', { path: 'result.txt', content: String(index) }),
        ),
        call('todo_write', {
          merge: true,
          todos: [{ id: 'task', content: '', status: 'pending' }],
        }),
        call('write', { path: 'result.txt', content: 'last' }),
        text('Which task requires approval?'),
      ])
      expect(instance.customMessages('todo-mid-run-nudge')).toHaveLength(1)
    } finally {
      await instance.close()
    }
  })

  test('delivers at most two nudges to the model during the current prompt', async () => {
    const instance = await harness()
    try {
      await instance.prompt([
        seed(),
        ...Array.from({ length: 36 }, (_, index) =>
          call('write', { path: 'result.txt', content: String(index) }),
        ),
        text('Which task requires user approval?'),
      ])
      const nudges = instance.customMessages('todo-mid-run-nudge')
      expect(nudges).toHaveLength(2)
      expect(
        instance.requests
          .at(-1)
          ?.filter((message) => message.includes('since the last todo_write call')),
      ).toHaveLength(2)
      await instance.prompt(
        [
          ...Array.from({ length: 12 }, (_, index) =>
            call('write', { path: 'result.txt', content: String(index) }),
          ),
          text('Which task requires approval?'),
        ],
        'Continue with a fresh user prompt',
      )
      expect(instance.customMessages('todo-mid-run-nudge')).toHaveLength(3)
    } finally {
      await instance.close()
    }
  })
})
