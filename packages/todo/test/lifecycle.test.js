import { describe, expect, test, vi } from 'vite-plus/test'

import todo from '../src/index.ts'

function harness(branch = []) {
  const handlers = new Map()
  const tools = new Map()
  const statuses = new Map()
  const notices = []
  const emitted = []
  const messages = []
  const entries = []
  const commands = new Map()
  const renderers = new Map()
  let idle = true
  let editorAnswer
  let confirmAnswer = true
  let activeTools = ['read', 'bash', 'edit', 'write', 'todo_write', 'todo_read']
  let pending = false
  const api = {
    events: {
      emit(name, payload) {
        emitted.push({ name, payload })
      },
    },
    on(name, handler) {
      handlers.set(name, handler)
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    getActiveTools() {
      return [...activeTools]
    },
    sendMessage(message, options) {
      messages.push({ message, options })
    },
    appendEntry(customType, data) {
      entries.push({ type: 'custom', customType, data })
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
    registerMessageRenderer(customType, renderer) {
      renderers.set(customType, renderer)
    },
  }
  const ctx = {
    cwd: process.cwd(),
    hasUI: false,
    isIdle() {
      return idle
    },
    hasPendingMessages() {
      return pending
    },
    sessionManager: {
      getBranch() {
        return branch
      },
    },
    ui: {
      setStatus(key, value) {
        statuses.set(key, value)
      },
      notify(text, level) {
        notices.push({ text, level })
      },
      async editor() {
        return editorAnswer
      },
      async confirm() {
        return confirmAnswer
      },
    },
  }
  const theme = {
    bold(text) {
      return text
    },
    italic(text) {
      return text
    },
    fg(_color, text) {
      return text
    },
    strikethrough(text) {
      return text
    },
  }
  todo(api)
  return {
    async emit(name, event = {}) {
      const handler = handlers.get(name)
      if (handler === undefined) {
        throw new Error(`Missing ${name} handler`)
      }
      return handler(event, ctx)
    },
    async tool(name, params, toolCallId = 'call-1') {
      const tool = tools.get(name)
      if (tool === undefined) {
        throw new Error(`Missing ${name} tool`)
      }
      return tool.execute(toolCallId, params, undefined, undefined, ctx)
    },
    schema(name) {
      const tool = tools.get(name)
      if (tool === undefined) {
        throw new Error(`Missing ${name} tool`)
      }
      return tool.parameters
    },
    renderCall(name, params) {
      const tool = tools.get(name)
      if (tool?.renderCall === undefined) {
        throw new Error(`Missing ${name} call renderer`)
      }
      return tool
        .renderCall(params, theme)
        .render(120)
        .map((line) => line.trimEnd())
    },
    renderResult(name, result) {
      const tool = tools.get(name)
      if (tool?.renderResult === undefined) {
        throw new Error(`Missing ${name} result renderer`)
      }
      return tool
        .renderResult(result, { expanded: false }, theme)
        .render(120)
        .map((line) => line.trimEnd())
    },
    emitted,
    statuses,
    messages,
    entries,
    notices,
    async command(args) {
      return commands.get('todo').handler(args, ctx)
    },
    renderMessage(message) {
      return renderers.get(message.customType)(message, {}, theme).text
    },
    setIdle(value) {
      idle = value
    },
    setEditorAnswer(value) {
      editorAnswer = value
    },
    setConfirmAnswer(value) {
      confirmAnswer = value
    },
    setActiveTools(names) {
      activeTools = [...names]
    },
    setPending(value) {
      pending = value
    },
  }
}

function assistantStop(text, options = {}) {
  const content = []
  if (text.length > 0) {
    content.push({ type: 'text', text })
  }
  if (options.toolCall) {
    content.push({ type: 'toolCall', id: 't', name: 'read', arguments: {} })
  }
  return { role: 'assistant', content, stopReason: options.stopReason ?? 'stop' }
}

async function mutate(instance, count) {
  for (let index = 0; index < count; index += 1) {
    await instance.emit('tool_execution_end', {
      toolCallId: `m${index}`,
      toolName: 'edit',
      result: {},
      isError: false,
    })
  }
}

function toolResult(details) {
  return {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todo_write',
      details,
    },
  }
}

const restoredTodos = [
  {
    id: '1',
    content: 'Inspect',
    status: 'in_progress',
    createdAt: '10',
    updatedAt: '10',
    dependencies: [],
  },
  {
    id: '2',
    content: 'Implement',
    status: 'pending',
    createdAt: '11',
    updatedAt: '11',
    dependencies: ['1'],
  },
]

describe('todo lifecycle', () => {
  test('exposes todo_write and todo_read schemas', () => {
    const instance = harness()
    expect(instance.schema('todo_write').required).toEqual(['todos', 'merge'])
    expect(instance.schema('todo_read').properties.statusFilter.items.enum).toEqual([
      'pending',
      'in_progress',
      'completed',
      'cancelled',
      'blocked',
    ])
  })

  test('restores the latest valid branch snapshot before merge', async () => {
    const branch = [
      toolResult({ todos: restoredTodos, totalCount: 2, wasMerge: false }),
      toolResult({ todos: 'invalid', totalCount: 1, wasMerge: true }),
    ]
    const instance = harness(branch)
    await instance.emit('session_start')
    vi.useFakeTimers()
    vi.setSystemTime(100)
    try {
      const result = await instance.tool('todo_write', {
        merge: true,
        todos: [{ id: '1', content: 'Inspect', status: 'completed' }],
      })
      expect(result.details.todos).toEqual([
        {
          id: '1',
          content: 'Inspect',
          status: 'completed',
          createdAt: '10',
          updatedAt: '100',
          dependencies: [],
        },
        { ...restoredTodos[1], status: 'in_progress', updatedAt: '100' },
      ])
      expect(instance.statuses.get('todos')).toBe('todos 1/2')
    } finally {
      vi.useRealTimers()
    }
  })

  test('restores state after branch navigation', async () => {
    const instance = harness([
      toolResult({ todos: [restoredTodos[0]], totalCount: 1, wasMerge: true }),
    ])
    await instance.emit('session_tree')
    expect(instance.statuses.get('todos')).toBe('todos 0/1')
  })

  test('clears prior memory for a new empty conversation', async () => {
    const branch = [toolResult({ todos: restoredTodos, totalCount: 2, wasMerge: false })]
    const instance = harness(branch)
    await instance.emit('session_start')
    branch.splice(0)
    await instance.emit('session_tree')
    expect(instance.statuses.get('todos')).toBeUndefined()
    const result = await instance.tool('todo_read', {})
    expect(result.details).toEqual({ todos: [], totalCount: 0 })
  })

  test('reads restored state with combined filters', async () => {
    const instance = harness([toolResult({ todos: restoredTodos, totalCount: 2, wasMerge: false })])
    await instance.emit('session_start')
    const result = await instance.tool('todo_read', {
      statusFilter: ['pending'],
      idFilter: ['2'],
    })
    expect(result.details).toEqual({ todos: [restoredTodos[1]], totalCount: 1 })
  })

  test('emits update notifications', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool(
      'todo_write',
      {
        merge: false,
        todos: [
          {
            id: '1',
            content: 'Inspect',
            status: 'in_progress',
          },
        ],
      },
      'write-1',
    )
    expect(instance.emitted).toContainEqual({
      name: 'todo_update',
      payload: {
        toolCallId: 'write-1',
        todos: [{ id: '1', content: 'Inspect', status: 'in_progress' }],
        merge: false,
      },
    })
  })

  test('emits update notifications for clear operations', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', { merge: false, todos: [] }, 'clear-1')
    expect(instance.emitted).toEqual([
      {
        name: 'todo_update',
        payload: { toolCallId: 'clear-1', todos: [], merge: false },
      },
    ])
  })

  test('emits turn-start todo IDs', async () => {
    const instance = harness([toolResult({ todos: restoredTodos, totalCount: 2, wasMerge: false })])
    await instance.emit('session_start')
    await instance.emit('agent_start')
    expect(instance.emitted).toContainEqual({
      name: 'todo_turn_start_ids',
      payload: { todoIds: ['1', '2'] },
    })
  })

  test('clears state and status with an empty replacement', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'in_progress' }],
    })
    const params = { merge: false, todos: [] }
    expect(instance.renderCall('todo_write', params)).toEqual(['Clearing to-dos...'])
    const result = await instance.tool('todo_write', params)
    expect(result.details).toMatchObject({
      todos: [],
      totalCount: 0,
      wasMerge: false,
      success: true,
      finalTodos: [],
    })
    expect(instance.renderResult('todo_write', result)).toEqual(['Cleared to-dos'])
    expect(instance.statuses.get('todos')).toBeUndefined()
  })
})

