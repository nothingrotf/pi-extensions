import { Container, stripTerminalSequences, visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, test } from 'vite-plus/test'

import { renderGoalHudLines } from '../../goal/src/overlay.ts'
import { createGoalLoop } from '../../goal/src/state.ts'
import { renderSubagentHudLines } from '../../subagent/src/format.ts'
import { renderTodoHudLines } from '../../todo/src/overlay.ts'

const theme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => `\u001B[35m${text}\u001B[39m`,
  strikethrough: (text) => text,
}
const goal = {
  enabled: true,
  mode: 'active',
  loop: createGoalLoop(),
  goal: {
    id: 'goal',
    objective: 'Validar os fluxos do sistema',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    tokensUsed: 1200,
    tokenBudget: 5000,
    timeUsedSeconds: 65,
  },
}
const todos = [
  {
    id: 'task',
    content: 'Mapear telas, perfis e funcionalidades do sistema '.repeat(4),
    status: 'in_progress',
    dependencies: [],
    createdAt: '1',
    updatedAt: '1',
  },
]
function agent(background) {
  return {
    agentId: background ? 'background' : 'foreground',
    background,
    description: 'Mapear funcionalidades',
    status: 'running',
    running: true,
    model: 'openai/gpt-6-astra',
    subagentType: 'explore',
    startedAt: 1000,
    usage: { input: 27000, output: 500 },
    lastActivity: 'Read caminho '.repeat(20),
  }
}

function dock(mask) {
  const container = new Container()
  container.addChild({
    render: (width) => renderGoalHudLines(mask & 1 ? goal : undefined, theme, width),
    invalidate() {},
  })
  container.addChild({
    render: (width) => renderTodoHudLines(mask & 2 ? todos : [], theme, width, 31000),
    invalidate() {},
  })
  const agents = []
  if (mask & 4) agents.push(agent(false))
  if (mask & 8) agents.push(agent(true))
  container.addChild({
    render: (width) => renderSubagentHudLines(agents, theme, width, 31000),
    invalidate() {},
  })
  return container
}

describe('stacked editor panels', () => {
  test('separates Tasks, dispatch, background, and Goal with one blank row', () => {
    for (let mask = 1; mask < 16; mask += 1) {
      const lines = dock(mask).render(140).map(stripTerminalSequences)
      const titles = lines.flatMap((line, index) =>
        /Tasks|goal ·|dispatch ·|background ·/.test(line) ? [index] : [],
      )
      const count = [1, 2, 4, 8].filter((bit) => mask & bit).length
      expect(titles).toHaveLength(count)
      expect(titles[0]).toBe(0)
      for (const index of titles.slice(1)) {
        expect(lines[index - 1]).toBe('')
        expect(lines[index - 2]).not.toBe('')
      }
      expect(lines.filter((line) => line === '')).toHaveLength(count)
      expect(lines.at(-1)).toBe('')
    }
  })

  test('keeps equal side margins at narrow and wide terminal sizes', () => {
    const container = dock(15)
    for (let width = 1; width <= 180; width += 1) {
      const inset = Math.min(3, Math.floor((width - 1) / 2))
      for (const line of container.render(width).filter((line) => line.length > 0)) {
        const plain = stripTerminalSequences(line)
        expect(plain.startsWith(' '.repeat(inset))).toBe(true)
        expect(visibleWidth(line)).toBeLessThanOrEqual(width - inset)
      }
    }
  })

  test('insets right-aligned times and command hints by three columns', () => {
    const lines = dock(15).render(140).map(stripTerminalSequences)
    for (const label of ['/subagents', 'ctrl+shift+a', '/goal drop', '30s']) {
      const line = lines.find((item) => item.endsWith(label))
      expect(line).toBeDefined()
      expect(visibleWidth(line ?? '')).toBe(137)
    }
  })

  test('renders no spacers when all panels are absent', () => {
    expect(dock(0).render(140)).toEqual([])
    expect(
      renderSubagentHudLines(
        [{ ...agent(true), running: false, status: 'completed', endedAt: 1000 }],
        theme,
        140,
        31000,
      ),
    ).toEqual([])
  })
})
