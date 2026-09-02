import { describe, expect, it } from 'vite-plus/test'

import {
  formatTodoReadResult,
  formatTodoSummary,
  formatTodoWriteResult,
  needsInProgressTodos,
  readyTaskIds,
  type Todo,
  updateTodos,
  validateTodoWrite,
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

  it('rejects duplicate ids, blank content, self and unknown dependencies', () => {
    expect(
      validateTodoWrite(
        [],
        [
          { id: 'dup', content: 'First', status: 'in_progress' },
          { id: 'dup', content: 'Second', status: 'pending' },
          { id: ' ', content: '', status: 'pending' },
          { id: 'self', content: 'Self', status: 'pending', dependencies: ['self'] },
          { id: 'orphan', content: 'Orphan', status: 'pending', dependencies: ['nope'] },
        ],
        false,
      ),
    ).toEqual([
      'Duplicate id "dup" in todos',
      'Todo id cannot be blank',
      'Todo " " has blank content',
      'Todo "self" depends on itself',
      'Todo "orphan" depends on unknown id "nope"',
    ])
    expect(
      validateTodoWrite(
        currentTodos,
        [{ id: '3', content: 'Verify', status: 'pending', dependencies: ['1'] }],
        true,
      ),
    ).toEqual([])
    expect(
      validateTodoWrite(
        currentTodos,
        [{ id: '3', content: 'Verify', status: 'pending', dependencies: ['1'] }],
        false,
      ),
    ).toEqual(['Todo "3" depends on unknown id "1"'])
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
      { ...implementTodo, status: 'in_progress', updatedAt: '100' },
    ])
  })

  it('auto-promotes the first ready pending task and keeps one in_progress', () => {
    const promoted = updateTodos(
      [],
      [
        { id: 'a', content: 'A', status: 'pending', dependencies: ['b'] },
        { id: 'b', content: 'B', status: 'pending' },
        { id: 'c', content: 'C', status: 'blocked', blocker: 'ops' },
      ],
      false,
      100,
    )
    expect(promoted.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['a', 'pending'],
      ['b', 'in_progress'],
      ['c', 'blocked'],
    ])

    const demoted = updateTodos(
      [],
      [
        { id: 'a', content: 'A', status: 'in_progress' },
        { id: 'b', content: 'B', status: 'in_progress' },
      ],
      false,
      100,
    )
    expect(demoted.todos.map((todo) => todo.status)).toEqual(['in_progress', 'pending'])

    const waiting = updateTodos(
      [],
      [
        { id: 'a', content: 'A', status: 'pending', dependencies: ['b'] },
        { id: 'b', content: 'B', status: 'blocked' },
      ],
      false,
      100,
    )
    expect(waiting.todos.map((todo) => todo.status)).toEqual(['pending', 'blocked'])
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
  it('summarizes remaining, closed, and blocked items', () => {
    const todos: Todo[] = [
      ...currentTodos,
      { ...inspectTodo, id: '3', content: 'Verify', status: 'completed' },
      { ...inspectTodo, id: '4', content: 'Wait', status: 'blocked', blocker: 'ops' },
      { ...inspectTodo, id: '5', content: 'Skip', status: 'cancelled' },
    ]
    expect(formatTodoWriteResult(todos)).toBe(
      [
        'Remaining items (2):',
        '  - Inspect [in_progress] (id: 1)',
        '  - Implement [pending] (id: 2) needs: 1',
        'Closed: 1 completed, 1 cancelled. Blocked: 1.',
        '  - Wait [blocked] (id: 4) (ops)',
      ].join('\n'),
    )
  })

  it('explains a list where no task is ready', () => {
    expect(formatTodoWriteResult([{ ...implementTodo, dependencies: ['9'] }])).toContain(
      'No task is in progress: every pending task waits on a dependency.',
    )
  })

  it('reports cleared lists and errors', () => {
    expect(formatTodoWriteResult([])).toBe('Todo list cleared.')
    expect(formatTodoSummary([], ['Duplicate id "x" in todos'])).toBe(
      'Errors: Duplicate id "x" in todos\nTodo list unchanged (empty).',
    )
    expect(formatTodoSummary(currentTodos, ['bad'])).toContain('Errors: bad\nRemaining items (2):')
  })

  it('formats read results as a full list', () => {
    expect(formatTodoReadResult(currentTodos)).toBe(
      'Here are the latest contents of your todo list:\n- **IN_PROGRESS**: Inspect (id: 1)\n- **PENDING**: Implement (id: 2) needs: 1',
    )
  })
})