describe('todo reminders', () => {
  test('reminds after a text-only stop with incomplete todos, at most three times per prompt', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [
        { id: '1', content: 'Inspect', status: 'in_progress' },
        { id: '2', content: 'Wait for ops', status: 'blocked', blocker: 'ops approval' },
      ],
    })
    await instance.emit('before_agent_start')
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await instance.emit('agent_end', { messages: [assistantStop('Done for now.')] })
      expect(instance.messages).toHaveLength(attempt)
      expect(instance.messages.at(-1)).toMatchObject({
        message: { customType: 'todo-reminder', display: true },
        options: { triggerTurn: true, deliverAs: 'followUp' },
      })
      expect(instance.messages.at(-1).message.content).toContain('1 incomplete todo item(s)')
      expect(instance.messages.at(-1).message.content).toContain('- Inspect (id: 1)')
      expect(instance.messages.at(-1).message.content).not.toContain('Wait for ops')
      expect(instance.messages.at(-1).message.content).toContain(`(Reminder ${attempt}/3)`)
      expect(instance.emitted.at(-1)).toMatchObject({
        name: 'todo_reminder',
        payload: { attempt, maxAttempts: 3, todos: [{ id: '1', status: 'in_progress' }] },
      })
      await instance.emit('before_agent_start')
      await instance.emit('tool_execution_end', {
        toolCallId: 'r',
        toolName: 'read',
        result: {},
        isError: false,
      })
    }
    await instance.emit('agent_end', { messages: [assistantStop('Still done.')] })
    expect(instance.messages).toHaveLength(3)

    await instance.emit('before_agent_start')
    await instance.emit('agent_end', { messages: [assistantStop('New prompt stop.')] })
    expect(instance.messages).toHaveLength(4)
  })

  test('stays silent while awaiting progress, on questions, on tool calls, and on aborts', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'pending' }],
    })
    await instance.emit('before_agent_start')
    await instance.emit('agent_end', { messages: [assistantStop('Which file should I edit?')] })
    expect(instance.messages).toHaveLength(0)
    await instance.emit('agent_end', { messages: [assistantStop('Please confirm.')] })
    expect(instance.messages).toHaveLength(0)
    await instance.emit('agent_end', { messages: [assistantStop('Working', { toolCall: true })] })
    expect(instance.messages).toHaveLength(0)
    await instance.emit('agent_end', { messages: [assistantStop('', { stopReason: 'aborted' })] })
    expect(instance.messages).toHaveLength(0)
    await instance.emit('agent_end', { messages: [assistantStop('Stopped.')] })
    expect(instance.messages).toHaveLength(1)
    await instance.emit('before_agent_start')
    await instance.emit('agent_end', { messages: [assistantStop('Stopped again without acting.')] })
    expect(instance.messages).toHaveLength(1)
  })

  test('skips reminders when todo_write is inactive, messages are pending, or todos are closed', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'pending' }],
    })
    await instance.emit('before_agent_start')
    instance.setPending(true)
    await instance.emit('agent_end', { messages: [assistantStop('Stopped.')] })
    expect(instance.messages).toHaveLength(0)
    instance.setPending(false)
    instance.setActiveTools(['read'])
    await instance.emit('agent_end', { messages: [assistantStop('Stopped.')] })
    expect(instance.messages).toHaveLength(0)
    instance.setActiveTools(['read', 'todo_write'])
    await instance.tool('todo_write', {
      merge: true,
      todos: [{ id: '1', content: 'Inspect', status: 'completed' }],
    })
    await instance.emit('agent_end', { messages: [assistantStop('Stopped.')] })
    expect(instance.messages).toHaveLength(0)
  })

  test('nudges after twelve mutations without a todo touch, at most twice per prompt', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'in_progress' }],
    })
    await instance.emit('before_agent_start')
    await mutate(instance, 11)
    expect(instance.messages).toHaveLength(0)
    await mutate(instance, 1)
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0]).toMatchObject({
      message: { customType: 'todo-mid-run-nudge', display: false },
      options: { triggerTurn: false, deliverAs: 'steer' },
    })
    expect(instance.messages[0].message.content).toContain('1 todo item remain open')
    await mutate(instance, 12)
    expect(instance.messages).toHaveLength(2)
    await mutate(instance, 12)
    expect(instance.messages).toHaveLength(2)

    await instance.emit('before_agent_start')
    await mutate(instance, 6)
    await instance.emit('tool_execution_end', {
      toolCallId: 'w',
      toolName: 'todo_write',
      result: {},
      isError: false,
    })
    await mutate(instance, 6)
    expect(instance.messages).toHaveLength(2)
    await mutate(instance, 6)
    expect(instance.messages).toHaveLength(3)
  })

  test('stores blocker notes only for blocked todos', async () => {
    const instance = harness()
    await instance.emit('session_start')
    const result = await instance.tool('todo_write', {
      merge: false,
      todos: [
        { id: '1', content: 'Ask user', status: 'blocked', blocker: ' user decision ' },
        { id: '2', content: 'Work', status: 'pending', blocker: 'ignored' },
      ],
    })
    expect(result.details.todos[0].blocker).toBe('user decision')
    expect(result.details.todos[1].blocker).toBeUndefined()
    expect(result.content[0].text).toContain('  - Ask user [blocked] (id: 1) (user decision)')
    const unblocked = await instance.tool('todo_write', {
      merge: true,
      todos: [{ id: '1', content: 'Ask user', status: 'pending' }],
    })
    expect(unblocked.details.todos[0].blocker).toBeUndefined()
    expect(instance.renderResult('todo_write', unblocked)).toEqual([
      'Working on 2 to-dos',
      '◐ Work',
      '○ Ask user',
    ])
    expect(instance.renderResult('todo_write', result)[0]).toBe('Working on 2 to-dos')
    expect(instance.renderResult('todo_write', result).at(-1)).toBe('⊘ Ask user (user decision)')
  })
})

