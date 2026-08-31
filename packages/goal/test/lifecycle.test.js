import { Value } from 'typebox/value'
import { describe, expect, test, vi } from 'vite-plus/test'

import goal from '../src/index.ts'

function harness(branch = []) {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const messages = []
  const entries = []
  const notices = []
  const statuses = new Map()
  let idle = true
  let pending = false
  let aborts = 0
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    appendEntry(customType, data) {
      entries.push({ type: 'custom', customType, data })
    },
    sendMessage(message, options) {
      messages.push({ message, options })
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
  }
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    mode: 'rpc',
    isIdle() {
      return idle
    },
    hasPendingMessages() {
      return pending
    },
    abort() {
      aborts += 1
    },
    async waitForIdle() {
      if (!idle) {
        idle = true
        const handler = handlers.get('agent_settled')
        if (handler === undefined) {
          throw new Error('Missing agent_settled handler')
        }
        await handler({}, ctx)
      }
    },
    sessionManager: {
      getBranch() {
        return branch
      },
    },
    ui: {
      notify(text, level) {
        notices.push({ text, level })
      },
      setStatus(key, value) {
        statuses.set(key, value)
      },
    },
  }
  goal(api)
  return {
    async emit(name, event = {}) {
      const handler = handlers.get(name)
      if (handler === undefined) {
        throw new Error(`Missing ${name} handler`)
      }
      return handler(event, ctx)
    },
    async command(args) {
      const command = commands.get('goal')
      if (command === undefined) {
        throw new Error('Missing goal command')
      }
      return command.handler(args, ctx)
    },
    async tool(name, params) {
      const tool = tools.get(name)
      if (tool === undefined) {
        throw new Error(`Missing ${name} tool`)
      }
      return tool.execute('call-1', params, undefined, undefined, ctx)
    },
    schema(name) {
      const tool = tools.get(name)
      if (tool === undefined) {
        throw new Error(`Missing ${name} tool`)
      }
      return tool.parameters
    },
    entries,
    messages,
    notices,
    statuses,
    abortCount: () => aborts,
    setIdle(value) {
      idle = value
    },
    setPending(value) {
      pending = value
    },
  }
}

function latestState(instance) {
  const entry = instance.entries.at(-1)
  if (entry === undefined) {
    throw new Error('No goal state was persisted')
  }
  return entry.data
}

