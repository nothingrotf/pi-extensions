import { describe, expect, test } from 'vite-plus/test'

import type { Todo } from '../src/domain.ts'
import { markdownToTodos, todosToMarkdown } from '../src/markdown.ts'

const todos: Todo[] = [
  {
    id: 'a',
    content: 'Inspect code',
    status: 'completed',
    createdAt: '1',
    updatedAt: '2',
    dependencies: [],
  },
  {
    id: 'b',
    content: 'Implement change',
    status: 'in_progress',
    createdAt: '1',
    updatedAt: '1',
    dependencies: ['a'],
  },
  {
    id: 'c',
    content: 'Ask ops',
    status: 'blocked',
    createdAt: '1',
    updatedAt: '1',
    dependencies: [],
    blocker: 'ops\napproval',
  },
  {
    id: 'd',
    content: 'Skip it',
    status: 'cancelled',
    createdAt: '1',
    updatedAt: '1',
    dependencies: [],
  },
  {
    id: 'e',
    content: 'Verify',
    status: 'pending',
    createdAt: '1',
    updatedAt: '1',
    dependencies: ['b', 'c'],
  },
]

describe('todo markdown', () => {
  test('renders one checklist line per todo with notes in a comment', () => {
    expect(todosToMarkdown(todos)).toBe(
      [
        '# Todos',
        '- [x] #a Inspect code',
        '- [/] #b Implement change <!-- deps: a -->',
        '- [!] #c Ask ops <!-- blocker: ops approval -->',
        '- [-] #d Skip it',
        '- [ ] #e Verify <!-- deps: b, c -->',
        '',
      ].join('\n'),
    )
    expect(todosToMarkdown([])).toBe('# Todos\n')
  })

  test('round-trips and keeps timestamps for unchanged items', () => {
    const parsed = markdownToTodos(todosToMarkdown(todos), todos, 99)
    expect(parsed.errors).toEqual([])
    expect(parsed.todos.map((todo) => todo.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(parsed.todos[0]).toMatchObject({ status: 'completed', createdAt: '1', updatedAt: '2' })
    expect(parsed.todos[2]).toMatchObject({
      status: 'blocked',
      blocker: 'ops approval',
      updatedAt: '99',
    })
    expect(parsed.todos[4]?.dependencies).toEqual(['b', 'c'])
  })

  test('accepts escaped brackets, missing ids, and reports bad lines', () => {
    const parsed = markdownToTodos(
      [
        '# Plan',
        '- \\[x\\] #a Inspect code',
        '* [ ] Write the tests!',
        '- [ ] Write the tests!',
        '- [?] #z Unknown',
        'not an item',
        '- [ ] #w Waits <!-- deps: nope -->',
        '- [ ]   ',
      ].join('\n'),
      todos,
      5,
    )
    expect(parsed.todos.map((todo) => [todo.id, todo.status])).toEqual([
      ['a', 'completed'],
      ['write-the-tests', 'pending'],
      ['write-the-tests-2', 'pending'],
      ['w', 'pending'],
    ])
    expect(parsed.errors).toEqual([
      'Line 5: unknown marker "[?]"',
      'Line 6: not a checklist item',
      'Line 8: empty task',
      'Todo "w" depends on unknown id "nope"',
    ])
  })
})
