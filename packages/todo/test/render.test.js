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
    expect(renderHeader([], theme)).toBe('☑ Todo no todos')
    expect(renderHeader([item('cancelled', 'cancelled')], theme)).toBe('☑ Todo 1 task · all done')
    expect(renderHeader([item('done', 'completed')], theme)).toBe(
      '☑ Todo 1 task · 1 done · all done',
    )
    expect(renderHeader([item('active', 'in_progress')], theme)).toBe('☑ Todo 1 task')
    expect(
      renderHeader(
        [item('done', 'completed'), item('active', 'in_progress'), item('next', 'pending')],
        theme,
      ),
    ).toBe('☑ Todo 3 tasks · 1 done')
  })

  test('renders checkbox tree rows below the header', () => {
    expect(
      renderTodoLines(
        [item('done', 'completed'), item('active', 'in_progress'), item('next', 'pending')],
        theme,
        { expanded: false },
      ),
    ).toEqual(['☑ Todo 3 tasks · 1 done', '', '├─ ☑ ~done~', '├─ ☐ active', '└─ ☐ next'])
  })

  test('collapses long lists and expands on request', () => {
    const todos = Array.from({ length: 12 }, (_, index) => item(String(index), 'pending'))
    const collapsed = renderTodoLines(todos, theme, { expanded: false })
    expect(collapsed).toHaveLength(11)
    expect(collapsed.at(-1)).toBe('└─ … 4 more todos')
    expect(renderTodoLines(todos, theme, { expanded: true })).toHaveLength(14)
  })
})