function userEditEntry(instance) {
  return instance.entries.filter((entry) => entry.customType === 'pi-todo-user-edit').at(-1)
}

describe('/todo command', () => {
  async function seeded() {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [
        { id: 'inspect', content: 'Inspect code', status: 'completed' },
        { id: 'impl', content: 'Implement change', status: 'in_progress' },
        { id: 'verify', content: 'Verify behavior', status: 'pending', dependencies: ['impl'] },
      ],
    })
    return instance
  }

  test('shows the list as markdown and help', async () => {
    const instance = await seeded()
    await instance.command('')
    expect(instance.notices.at(-1).text).toBe(
      [
        '# Todos',
        '- [x] #inspect Inspect code',
        '- [/] #impl Implement change',
        '- [ ] #verify Verify behavior <!-- deps: impl -->',
      ].join('\n'),
    )
    await instance.command('help')
    expect(instance.notices.at(-1).text).toContain('/todo edit')
    await instance.command('bogus')
    expect(instance.notices.at(-1).level).toBe('error')
  })

  test('mutates status by id or text, persists a user edit, and informs the model', async () => {
    const instance = await seeded()
    await instance.command('done impl')
    expect(instance.notices.at(-1).text).toBe('Todo list updated (/todo done #impl).')
    expect(userEditEntry(instance).data.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['inspect', 'completed'],
      ['impl', 'completed'],
      ['verify', 'in_progress'],
    ])
    expect(instance.messages.at(-1)).toMatchObject({
      message: { customType: 'todo-user-edit', display: false },
      options: { triggerTurn: false, deliverAs: 'nextTurn' },
    })
    expect(instance.messages.at(-1).message.content).toContain(
      'The user manually modified the todo list (/todo done #impl).',
    )
    expect(instance.emitted.at(-1)).toMatchObject({
      name: 'todo_update',
      payload: { toolCallId: null, merge: false },
    })

    await instance.command('block verify: waiting on ops')
    expect(userEditEntry(instance).data.todos[2]).toMatchObject({
      status: 'blocked',
      blocker: 'waiting on ops',
    })
    await instance.command('unblock verif')
    expect(userEditEntry(instance).data.todos[2]).toMatchObject({ status: 'in_progress' })
    expect(userEditEntry(instance).data.todos[2].blocker).toBeUndefined()

    instance.setIdle(false)
    await instance.command('start #verify')
    expect(instance.messages.at(-1).options.deliverAs).toBe('steer')

    await instance.command('done nothing-here')
    expect(instance.notices.at(-1)).toEqual({
      text: 'No task matches "nothing-here".',
      level: 'warning',
    })
  })

  test('reports ambiguous matches and prefers a single active match', async () => {
    const instance = await seeded()
    await instance.command('done e')
    expect(instance.notices.at(-1).level).toBe('warning')
    expect(instance.notices.at(-1).text).toBe('Ambiguous task "e": #inspect, #impl, #verify')
    await instance.command('done code')
    expect(instance.notices.at(-1).text).toBe('Todo list updated (/todo done #inspect).')
  })

  test('appends, removes, and clears with the removal notice', async () => {
    const instance = await seeded()
    await instance.command('append Write release notes!')
    expect(userEditEntry(instance).data.todos.at(-1)).toMatchObject({
      id: 'write-release-notes',
      status: 'pending',
    })
    await instance.command('rm verify')
    expect(userEditEntry(instance).data.todos.map((todo) => todo.id)).toEqual([
      'inspect',
      'impl',
      'write-release-notes',
    ])
    expect(instance.messages.at(-1).message.content).toContain('intentionally removed the entries')
    instance.setConfirmAnswer(false)
    await instance.command('rm')
    expect(userEditEntry(instance).data.todos).toHaveLength(3)
    instance.setConfirmAnswer(true)
    await instance.command('rm')
    expect(userEditEntry(instance).data.todos).toEqual([])
    expect(instance.messages.at(-1).message.content).toContain(
      'intentionally cleared the todo list',
    )
    expect(instance.statuses.get('todos')).toBeUndefined()
  })

  test('edits through the editor and rejects invalid markdown', async () => {
    const instance = await seeded()
    instance.setEditorAnswer('- [x] #impl Implement change\n- [ ] Ship it')
    await instance.command('edit')
    expect(userEditEntry(instance).data.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['impl', 'completed'],
      ['ship-it', 'in_progress'],
    ])
    instance.setEditorAnswer('- [?] broken')
    await instance.command('edit')
    expect(instance.notices.at(-1).level).toBe('error')
    expect(userEditEntry(instance).data.todos).toHaveLength(2)
    instance.setEditorAnswer(undefined)
    await instance.command('edit')
    expect(userEditEntry(instance).data.todos).toHaveLength(2)
  })

  test('restores user edits over older tool results', async () => {
    const instance = harness([
      toolResult({ todos: restoredTodos, totalCount: 2, wasMerge: false }),
      {
        type: 'custom',
        customType: 'pi-todo-user-edit',
        data: { todos: [{ ...restoredTodos[0], status: 'completed' }] },
      },
      { type: 'custom', customType: 'pi-todo-user-edit', data: { todos: 'nope' } },
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolName: 'todo_write',
          isError: true,
          details: { todos: restoredTodos, totalCount: 2, wasMerge: true },
        },
      },
    ])
    await instance.emit('session_start')
    const result = await instance.tool('todo_read', {})
    expect(result.details.todos.map((todo) => [todo.id, todo.status])).toEqual([['1', 'completed']])
  })

  test('renders the visible reminder', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'pending' }],
    })
    await instance.emit('before_agent_start', { prompt: 'go', systemPrompt: '' })
    await instance.emit('agent_end', { messages: [assistantStop('Stopped.')] })
    expect(instance.renderMessage(instance.messages.at(-1).message)).toBe(
      'Todo reminder 1/3: 1 incomplete\n  ○ Inspect',
    )
    expect(instance.renderMessage({ customType: 'todo-reminder', content: 'x' })).toBe(
      'Todo reminder',
    )
  })
})

