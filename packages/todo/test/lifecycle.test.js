import { describe, expect, test, vi } from 'vite-plus/test'

import todo from '../src/index.ts'

function harness(branch = []) {
  const handlers = new Map()
  const tools = new Map()
  const statuses = new Map()
  const emitted = []
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
  }
  const ctx = {
    sessionManager: {
      getBranch() {
        return branch
      },
    },
    ui: {
      setStatus(key, value) {
        statuses.set(key, value)
      },
    },
  }
  const theme = {
    bold(text) {
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
        restoredTodos[1],
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
            dependencies: ['root'],
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
