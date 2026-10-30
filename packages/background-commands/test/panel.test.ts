import { visibleWidth } from '@earendil-works/pi-tui'
import { describe, expect, it } from 'vite-plus/test'

import {
  type CommandsView,
  type PanelTheme,
  renderCommandsDock,
  SETTLE_LINGER_MS,
} from '../src/dock.ts'
import { lastLogLine, logLines } from '../src/format.ts'
import { createCommandsPane } from '../src/peek.ts'
import type { CommandOutput, CommandSnapshot } from '../src/schema.ts'

const plain: PanelTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (_color, text) => text,
}

const tagged: PanelTheme = {
  bg: (_color, text) => text,
  bold: (text) => text,
  fg: (color, text) => `<${color}>${text}`,
}

function running(id: string, name: string, startedAt: number): CommandSnapshot {
  return { id, sessionId: 'session', name, command: `run ${id}`, startedAt, status: 'running' }
}

function failed(id: string, name: string, startedAt: number, finishedAt: number): CommandSnapshot {
  return {
    id,
    sessionId: 'session',
    name,
    command: `run ${id}`,
    startedAt,
    finishedAt,
    status: 'error',
    exitCode: 2,
    errorMessage: 'The command exited with code 2.',
  }
}

function view(
  snapshots: CommandSnapshot[],
  outputs: ReadonlyArray<readonly [string, CommandOutput]> = [],
): CommandsView & { snapshots: CommandSnapshot[]; outputs: Map<string, CommandOutput> } {
  const state = {
    snapshots,
    outputs: new Map(outputs),
    list: () => state.snapshots,
    output: (id: string) => state.outputs.get(id),
  }
  return state
}

describe('log text', () => {
  it('returns the last visible line without terminal controls or progress redraws', () => {
    expect(lastLogLine('first\n\u001b[32mready\u001b[0m on :3000\n\n  \n')).toBe('ready on :3000')
    expect(lastLogLine('build 10%\rbuild 50%\rbuild 100%\r\n')).toBe('build 100%')
    expect(lastLogLine('tab\there\u0007\u202e')).toBe('tab here')
    expect(lastLogLine('\n\n')).toBe('')
  })

  it('keeps line structure and drops trailing blank lines', () => {
    expect(logLines('a\r\n  b\n\u001b[1mc\u001b[0m\n\n')).toEqual(['a', '  b', 'c'])
  })
})

describe('editor dock', () => {
  it('renders nothing without active or recently settled commands', () => {
    const now = 100_000
    expect(renderCommandsDock(view([]), plain, 80, now)).toEqual([])
    expect(
      renderCommandsDock(view([failed('old', 'Old', 0, now - SETTLE_LINGER_MS)]), plain, 80, now),
    ).toEqual([])
  })

  it('lists active commands newest first with the latest log line', () => {
    const now = 125_000
    const lines = renderCommandsDock(
      view(
        [running('server', 'Server', 0), running('tests', 'Tests', 60_000)],
        [['server', { text: 'booting\n\u001b[32mready\u001b[0m on :3000\n', truncated: false }]],
      ),
      plain,
      100,
      now,
    )
    expect(lines).toEqual([
      expect.stringMatching(/^ {3}⚙ bg · 2 ▾ +2m5s$/u),
      '   ├─ ● Tests  1m5s  $ run tests',
      '   ╰─ ● Server  2m5s  ready on :3000',
      expect.stringMatching(/^ {3}↯ logs and stop in the panel +ctrl\+shift\+b$/u),
      '',
    ])
  })

  it('keeps a settled row for the linger interval with its outcome', () => {
    const now = 10_000
    const lines = renderCommandsDock(
      view(
        [failed('build', 'Build', 4_000, now - 100)],
        [['build', { text: 'compiling\nerror: boom\n', truncated: false }]],
      ),
      tagged,
      80,
      now,
    )
    expect(lines[0]).toContain('<error>⚙ bg · 1 ▾')
    expect(lines[1]).toContain('<error>✗')
    expect(lines[1]).toContain('<error>exit 2')
    expect(lines[1]).toContain('error: boom')
    expect(lines[2]).toContain('settled')
    expect(lines[2]).not.toContain('ctrl+shift+b')
  })

  it('bounds visible rows and fits every width', () => {
    const snapshots = Array.from({ length: 8 }, (_, index) =>
      running(`id-${index}`, `Command ${index} 😀 中`, index * 1000),
    )
    const commands = view(snapshots, [
      ['id-7', { text: `${'wide 中 '.repeat(40)}\n`, truncated: false }],
    ])
    const lines = renderCommandsDock(commands, plain, 120, 10_000)
    expect(lines.filter((line) => line.includes('● '))).toHaveLength(5)
    expect(lines).toContainEqual('   ╰─ +3 more')
    for (let width = 1; width <= 120; width += 1) {
      for (const line of renderCommandsDock(commands, plain, width, 10_000))
        expect(visibleWidth(line)).toBeLessThanOrEqual(width)
    }
    expect(renderCommandsDock(commands, plain, 50, 10_000).join('\n')).not.toContain('wide')
  })
})

