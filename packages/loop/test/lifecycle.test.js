import { fileURLToPath } from 'node:url'

import { describe, expect, test, vi } from 'vite-plus/test'

import loop from '../src/index.ts'
import { createLoop } from '../src/machine.ts'

function harness(branch = [], initialIdle = true, mode = 'tui') {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const messages = []
  const entries = []
  const notices = []
  const statuses = new Map()
  let idle = initialIdle
  let confirmations = 0
  const api = {
    on(name, handler) {
      handlers.set(name, handler)
    },
    appendEntry(customType, data) {
      entries.push({ type: 'custom', customType, data })
    },
    sendUserMessage(prompt, options) {
      messages.push({ prompt, options })
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
    mode,
    isIdle() {
      return idle
    },
    sessionManager: {
      getBranch() {
        return branch
      },
    },
    ui: {
      confirm: async () => {
        confirmations += 1
        return true
      },
      notify(text, level) {
        notices.push({ text, level })
      },
      setStatus(key, value) {
        statuses.set(key, value)
      },
    },
  }
  loop(api)
  return {
    async emit(name, event = {}) {
      const handler = handlers.get(name)
      if (handler === undefined) {
        throw new Error(`Missing ${name} handler`)
      }
      return handler(event, ctx)
    },
    async command(name, args) {
      const command = commands.get(name)
      if (command === undefined) {
        throw new Error(`Missing ${name} command`)
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
    entries,
    messages,
    notices,
    statuses,
    confirmationCount: () => confirmations,
    setIdle(value) {
      idle = value
    },
  }
}

function latestState(instance) {
  const entry = instance.entries.at(-1)
  if (entry === undefined) {
    throw new Error('No loop state was persisted')
  }
  return entry.data
}

async function waitFor(check) {
  const deadline = Date.now() + 2_000
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out while waiting for the watcher')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('loop lifecycle', () => {
  test('rejects a loop in one-shot print mode', async () => {
    const instance = harness([], true, 'print')
    await instance.emit('session_start')
    await instance.command('loop', '1s check CI')
    expect(instance.messages).toHaveLength(0)
    expect(instance.notices.at(-1)).toEqual({
      text: 'A loop requires a persistent TUI or RPC session.',
      level: 'error',
    })
    await instance.emit('session_shutdown')
  })

  test('rejects a loop in JSON mode', async () => {
    const instance = harness([], true, 'json')
    await instance.emit('session_start')
    await instance.command('loop', '1s check CI')
    expect(instance.messages).toHaveLength(0)
    await instance.emit('session_shutdown')
  })

  test('runs a fixed skill prompt immediately and expands it', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', '5m /skill:check-ci now')
    expect(instance.messages).toEqual([
      {
        prompt: '/skill:check-ci now',
        options: { deliverAs: 'followUp', expandPromptTemplates: true },
      },
    ])
    expect(latestState(instance)).toMatchObject({
      mode: 'fixed',
      intervalMs: 300_000,
      iterations: 1,
      status: 'active',
    })
    expect(latestState(instance).nextRunAt).toBeGreaterThan(Date.now())
    await instance.emit('session_shutdown')
  })

  test('injects loop instructions only into a loop iteration', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', 'check deploy')
    const loopTurn = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(loopTurn.systemPrompt).toContain('Execute the loop prompt in this turn.')
    await instance.emit('agent_settled')
    const unrelatedTurn = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(unrelatedTurn).toBeUndefined()
    await instance.emit('session_shutdown')
  })

  test('lets a dynamic loop change its delay and prompt', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', 'check deploy')
    expect(latestState(instance)).toMatchObject({
      mode: 'dynamic',
      iterations: 1,
      nextRunAt: null,
    })
    const result = await instance.tool('loop_next', {
      delaySeconds: 60,
      prompt: 'check deploy again',
    })
    expect(result.details.scheduled).toBe(true)
    expect(latestState(instance)).toMatchObject({
      prompt: 'check deploy again',
      watch: null,
    })
    expect(latestState(instance).nextRunAt).toBeGreaterThan(Date.now())
    await instance.emit('session_shutdown')
  })

  test('wakes a dynamic loop when its watcher matches', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', 'check status')
    const fixture = fileURLToPath(new URL('./fixtures/wake.js', import.meta.url))
    await instance.tool('loop_next', {
      delaySeconds: 60,
      watch: {
        command: `"${process.execPath}" "${fixture}"`,
        pattern: '^ready$',
      },
    })
    await waitFor(() => latestState(instance).pendingWake)
    await instance.emit('agent_settled')
    expect(instance.messages).toHaveLength(2)
    expect(instance.messages[1]?.prompt).toBe('check status')
    expect(latestState(instance)).toMatchObject({
      iterations: 2,
      nextRunAt: null,
      watch: null,
    })
    await instance.emit('session_shutdown')
  })

  test('keeps fixed cadence and coalesces missed ticks', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const instance = harness()
    try {
      await instance.emit('session_start')
      await instance.command('loop', '1s check CI')
      await instance.emit('agent_settled')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(instance.messages).toHaveLength(2)
      expect(latestState(instance).nextRunAt).toBe(102_000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(instance.messages).toHaveLength(2)
      expect(latestState(instance)).toMatchObject({
        nextRunAt: 104_000,
        pendingWake: true,
      })
      await instance.emit('agent_settled')
      expect(instance.messages).toHaveLength(3)
      expect(latestState(instance).pendingWake).toBe(false)
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('makes an older dynamic timer inert after rearm', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const instance = harness()
    try {
      await instance.emit('session_start')
      await instance.command('loop', 'check status')
      await instance.tool('loop_next', { delaySeconds: 10 })
      await instance.tool('loop_next', { delaySeconds: 20 })
      await instance.emit('agent_settled')
      await vi.advanceTimersByTimeAsync(10_000)
      expect(instance.messages).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(instance.messages).toHaveLength(2)
      await instance.emit('session_shutdown')
    } finally {
      vi.useRealTimers()
    }
  })

  test('keeps an exact duplicate idempotent', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', '5m check CI')
    const firstState = latestState(instance)
    await instance.command('loop', '5m check CI')
    expect(instance.messages).toHaveLength(1)
    expect(instance.confirmationCount()).toBe(0)
    expect(latestState(instance).id).toBe(firstState.id)
    await instance.emit('session_shutdown')
  })

  test('does not resurrect an older loop after an invalid newer state', async () => {
    const active = createLoop(
      {
        prompt: 'old prompt',
        schedule: { mode: 'dynamic', intervalMs: null, watch: null },
      },
      100,
      'old-loop',
    )
    const branch = [
      { type: 'custom', customType: 'pi-loop-state', data: active },
      { type: 'custom', customType: 'pi-loop-state', data: { ...active, prompt: '' } },
    ]
    const instance = harness(branch)
    await instance.emit('session_start')
    await instance.command('loop', 'new prompt')
    expect(instance.confirmationCount()).toBe(0)
    expect(instance.messages).toHaveLength(1)
    expect(latestState(instance).prompt).toBe('new prompt')
    await instance.emit('session_shutdown')
  })

  test('stops timers and rejects later scheduling', async () => {
    const instance = harness()
    await instance.emit('session_start')
    await instance.command('loop', 'check status')
    const stopped = await instance.tool('loop_stop', { reason: 'work complete' })
    expect(stopped.details.stopped).toBe(true)
    expect(latestState(instance)).toMatchObject({
      status: 'stopped',
      nextRunAt: null,
      stopReason: 'work complete',
    })
    const scheduled = await instance.tool('loop_next', { delaySeconds: 60 })
    expect(scheduled.details.scheduled).toBe(false)
    await instance.emit('session_shutdown')
  })
})
