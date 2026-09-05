import { createEventBus } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vite-plus/test'

import ask from '../src/index.ts'

const params = {
  title: 'Language',
  questions: [
    {
      id: 'language',
      prompt: 'Which language?',
      options: [
        { id: 'ts', label: 'TypeScript' },
        { id: 'py', label: 'Python' },
      ],
      allowMultiple: false,
    },
  ],
}

function harness(mode = 'tui') {
  const tools = new Map()
  const messages = []
  const handlers = new Map()
  const states = []
  const reports = []
  const events = createEventBus()
  events.on('ask:state', (state) => states.push(state))
  events.on('hud:rail-action', (report) => reports.push(report))
  let promptDone
  let promptError
  let opened = 0
  const api = {
    events,
    on(name, handler) {
      const existing = handlers.get(name) ?? []
      existing.push(handler)
      handlers.set(name, existing)
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    sendMessage(message, options) {
      messages.push({ message, options })
    },
  }
  const theme = {
    bold(text) {
      return text
    },
    fg(_color, text) {
      return text
    },
  }
  const ctx = {
    mode,
    ui: {
      custom(factory) {
        opened += 1
        return new Promise((resolve, reject) => {
          promptDone = resolve
          promptError = reject
          factory({ requestRender() {} }, theme, {}, resolve)
        })
      },
    },
  }
  ask(api)
  const tool = tools.get('AskQuestion')
  if (tool === undefined) {
    throw new Error('AskQuestion was not registered')
  }
  return {
    tool,
    messages,
    reports,
    states,
    opened: () => opened,
    async emit(name, event = {}) {
      for (const handler of handlers.get(name) ?? []) await handler(event, ctx)
    },
    failPrompt() {
      promptError(new Error('UI failed'))
    },
    completePrompt(result) {
      if (promptDone === undefined) {
        throw new Error('No prompt is active')
      }
      promptDone(result)
    },
    renderCall(input, state = {}) {
      return tool
        .renderCall(input, theme, { state })
        .render(120)
        .map((line) => line.trimEnd())
    },
    enableRail() {
      events.emit('hud:rail-enabled', { enabled: true })
    },
    renderResult(result, input = params) {
      return tool
        .renderResult(result, { expanded: false }, theme, {
          args: input,
          toolCallId: 'call-1',
          invalidate() {},
          state: {},
        })
        .render(120)
        .map((line) => line.trimEnd())
    },
    execute(input, id = 'call-1', signal) {
      return tool.execute(id, input, signal, undefined, ctx)
    },
  }
}

describe('AskQuestion lifecycle', () => {
  it('registers the Pi tool name and schema', () => {
    const instance = harness()
    expect(instance.tool.name).toBe('AskQuestion')
    expect(instance.tool.parameters.required).toEqual(['title', 'questions'])
    expect(instance.tool.parameters.properties.questions.items.required).toEqual([
      'id',
      'prompt',
      'options',
      'allowMultiple',
    ])
  })

  it('rejects headless calls without an interactive prompt', async () => {
    const instance = harness('json')
    const result = await instance.execute(params)
    expect(result.details).toEqual({
      status: 'rejected',
      title: 'Language',
      questions: params.questions,
      reason: 'Questions skipped in headless mode',
    })
    expect(result.content[0].text).toBe('Questions skipped in headless mode')
  })

  it('returns synchronous answers through the tool result', async () => {
    const instance = harness()
    const pending = instance.execute(params)
    instance.completePrompt({
      kind: 'answered',
      answers: [{ questionId: 'language', selectedOptionIds: ['ts'], freeformText: '' }],
    })
    const result = await pending
    expect(result.details.status).toBe('success')
    expect(result.content[0].text).toContain('language: ts (TypeScript)')
    expect(instance.renderResult(result)).toEqual([
      '? Ask 1 question',
      '',
      '[language] options:2',
      'Which language?',
      ' ◉ TypeScript',
      ' ○ Python',
    ])
  })

  it('returns async status and later sends a follow-up message', async () => {
    const instance = harness()
    const result = await instance.execute({ ...params, runAsync: true })
    expect(result.details).toEqual({
      status: 'async',
      title: 'Language',
      questions: params.questions,
      originalToolCallId: 'call-1',
    })
    expect(instance.renderResult(result)).toEqual(['⏳ Ask awaiting async responses'])
    instance.completePrompt({
      kind: 'answered',
      answers: [{ questionId: 'language', selectedOptionIds: ['py'], freeformText: '' }],
    })
    await expect.poll(() => instance.messages.length).toBe(1)
    expect(instance.messages).toEqual([
      {
        message: {
          customType: 'ask-question-completion',
          content: 'User answered the questions:\n- language: py (Python)',
          display: false,
          details: {
            status: 'success',
            title: 'Language',
            questions: params.questions,
            answers: [{ questionId: 'language', selectedOptionIds: ['py'], freeformText: '' }],
          },
        },
        options: { triggerTurn: true, deliverAs: 'followUp' },
      },
    ])
    expect(instance.renderResult(result)).toContain(' ◉ Python')
  })

  it('keeps an async rail item pending until the form completes', async () => {
    const instance = harness()
    instance.enableRail()
    const result = await instance.execute({ ...params, runAsync: true })
    instance.renderCall(params)
    instance.renderResult(result)
    expect(instance.reports.at(-1).status).toBe('pending')

    instance.completePrompt({
      kind: 'answered',
      answers: [{ questionId: 'language', selectedOptionIds: ['py'], freeformText: '' }],
    })
    await expect.poll(() => instance.reports.at(-1).status).toBe('ok')
    expect(instance.reports.at(-1).summary).toBe('Python')
  })

  it('removes terminal controls from rendered question content', () => {
    const instance = harness()
    const [status, ...lines] = instance.renderCall({
      title: '\u001b]0;title\u0007Language\nchoice',
      questions: [
        {
          id: 'lang\u001b[2J',
          prompt: 'Which\nlanguage?\u001b[31m',
          options: [{ id: 'ts', label: 'Type\tScript\u001b[0m' }],
          allowMultiple: false,
        },
      ],
    })
    expect([status, ...lines].join('\n')).not.toContain('\u001b')
    expect(status).toContain('Language choice')
    expect(lines).toContain('Which language?')
    expect(lines).toContain(' ○ Type Script')
  })

  it('tracks queued forms until every question is answered', async () => {
    const instance = harness()
    await instance.execute({ ...params, runAsync: true }, 'one')
    await instance.execute({ ...params, runAsync: true }, 'two')
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 2, paused: false })
    instance.completePrompt({ kind: 'answered', answers: [] })
    await expect.poll(instance.opened).toBe(2)
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 1, paused: false })
    instance.completePrompt({ kind: 'answered', answers: [] })
    await expect.poll(() => instance.messages.length).toBe(2)
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: false })
  })

  it.each(['session_tree', 'session_shutdown'])(
    'discards open and queued forms on %s',
    async (event) => {
      const instance = harness()
      await instance.execute({ ...params, runAsync: true }, 'one')
      await instance.execute({ ...params, runAsync: true }, 'two')
      await instance.emit(event)
      instance.completePrompt({ kind: 'answered', answers: [] })
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(instance.messages).toEqual([])
      expect(instance.opened()).toBe(1)
      expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: false })
    },
  )

  it('pauses reminders after skipping without triggering an async turn', async () => {
    const instance = harness()
    await instance.execute({ ...params, runAsync: true })
    instance.completePrompt({ kind: 'skipped', reason: 'Questions skipped by user' })
    await expect.poll(() => instance.messages.length).toBe(1)
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: true })
    expect(instance.messages[0].options).toEqual({ triggerTurn: false, deliverAs: 'nextTurn' })
    await instance.emit('message_start', { message: { role: 'user' } })
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: false })
  })

  it('clears failed prompts and reports asynchronous errors', async () => {
    const instance = harness()
    await instance.execute({ ...params, runAsync: true })
    instance.failPrompt()
    await expect.poll(() => instance.messages.length).toBe(1)
    expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: false })
    expect(instance.messages[0].message.details).toMatchObject({
      status: 'error',
      errorMessage: 'UI failed',
    })
  })

  it.each([true, false])(
    'clears aborted prompts without resuming (async: %s)',
    async (runAsync) => {
      const instance = harness()
      const controller = new AbortController()
      const result = instance.execute({ ...params, runAsync }, 'one', controller.signal)
      controller.abort()
      await result
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(instance.states.at(-1)).toEqual({ version: 1, pending: 0, paused: true })
      expect(instance.messages).toEqual([])
    },
  )

  it('renders the call title and question count', () => {
    const instance = harness()
    expect(instance.renderCall(params)).toEqual([
      '⏳ Ask Language · 1 question',
      '',
      '[language] options:2',
      'Which language?',
      ' ○ TypeScript',
      ' ○ Python',
    ])
    expect(instance.renderCall(params, { hasResult: true })).toEqual([
      '⏳ Ask Language · 1 question',
    ])
  })
})