describe('goal lifecycle', () => {
  test('creates a goal and starts concrete work', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('ship the release')
    expect(instance.notices.at(-1)).toEqual({ text: 'Goal created.', level: undefined })
    expect(latestState(instance)).toMatchObject({
      objective: 'ship the release',
      status: 'active',
      continuationCount: 0,
    })
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0]?.options).toEqual({ triggerTurn: true, deliverAs: 'followUp' })
    expect(instance.messages[0]?.message.display).toBe(false)
    await instance.emit('session_shutdown')
  })

  test('matches empty, timed, recurring, and replacement command behavior', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('')
    expect(instance.notices.at(-1)?.text).toBe('Usage: /goal <objective>')

    await instance.command('30m first objective')
    expect(latestState(instance).objective).toBe('first objective')
    expect(instance.notices.at(-1)?.text).toContain('Time-limited goals are not supported yet.')

    const firstId = latestState(instance).id
    await instance.command('second objective')
    expect(latestState(instance).objective).toBe('second objective')
    expect(latestState(instance).id).not.toBe(firstId)

    await instance.command('check every 5m')
    expect(instance.notices.at(-1)?.text).toBe('Recurring work belongs to /loop, not /goal.')
    expect(latestState(instance).objective).toBe('second objective')
    await instance.emit('session_shutdown')
  })

  test('injects active goal instructions', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('finish migration')
    const injected = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(injected.systemPrompt).toContain('Objective: "finish migration"')
    expect(injected.systemPrompt).toContain('Call update_goal with status complete')
    await instance.emit('session_shutdown')
  })

  test('stops automatic continuation after three idle continuation turns', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const instance = harness()
    try {
      await instance.emit('session_start')
      await instance.command('wait for evidence')
      await instance.emit('agent_start')
      await instance.emit('agent_settled')
      await vi.advanceTimersByTimeAsync(0)
      expect(instance.messages).toHaveLength(2)

      for (let count = 1; count <= 3; count += 1) {
        await instance.emit('agent_start')
        await instance.emit('agent_settled')
        await vi.advanceTimersByTimeAsync(0)
        expect(latestState(instance).idleContinuationsWithoutToolCalls).toBe(count)
      }
      expect(instance.messages).toHaveLength(4)
      expect(latestState(instance).continuationCount).toBe(3)
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps logical turn accounting across retry agent runs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const instance = harness()
    try {
      await instance.emit('session_start')
      await instance.command('collect evidence')
      await instance.emit('agent_start')
      await instance.emit('agent_settled')
      await vi.advanceTimersByTimeAsync(0)

      await instance.emit('agent_start')
      await instance.emit('tool_execution_end')
      await instance.emit('agent_start')
      await instance.emit('agent_settled')
      expect(latestState(instance).idleContinuationsWithoutToolCalls).toBe(0)
      await vi.advanceTimersByTimeAsync(0)

      await instance.emit('agent_start')
      await instance.emit('agent_start')
      await instance.emit('agent_settled')
      expect(latestState(instance).idleContinuationsWithoutToolCalls).toBe(1)
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('aborts an active run before goal replacement', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('old objective')
    await instance.emit('agent_start')
    instance.setIdle(false)

    await instance.command('new objective')

    expect(instance.abortCount()).toBe(1)
    expect(latestState(instance)).toMatchObject({ objective: 'new objective', status: 'active' })
    expect(instance.messages).toHaveLength(2)
    expect(instance.messages[1]?.message.content).toMatch(/^<timestamp>/)
    await instance.emit('session_shutdown')
  })

  test('moves tool-based replacement into a fresh goal run', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('old objective')
    await instance.emit('agent_start')

    const result = await instance.tool('create_goal', { objective: 'new objective' })

    expect(result.details).toEqual({ created: true, objective: 'new objective' })
    expect(instance.abortCount()).toBe(1)
    expect(instance.messages).toHaveLength(2)
    expect(instance.messages[1]?.message.content).toContain('Objective: "new objective"')
    await instance.emit('agent_settled')
    expect(latestState(instance)).toMatchObject({ objective: 'new objective', status: 'active' })
    const injected = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(injected.systemPrompt).toContain('Objective: "new objective"')
    await instance.emit('agent_start')
    await instance.emit('session_shutdown')
  })

  test('uses closed tool input schemas', async () => {
    const instance = harness()
    await instance.emit('session_start')
    expect(Value.Check(instance.schema('get_goal'), { extra: true })).toBe(false)
    expect(Value.Check(instance.schema('create_goal'), { objective: 'x', extra: true })).toBe(false)
    expect(Value.Check(instance.schema('update_goal'), { status: 'active', extra: true })).toBe(
      false,
    )
    await instance.emit('session_shutdown')
  })

  test('pauses, resumes, completes, reactivates, and clears a goal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const instance = harness()
    try {
      await instance.emit('session_start')
      await instance.command('release package')
      vi.setSystemTime(6_000)
      await instance.command('pause')
      expect(latestState(instance)).toMatchObject({ status: 'paused', activeDurationMs: 5_000 })

      vi.setSystemTime(20_000)
      await instance.command('resume')
      expect(latestState(instance).status).toBe('active')

      vi.setSystemTime(23_000)
      const completed = await instance.tool('update_goal', { status: 'complete' })
      expect(completed.content[0].text).toContain('8s')
      expect(latestState(instance).status).toBe('complete')

      await instance.tool('update_goal', { status: 'active' })
      expect(latestState(instance).status).toBe('active')
      await instance.command('clear')
      expect(latestState(instance).status).toBe('cleared')
      expect(instance.statuses.get('pi-goal')).toBeUndefined()
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps the last valid state when the newest entry is invalid', async () => {
    const stored = {
      version: 1,
      id: 'goal-1',
      objective: 'restore me',
      status: 'paused',
      startedAt: 1,
      activeDurationMs: 10,
      lastAccruedAt: null,
      idleContinuationsWithoutToolCalls: 0,
      continuationCount: 2,
    }
    const instance = harness([
      { type: 'custom', customType: 'pi-goal-state', data: stored },
      { type: 'custom', customType: 'pi-goal-state', data: { version: 2 } },
    ])
    await instance.emit('session_start')
    const result = await instance.tool('get_goal', {})
    expect(result.details).toMatchObject({ objective: 'restore me', status: 'paused' })
    expect(instance.notices.at(-1)).toEqual({
      text: 'Ignored an invalid persisted goal state.',
      level: 'warning',
    })
    await instance.emit('session_shutdown')
  })

  test('restores an active goal and queues a runtime continuation', async () => {
    vi.useFakeTimers()
    const stored = {
      version: 1,
      id: 'goal-1',
      objective: 'restore active work',
      status: 'active',
      startedAt: 1,
      activeDurationMs: 10,
      lastAccruedAt: 1,
      idleContinuationsWithoutToolCalls: 0,
      continuationCount: 2,
    }
    const instance = harness([{ type: 'custom', customType: 'pi-goal-state', data: stored }])
    try {
      await instance.emit('session_start')
      await vi.advanceTimersByTimeAsync(0)
      expect(instance.messages).toHaveLength(1)
      expect(latestState(instance).continuationCount).toBe(3)
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('restores the newest session goal', async () => {
    const stored = {
      version: 1,
      id: 'goal-1',
      objective: 'restore me',
      status: 'paused',
      startedAt: 1,
      activeDurationMs: 10,
      lastAccruedAt: null,
      idleContinuationsWithoutToolCalls: 0,
      continuationCount: 2,
    }
    const instance = harness([{ type: 'custom', customType: 'pi-goal-state', data: stored }])
    await instance.emit('session_start')
    const result = await instance.tool('get_goal', {})
    expect(result.details).toMatchObject({
      exists: true,
      objective: 'restore me',
      status: 'paused',
      continuationCount: 2,
    })
    await instance.emit('session_shutdown')
  })
})