describe('command pane', () => {
  function pane(commands: CommandsView, stopped: string[] = []) {
    let closed = false
    const component = createCommandsPane({
      view: commands,
      theme: plain,
      requestRender: () => undefined,
      close: () => {
        closed = true
      },
      stop: (snapshot) => {
        stopped.push(snapshot.id)
      },
      height: () => 20,
      now: () => 90_000,
    })
    return {
      component,
      press: (...keys: string[]) => {
        for (const key of keys) component.handleInput(key)
      },
      text: (width = 80) => component.render(width).join('\n'),
      closed: () => closed,
      stopped,
    }
  }

  it('lists commands newest first and opens a sanitized log', () => {
    const commands = view(
      [running('server', 'Server', 0), failed('build', 'Build', 30_000, 60_000)],
      [
        ['server', { text: '\u001b[32mready\u001b[0m\nrequest 1\n', truncated: true }],
        ['build', { text: 'compiling\n', truncated: false }],
      ],
    )
    const ui = pane(commands)
    try {
      const list = ui.component.render(80)
      expect(list.findIndex((line) => line.includes('Build'))).toBeLessThan(
        list.findIndex((line) => line.includes('Server')),
      )
      expect(ui.text()).toContain('❯ ✗ Build')
      expect(ui.text()).toContain('exit 2 30s')
      ui.press('j', '\r')
      const log = ui.text()
      expect(log).toContain('Background commands › Log')
      expect(log).toContain('● running · 1m30s')
      expect(log).toContain('$ run server')
      expect(log).toContain('│ ready')
      expect(log).not.toContain('\u001b[32m')
      expect(log).toContain('Live · follows new output · x stop · retained tail only')
      for (const line of ui.component.render(40)) expect(visibleWidth(line)).toBeLessThanOrEqual(40)
      ui.press('\u001b')
      expect(ui.text()).toContain('Enter logs')
      ui.press('\u001b')
      expect(ui.closed()).toBe(true)
    } finally {
      ui.component.dispose()
    }
  })

  it('reports missing and empty logs', () => {
    const ui = pane(
      view(
        [running('quiet', 'Quiet', 0), failed('gone', 'Gone', 1, 2)],
        [['quiet', { text: '', truncated: false }]],
      ),
    )
    try {
      ui.press('\r')
      expect(ui.text()).toContain('(logs are no longer retained)')
      expect(ui.text()).toContain('The command exited with code 2.')
      ui.press('\u001b', 'j', '\r')
      expect(ui.text()).toContain('(no output yet)')
    } finally {
      ui.component.dispose()
    }
  })

  it('confirms a stop for the selected running command after reordering', () => {
    const commands = view([running('first', 'First', 0), running('second', 'Second', 1)])
    const ui = pane(commands)
    try {
      ui.press('j', 'x')
      expect(ui.text()).toContain('stop First?  y / n')
      commands.snapshots = [running('third', 'Third', 2), ...commands.snapshots]
      ui.press('y')
      expect(ui.stopped).toEqual(['first'])
      ui.press('x', 'n')
      expect(ui.stopped).toEqual(['first'])
      commands.snapshots = [failed('done', 'Done', 3, 4)]
      ui.press('x', 'y')
      expect(ui.stopped).toEqual(['first'])
    } finally {
      ui.component.dispose()
    }
  })

  it('filters active commands and searches names, commands, and IDs', () => {
    const ui = pane(view([running('server', 'Server', 0), failed('build', 'Build', 1, 2)]))
    try {
      ui.press('\t')
      expect(ui.text()).toContain('Active')
      expect(ui.text()).not.toContain('Build')
      ui.press('\t', '/', 'r', 'u', 'n', ' ', 'b', '\r')
      expect(ui.text()).toContain('Build')
      expect(ui.text()).not.toContain('Server')
      expect(ui.text()).toContain('Search: run b')
    } finally {
      ui.component.dispose()
    }
  })

  it('scrolls the log and returns to live output', () => {
    const text = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')
    const commands = view(
      [running('server', 'Server', 0)],
      [['server', { text, truncated: false }]],
    )
    const ui = pane(commands)
    try {
      ui.press('\r')
      expect(ui.text()).toContain('line 40')
      ui.press('k', 'k')
      expect(ui.text()).toContain('↑ 2 rows below')
      expect(ui.text()).not.toContain('line 40')
      commands.outputs.set('server', { text: `${text}\nline 41`, truncated: false })
      expect(ui.text()).toContain('↑ 3 rows below')
      ui.press('G')
      expect(ui.text()).toContain('line 41')
      expect(ui.text()).toContain('Live · follows new output')
    } finally {
      ui.component.dispose()
    }
  })
})
