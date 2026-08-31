import { describe, expect, it } from 'vite-plus/test'

import {
  decodeTodoReadDetails,
  decodeTodoWriteDetails,
  formatTodoReadResult,
  formatTodoWriteResult,
  needsInProgressTodos,
  readTodos,
  readyTaskIds,
  type Todo,
  updateTodos,
} from '../src/domain.ts'

const inspectTodo: Todo = {
  id: '1',
  content: 'Inspect',
  status: 'in_progress',
  createdAt: '10',
  updatedAt: '10',
  dependencies: [],
}

const implementTodo: Todo = {
  id: '2',
  content: 'Implement',
  status: 'pending',
  createdAt: '11',
  updatedAt: '11',
  dependencies: ['1'],
}

const currentTodos: Todo[] = [inspectTodo, implementTodo]

describe('updateTodos', () => {
  it('replaces the complete list and returns full protocol metadata', () => {
    const result = updateTodos(
      currentTodos,
      [{ id: '3', content: 'Verify', status: 'in_progress', dependencies: ['2'] }],
      false,
      100,
    )

    expect(result.todos).toEqual([
      {
        id: '3',
        content: 'Verify',
        status: 'in_progress',
        createdAt: '100',
        updatedAt: '100',
        dependencies: ['2'],
      },
    ])
    expect(result).toMatchObject({
      success: true,
      totalCount: 1,
      wasMerge: false,
      readyTaskIds: [],
      needsInProgressTodos: false,
      initialTodos: [
        { id: '1', content: 'Inspect', status: 'in_progress', dependencies: [] },
        { id: '2', content: 'Implement', status: 'pending', dependencies: ['1'] },
      ],
      finalTodos: [{ id: '3', content: 'Verify', status: 'in_progress', dependencies: ['2'] }],
    })
    expect(result.attachments).toEqual({
      originalTodos: result.initialTodos,
      updatedTodos: result.finalTodos,
      nudgeMessages: [],
      shouldShowTodoWriteReminder: false,
      todoReminderType: 'unspecified',
    })
  })

  it('merges by ID and preserves creation timestamps', () => {
    const result = updateTodos(
      currentTodos,
      [
        { id: '1', content: 'Inspect', status: 'completed' },
        { id: '3', content: 'Verify', status: 'in_progress', dependencies: ['2'] },
      ],
      true,
      100,
    )

    expect(result.todos).toEqual([
      {
        id: '1',
        content: 'Inspect',
        status: 'completed',
        createdAt: '10',
        updatedAt: '100',
        dependencies: [],
      },
      implementTodo,
      {
        id: '3',
        content: 'Verify',
        status: 'in_progress',
        createdAt: '100',
        updatedAt: '100',
        dependencies: ['2'],
      },
    ])
    expect(result.totalCount).toBe(3)
    expect(result.wasMerge).toBe(true)
    expect(result.readyTaskIds).toEqual(['2'])
  })

  it('preserves dependencies when a merge omits them', () => {
    const result = updateTodos(
      currentTodos,
      [{ id: '2', content: 'Implement now', status: 'in_progress' }],
      true,
      100,
    )

    expect(result.todos[1]?.dependencies).toEqual(['1'])
  })

  it('replaces dependencies when a merge supplies them', () => {
    const result = updateTodos(
      currentTodos,
      [{ id: '2', content: 'Implement now', status: 'pending', dependencies: [] }],
      true,
      100,
    )

    expect(result.todos[1]?.dependencies).toEqual([])
  })

  it('accepts duplicate IDs on replacement', () => {
    const result = updateTodos(
      [],
      [
        { id: 'dup', content: 'First', status: 'in_progress' },
        { id: 'dup', content: 'Second', status: 'pending' },
      ],
      false,
      100,
    )

    expect(result.todos).toHaveLength(2)
  })

  it('deduplicates IDs on merge with the last update', () => {
    const result = updateTodos(
      [
        ...currentTodos,
        {
          id: '1',
          content: 'Duplicate',
          status: 'pending',
          createdAt: '12',
          updatedAt: '12',
          dependencies: [],
        },
      ],
      [{ id: '1', content: 'Final', status: 'completed' }],
      true,
      100,
    )

    expect(result.todos).toEqual([
      {
        id: '1',
        content: 'Final',
        status: 'completed',
        createdAt: '12',
        updatedAt: '100',
        dependencies: [],
      },
      implementTodo,
    ])
  })

  it('clears with an empty replacement', () => {
    const result = updateTodos(currentTodos, [], false, 100)
    expect(result.todos).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.initialTodos).toHaveLength(2)
    expect(result.finalTodos).toEqual([])
    expect(result.attachments.updatedTodos).toEqual([])
  })

  it('keeps the list after an empty merge', () => {
    const result = updateTodos(currentTodos, [], true, 100)
    expect(result.todos).toEqual(currentTodos)
    expect(result.wasMerge).toBe(true)
  })
})