describe('eager prelude', () => {
  async function userTurn(instance, text) {
    await instance.emit('input', { text, source: 'interactive' })
    return instance.emit('before_agent_start', { prompt: text, systemPrompt: '' })
  }

  test('injects the prelude only on the first user prompt with no todos', async () => {
    const branch = []
    const instance = harness(branch)
    await instance.emit('session_start')
    expect(
      await instance.emit('before_agent_start', { prompt: 'custom trigger', systemPrompt: '' }),
    ).toBeUndefined()
    const byDefault = await userTurn(instance, 'do it')
    expect(byDefault.message.customType).toBe('eager-todo-prelude')
    expect(byDefault.message.content).toContain('Consider calling `todo_write` first')
    await instance.command('eager off')
    expect(await userTurn(instance, 'do it')).toBeUndefined()
    await instance.command('eager always')
    expect(instance.entries.at(-1)).toEqual({
      type: 'custom',
      customType: 'pi-todo-eager',
      data: { mode: 'always' },
    })
    const always = await userTurn(instance, 'do it')
    expect(always.message.content).toContain('You MUST call `todo_write` first')
    expect(await userTurn(instance, 'why?')).toBeUndefined()
    branch.push({ type: 'message', message: { role: 'user', content: 'again' } })
    expect(await userTurn(instance, 'again')).toBeUndefined()
    await instance.command('eager')
    expect(instance.notices.at(-1).text).toContain('Todo eager mode: always')
  })

  test('restores the eager mode and skips when todos exist', async () => {
    const instance = harness([
      { type: 'custom', customType: 'pi-todo-eager', data: { mode: 'always' } },
    ])
    await instance.emit('session_start')
    expect((await userTurn(instance, 'do it')).message.content).toContain('You MUST call')
    await instance.tool('todo_write', {
      merge: false,
      todos: [{ id: '1', content: 'Inspect', status: 'pending' }],
    })
    expect(await userTurn(instance, 'do it')).toBeUndefined()
  })
})
