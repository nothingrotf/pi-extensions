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
  let promptDone
  const api = {
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
        return new Promise((resolve) => {
          promptDone = resolve
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
    completePrompt(result) {
      if (promptDone === undefined) {
        throw new Error('No prompt is active')
      }
      promptDone(result)
    },
    renderCall(input) {
      return tool
        .renderCall(input, theme)
        .render(120)
        .map((line) => line.trimEnd())
    },
    renderResult(result) {
      return tool
        .renderResult(result, { expanded: false }, theme, {
          toolCallId: 'call-1',
          invalidate() {},
        })
        .render(120)
        .map((line) => line.trimEnd())
    },
    execute(input) {
      return tool.execute('call-1', input, undefined, undefined, ctx)
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
    expect(instance.renderResult(result)).toContain('1. Which language?')
    expect(instance.renderResult(result)).toContain('  [x] TypeScript')
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
    expect(instance.renderResult(result)).toEqual(['Awaiting async responses'])
    instance.completePrompt({
      kind: 'answered',
      answers: [{ questionId: 'language', selectedOptionIds: ['py'], freeformText: '' }],
    })
    await Promise.resolve()
    await Promise.resolve()
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
    expect(instance.renderResult(result)).toContain('  [x] Python')
  })

  it('renders the call title and question count', () => {
    const instance = harness()
    expect(instance.renderCall(params)).toEqual(['AskQuestion Language (1)'])
  })
})