describe('task readiness', () => {
  it('returns pending tasks whose dependencies are complete', () => {
    const todos: Todo[] = [
      { ...inspectTodo, status: 'completed' },
      implementTodo,
      { ...implementTodo, id: '3', dependencies: ['missing'] },
    ]
    expect(readyTaskIds(todos)).toEqual(['2'])
  })

  it('requests an active task only while pending work remains', () => {
    expect(needsInProgressTodos([{ ...inspectTodo, status: 'pending' }])).toBe(true)
    expect(needsInProgressTodos([{ ...inspectTodo, status: 'completed' }])).toBe(false)
    expect(needsInProgressTodos([])).toBe(false)
  })
})

describe('tool result text', () => {
  it('matches the active success text', () => {
    expect(formatTodoWriteResult(currentTodos)).toBe(
      'Successfully updated TODOs. Make sure to follow and update your TODO list as you make progress. Cancel and add new TODO tasks as needed when the user makes a correction or follow-up request.\n\nHere are the latest contents of your todo list:\n- **IN_PROGRESS**: Inspect (id: 1)\n- **PENDING**: Implement (id: 2)',
    )
  })

  it('adds the exact missing-active reminder', () => {
    expect(formatTodoWriteResult([{ ...inspectTodo, status: 'pending' }])).toContain(
      'No TODOs are marked in-progress, make sure to mark them before starting the next.',
    )
  })

  it('matches the clear text without the missing-active reminder', () => {
    expect(formatTodoWriteResult([])).toBe(
      'Successfully updated TODOs. Make sure to follow and update your TODO list as you make progress. Cancel and add new TODO tasks as needed when the user makes a correction or follow-up request.\n\nHere are the latest contents of your todo list:',
    )
  })

  it('formats read results without a write message', () => {
    expect(formatTodoReadResult(currentTodos)).toBe(
      'Here are the latest contents of your todo list:\n- **IN_PROGRESS**: Inspect (id: 1)\n- **PENDING**: Implement (id: 2)',
    )
  })
})

describe('todo_read', () => {
  it('filters by status and ID', () => {
    expect(readTodos(currentTodos, { statusFilter: ['pending'] }).todos).toEqual([implementTodo])
    expect(readTodos(currentTodos, { idFilter: ['1'] }).todos).toEqual([inspectTodo])
    expect(readTodos(currentTodos, { statusFilter: ['pending'], idFilter: ['1'] }).todos).toEqual(
      [],
    )
  })

  it('decodes complete read details', () => {
    expect(decodeTodoReadDetails({ todos: currentTodos, totalCount: 2 })).toEqual({
      todos: currentTodos,
      totalCount: 2,
    })
    expect(decodeTodoReadDetails({ todos: currentTodos, totalCount: 1 })).toBeNull()
  })
})

describe('decodeTodoWriteDetails', () => {
  it('normalizes a legacy snapshot', () => {
    const decoded = decodeTodoWriteDetails({
      todos: currentTodos,
      totalCount: 2,
      wasMerge: true,
    })
    expect(decoded).toMatchObject({
      todos: currentTodos,
      totalCount: 2,
      wasMerge: true,
      success: true,
      readyTaskIds: [],
      needsInProgressTodos: false,
      initialTodos: [],
    })
    expect(decoded?.finalTodos).toEqual([
      { id: '1', content: 'Inspect', status: 'in_progress', dependencies: [] },
      { id: '2', content: 'Implement', status: 'pending', dependencies: ['1'] },
    ])
  })

  it('rejects an inconsistent snapshot', () => {
    expect(
      decodeTodoWriteDetails({ todos: currentTodos, totalCount: 1, wasMerge: true }),
    ).toBeNull()
  })
})
