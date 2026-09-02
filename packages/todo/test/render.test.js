import { describe, expect, test } from 'vite-plus/test'

import { renderHeader, renderTodoLines } from '../src/index.ts'

const theme = {
  bold(text) {
    return text
  },
  fg(_color, text) {
    return text
  },
  strikethrough(text) {
    return `~${text}~`
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

  test('renders checkbox tree rows below the header', () => {
    expect(
      renderTodoLines(
        [item('done', 'completed'), item('active', 'in_progress'), item('next', 'pending')],
        theme,
        { expanded: false },
      ),
    ).toEqual(['Working on 2 to-dos • 1 done', '├─ ☑ ~done~', '├─ ☐ active', '└─ ☐ next'])
  })

  test('collapses long lists and expands on request', () => {
    const todos = Array.from({ length: 12 }, (_, index) => item(String(index), 'pending'))
    const collapsed = renderTodoLines(todos, theme, { expanded: false })
    expect(collapsed).toHaveLength(10)
    expect(collapsed.at(-1)).toBe('└─ … 4 more todos')
    expect(renderTodoLines(todos, theme, { expanded: true })).toHaveLength(13)
  })
})
