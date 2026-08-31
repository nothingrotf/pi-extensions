import { describe, expect, test } from 'vite-plus/test'

import { TodoOverlay } from '../src/overlay.ts'

const theme = {
  fg(_color, text) {
    return text
  },
  strikethrough(text) {
    return `~${text}~`
  },
}

function todo(id, status, dependencies = []) {
  return {
    id,
    content: id,
    status,
    createdAt: '1',
    updatedAt: '1',
    dependencies,
  }
}

function harness(initialTodos) {
  let todos = initialTodos
  let component
  const widgetCalls = []
  const tui = { requestRender() {} }
  const ui = {
    theme,
    setWidget(key, factory, options) {
      widgetCalls.push({ key, factory, options })
      if (factory !== undefined) {
        component = factory(tui, theme)
      }
    },
  }
  const overlay = new TodoOverlay(() => todos)
  overlay.setUI(ui)
  return {
    overlay,
    render(width = 120) {
      if (component === undefined) {
        throw new Error('Widget is not registered')
      }
      return component.render(width)
    },
    setTodos(nextTodos) {
      todos = nextTodos
    },
    widgetCalls,
  }
}

describe('persistent todo tree', () => {
  test('renders the reference tree layout', () => {
    const instance = harness([
      todo('done', 'completed'),
      todo('active', 'in_progress'),
      todo('pending', 'pending', ['done']),
    ])
    instance.overlay.update()
    expect(instance.widgetCalls[0]).toMatchObject({
      key: 'todos',
      options: { placement: 'aboveEditor' },
    })
    expect(instance.render()).toEqual([
      '● Todos (1/3)',
      '├─ ✓ #done ~done~',
      '├─ ◐ #active active',
      '└─ ○ #pending pending ⛓ #done',
      '',
    ])
  })

  test('hides completed rows after the next agent run', () => {
    const instance = harness([todo('done', 'completed'), todo('next', 'pending')])
    instance.overlay.update()
    expect(instance.render()).toContain('├─ ✓ ~done~')
    instance.overlay.hideCompletedFromPreviousRun()
    expect(instance.render()).toEqual(['● Todos (0/1)', '└─ ○ next', ''])
  })

  test('keeps active rows within the row budget', () => {
    const instance = harness(
      Array.from({ length: 14 }, (_, index) => todo(String(index + 1), 'pending')),
    )
    instance.overlay.update()
    const lines = instance.render()
    expect(lines).toContain('└─ +3 more (3 pending)')
    expect(lines.filter((line) => line.includes('○')).length).toBe(11)
  })

  test('removes the widget when no visible rows remain', () => {
    const instance = harness([todo('active', 'in_progress')])
    instance.overlay.update()
    instance.setTodos([])
    instance.overlay.update()
    expect(instance.widgetCalls.at(-1)).toEqual({
      key: 'todos',
      factory: undefined,
      options: undefined,
    })
  })

  test('sanitizes terminal control sequences', () => {
    const instance = harness([todo('\u001b[31munsafe', 'pending')])
    instance.overlay.update()
    expect(instance.render()).toContain('└─ ○ unsafe')
  })
})
