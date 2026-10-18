import { describe, expect, it } from 'vite-plus/test'

import { commandsState, railCallReport, railResultReport } from '../src/hud.ts'
import type { CommandSnapshot } from '../src/schema.ts'

const identity = {
  id: '0123456789abcdef',
  sessionId: 'session',
  name: 'Development server',
  command: 'bun run dev',
  startedAt: 0,
}
const running: CommandSnapshot = { ...identity, status: 'running' }
const stopping: CommandSnapshot = { ...identity, status: 'stopping' }
const failed: CommandSnapshot = {
  ...identity,
  status: 'error',
  finishedAt: 1,
  exitCode: 2,
  errorMessage: 'The command exited with code 2.',
}

describe('HUD state', () => {
  it('counts running and stopping commands without terminal records', () => {
    expect(commandsState([running, running, stopping, failed])).toEqual({
      version: 1,
      running: 2,
      stopping: 1,
    })
    expect(commandsState([])).toEqual({ version: 1, running: 0, stopping: 0 })
  })
})

describe('HUD rail reports', () => {
  it('labels each action with a shell row and a sanitized detail', () => {
    expect(
      railCallReport('call', { action: 'start', command: 'printf "\x1b[31mred\x1b[0m"\nexit 0' }),
    ).toEqual({
      toolCallId: 'call',
      toolName: 'background_command',
      status: 'pending',
      category: 'other',
      iconKey: 'shell',
      runningLabel: 'Launching',
      doneLabel: 'Launched',
      detail: 'printf "red" exit 0',
    })
    expect(railCallReport('call', { action: 'start', command: 'x', name: 'Tests' }).detail).toBe(
      'Tests',
    )
    expect(railCallReport('call', { action: 'output', id: identity.id }).detail).toBe(
      '01234567 log',
    )
    expect(railCallReport('call', { action: 'stop', id: identity.id })).toMatchObject({
      runningLabel: 'Stopping',
      doneLabel: 'Signaled',
      detail: '01234567',
    })
    expect(railCallReport('call', { action: 'start', command: 'x'.repeat(100) }).detail).toBe(
      `${'x'.repeat(57)}...`,
    )
  })

  it('states that a launch runs in the background instead of claiming success', () => {
    const args = { action: 'start', command: 'bun run dev' }
    expect(
      railResultReport('call', args, { action: 'start', snapshot: running }, undefined),
    ).toMatchObject({ status: 'ok', detail: 'Development server', summary: 'in background' })
  })

  it('summarizes list, output, and stop results', () => {
    expect(
      railResultReport(
        'call',
        { action: 'list' },
        { action: 'list', commands: [running, stopping, failed] },
        undefined,
      ),
    ).toMatchObject({ status: 'ok', summary: '2 active · 1 finished' })
    expect(
      railResultReport('call', { action: 'list' }, { action: 'list', commands: [] }, undefined),
    ).toMatchObject({ summary: 'none' })
    expect(
      railResultReport(
        'call',
        { action: 'output', id: identity.id },
        { action: 'output', snapshot: failed, output: { text: 'log', truncated: false } },
        undefined,
      ),
    ).toMatchObject({ detail: 'Development server log', summary: 'error, exit 2' })
    expect(
      railResultReport(
        'call',
        { action: 'stop', id: identity.id },
        { action: 'stop', snapshot: stopping },
        undefined,
      ),
    ).toMatchObject({ detail: 'Development server', summary: 'stopping' })
  })

  it('reports tool errors with their message', () => {
    const report = railResultReport(
      'call',
      { action: 'output', id: 'missing' },
      undefined,
      'Background command unavailable in this session.',
    )
    expect(report).toMatchObject({
      status: 'error',
      output: 'Background command unavailable in this session.',
    })
    expect(report).not.toHaveProperty('summary')
  })
})
