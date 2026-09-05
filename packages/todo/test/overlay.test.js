import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test, vi } from 'vite-plus/test'

import { renderTodoHudLines, TodoOverlay } from '../src/overlay.ts'

const theme = {
  bg(_color, text) {
    return text
  },
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
  const requestRender = vi.fn()
  const tui = { requestRender }
  const ui = {
    theme,
    setWidget(key, factory, options) {
      widgetCalls.push({ key, factory, options })
      if (factory !== undefined) component = factory(tui, theme)
    },
  }
  const overlay = new TodoOverlay(() => todos)
  overlay.setUI(ui)
  return {
    overlay,
    render(width = 120) {
      if (component === undefined) throw new Error('Widget is not registered')
      return component.render(width)
    },
    setTodos(nextTodos) {
      todos = nextTodos
    },
    widgetCalls,
    requestRender,
  }
}

describe('persistent todo panel', () => {
  test('renders the Empryo task panel', () => {
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
    const lines = instance.render()
    expect(lines[0]).toMatch(/^    Tasks 1\/3 ▾$/)
    expect(lines[1]).toContain('+1 done')
    expect(lines[2]).toContain('○ active')
    expect(lines[2]).toContain('active')
    expect(lines[3]).toContain('○ pending')
    expect(lines.join('\n')).not.toMatch(/[╭╮╯│]/)
    expect(lines.every((line) => visibleWidth(line) <= 120)).toBe(true)
    instance.overlay.dispose()
  })

  test('animates only during active execution and stops the timer while idle', () => {
    vi.useFakeTimers()
    const instance = harness([todo('OBS-60', 'in_progress')])
    try {
      instance.overlay.update()
      const idle = instance.render()
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(160)
      expect(instance.render()).toEqual(idle)
      expect(instance.requestRender).not.toHaveBeenCalled()
      instance.overlay.setWorking(true)
      const working = instance.render()
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(80)
      expect(instance.render()).not.toEqual(working)
      expect(instance.requestRender).toHaveBeenCalled()
      instance.overlay.setWorking(false)
      const stopped = instance.render()
      expect(stopped.join('\n')).toContain('○ OBS-60')
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(1000)
      expect(instance.render()).toEqual(stopped)
      expect(instance.requestRender).not.toHaveBeenCalled()
      instance.overlay.setWorking(true)
      expect(instance.render().join('\n')).not.toContain('○ OBS-60')
    } finally {
      instance.overlay.dispose()
      vi.useRealTimers()
    }
  })

  test('hides completed state after the next agent run', () => {
    const instance = harness([todo('done', 'completed'), todo('next', 'pending')])
    instance.overlay.update()
    expect(instance.render().join('\n')).toContain('+1 done')
    instance.overlay.hideCompletedFromPreviousRun()
    const rendered = instance.render().join('\n')
    expect(rendered).toContain('Tasks 0/1')
    expect(rendered).toContain('○ next')
    expect(rendered).not.toContain('+1 done')
    expect(instance.render().join('\n')).not.toContain('+1 done')
    instance.overlay.dispose()
  })

  test('keeps active rows within the row budget', () => {
    const instance = harness(
      Array.from({ length: 14 }, (_, index) => todo(String(index + 1), 'pending')),
    )
    instance.overlay.update()
    const lines = instance.render()
    expect(lines.join('\n')).toContain('+8 more')
    expect(lines.filter((line) => line.includes('○')).length).toBe(6)
    expect(lines).toHaveLength(9)
    expect(lines.at(-1)).toBe('')
    instance.overlay.dispose()
  })

  test('summarizes closed rows before the active row', () => {
    const instance = harness([
      todo('a', 'completed'),
      todo('b', 'completed'),
      todo('c', 'cancelled'),
      todo('d', 'in_progress'),
    ])
    instance.overlay.update()
    const rendered = instance.render().join('\n')
    expect(rendered).toContain('Tasks 2/4')
    expect(rendered).toContain('+2 done')
    expect(rendered).toContain('+1 dropped')
    expect(rendered).toContain('d')
    instance.overlay.dispose()
  })

  test('expires an all-settled panel after three seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    try {
      const completed = todo('done', 'completed')
      completed.updatedAt = '10000'
      const instance = harness([completed])
      instance.overlay.update()
      expect(instance.render().join('\n')).toContain('+1 done')
      vi.advanceTimersByTime(2_999)
      expect(instance.render().join('\n')).toContain('+1 done')
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(1)
      expect(instance.requestRender).toHaveBeenCalled()
      expect(instance.render()).toEqual([])
      instance.overlay.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('starts the settled linger after the final open task is removed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(20_000)
    try {
      const instance = harness([todo('old-done', 'completed'), todo('active', 'in_progress')])
      instance.overlay.update()
      instance.setTodos([todo('old-done', 'completed')])
      instance.overlay.update()
      expect(instance.render().join('\n')).toContain('+1 done')
      vi.advanceTimersByTime(2_999)
      expect(instance.render().join('\n')).toContain('+1 done')
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(1)
      expect(instance.requestRender).toHaveBeenCalled()
      expect(instance.render()).toEqual([])
      instance.overlay.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('restarts the settled linger for a changed closed snapshot', () => {
    vi.useFakeTimers()
    vi.setSystemTime(30_000)
    try {
      const instance = harness([todo('old-done', 'completed')])
      instance.overlay.update()
      expect(instance.render()).toEqual([])
      instance.setTodos([todo('old-done', 'completed'), todo('new-done', 'completed')])
      instance.overlay.update()
      expect(instance.render().join('\n')).toContain('+2 done')
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(3_000)
      expect(instance.requestRender).toHaveBeenCalled()
      expect(instance.render()).toEqual([])
      instance.overlay.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('restarts animation when a hidden task reopens', () => {
    vi.useFakeTimers()
    vi.setSystemTime(40_000)
    try {
      const instance = harness([todo('task', 'completed'), todo('next', 'pending')])
      instance.overlay.update()
      instance.overlay.hideCompletedFromPreviousRun()
      instance.setTodos([todo('task', 'in_progress')])
      instance.overlay.update()
      instance.overlay.setWorking(true)
      const before = instance.render().join('\n')
      instance.requestRender.mockClear()
      vi.advanceTimersByTime(80)
      const after = instance.render().join('\n')
      expect(instance.requestRender).toHaveBeenCalled()
      expect(after).not.toBe(before)
      instance.overlay.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps the widget registered and renders nothing when empty', () => {
    const instance = harness([todo('active', 'in_progress')])
    instance.overlay.update()
    instance.setTodos([])
    instance.overlay.update()
    expect(instance.widgetCalls).toHaveLength(1)
    expect(instance.render()).toEqual([])
    instance.overlay.dispose()
  })

  test('sanitizes terminal control sequences', () => {
    const instance = harness([todo('\u001b[31munsafe', 'pending')])
    instance.overlay.update()
    expect(instance.render().join('\n')).toContain('○ unsafe')
    instance.overlay.dispose()
  })

  test('leaves the terminal background unchanged', () => {
    const surfaceStart = '\u001B[48;2;1;2;3m'
    const surfaceEnd = '\u001B[49m'
    const surfaceTheme = {
      ...theme,
      bg(_color, text) {
        return `${surfaceStart}${text}${surfaceEnd}`
      },
    }
    const lines = renderTodoHudLines([todo('active', 'in_progress')], surfaceTheme, 120, 0)
    expect(lines.every((line) => line.split(surfaceStart).length === 1)).toBe(true)
    expect(lines.every((line) => line.split(surfaceEnd).length === 1)).toBe(true)
  })

  test('aligns widgets with the three-space text inset', () => {
    const todos = [todo('active', 'in_progress')]
    for (const item of [
      { inset: 3, width: 55 },
      { inset: 3, width: 56 },
      { inset: 3, width: 79 },
      { inset: 3, width: 80 },
      { inset: 3, width: 109 },
      { inset: 3, width: 110 },
    ]) {
      expect(renderTodoHudLines(todos, theme, item.width, 0)[0]?.match(/^ */)?.[0].length).toBe(
        item.inset,
      )
    }
  })

  test('fits every responsive width', () => {
    const todos = [todo('active', 'in_progress'), todo('pending', 'pending')]
    for (let width = 8; width <= 140; width += 1) {
      expect(
        renderTodoHudLines(todos, theme, width, 0).every((line) => visibleWidth(line) <= width),
      ).toBe(true)
    }
  })
})
