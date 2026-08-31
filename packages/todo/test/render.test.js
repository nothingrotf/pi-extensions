import { describe, expect, test } from 'vite-plus/test'

import { orderedVisibleTodos, renderHeader } from '../src/index.ts'

const theme = {
  bold(text) {
    return text
  },
  fg(_color, text) {
    return text
  },
}

function item(id, status) {
  return {
    id,
    content: id,
    status,
    createdAt: '1',
    updatedAt: '1',
    dependencies: [],
  }
}

describe('todo rendering', () => {
  test('renders exact header states', () => {
    expect(renderHeader([], theme)).toBe('No to-dos found')
    expect(renderHeader([item('cancelled', 'cancelled')], theme)).toBe('All done')
    expect(renderHeader([item('done', 'completed')], theme)).toBe('All done')
    expect(renderHeader([item('active', 'in_progress')], theme)).toBe('Working on 1 to-do')
    expect(
      renderHeader(
        [item('done', 'completed'), item('active', 'in_progress'), item('next', 'pending')],
        theme,
      ),
    ).toBe('Working on 2 to-dos • 1 done')
  })

  test('groups completed, active, and pending items', () => {
    const ordered = orderedVisibleTodos([
      item('pending', 'pending'),
      item('cancelled', 'cancelled'),
      item('active', 'in_progress'),
      item('done', 'completed'),
    ])
    expect(ordered.map((todo) => todo.id)).toEqual(['done', 'active', 'pending'])
  })
})
