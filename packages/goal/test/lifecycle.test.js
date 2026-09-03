import { Value } from 'typebox/value'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import goal from '../src/index.ts'

function harness(branch = []) {
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const messages = []
  const userMessages = []
  const entries = []
  const notices = []
  const statuses = new Map()
  let activeTools = ['read', 'bash', 'goal']
  let idle = true
  let pending = false
  let editorText = ''
  let selectAnswer
  let confirmAnswer = true
  let editorAnswer
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
    sendUserMessage(content, options) {
      userMessages.push({ content, options })
    },
    registerTool(tool) {
      tools.set(tool.name, tool)
    },
    registerCommand(name, command) {
      commands.set(name, command)
    },
    getActiveTools() {
      return [...activeTools]
    },
    setActiveTools(names) {
      activeTools = [...names]
    },
  }
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    mode: 'tui',
    isIdle() {
      return idle
    },
    hasPendingMessages() {
      return pending
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
      getEditorText() {
        return editorText
      },
      async select() {
        return selectAnswer
      },
      async confirm() {
        return confirmAnswer
      },
      async input() {
        return editorAnswer
      },
      async editor() {
        return editorAnswer
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
    async command(name, args) {
      const command = commands.get(name)
      if (command === undefined) {
        throw new Error(`Missing ${name} command`)
      }
      return command.handler(args, ctx)
    },
    async tool(params) {
      const tool = tools.get('goal')
      if (tool === undefined) {
        throw new Error('Missing goal tool')
      }
      return tool.execute('call-1', params, undefined, undefined, ctx)
    },
    schema() {
      return tools.get('goal').parameters
    },
    renderCall(args) {
      return tools.get('goal').renderCall(args, theme, {}).text
    },
    renderResult(result) {
      return tools
        .get('goal')
        .renderResult(result, { expanded: false, isPartial: false }, theme, {}).text
    },
    entries,
    messages,
    userMessages,
    notices,
    statuses,
    activeTools: () => [...activeTools],
    setIdle(value) {
      idle = value
    },
    setActiveTools(names) {
      activeTools = [...names]
    },
    setPending(value) {
      pending = value
    },
    setEditorText(value) {
      editorText = value
    },
    setSelectAnswer(value) {
      selectAnswer = value
    },
    setConfirmAnswer(value) {
      confirmAnswer = value
    },
    setEditorAnswer(value) {
      editorAnswer = value
    },
  }
}

const theme = {
  bold(text) {
    return text
  },
  italic(text) {
    return text
  },
  fg(color, text) {
    return color === 'accent' || color === 'success' || color === 'warning' || color === 'muted'
      ? `<${color}>${text}</${color}>`
      : text
  },
}

function todoEntry(todos) {
  return {
    type: 'message',
    message: { role: 'toolResult', toolName: 'todo_write', details: { todos } },
  }
}

function modeEntries(instance) {
  return instance.entries.filter((entry) => entry.customType === 'pi-goal-mode')
}

function latestMode(instance) {
  const entry = modeEntries(instance).at(-1)
  if (entry === undefined) {
    throw new Error('No goal mode entry was persisted')
  }
  return entry.data
}

function assistant(usage, stopReason = 'stop') {
  return {
    role: 'assistant',
    content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...usage },
    stopReason,
  }
}

async function runTurn(instance, options = {}) {
  await instance.emit('agent_start')
  await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
  if (options.tool) {
    await instance.emit('tool_execution_start', {
      toolCallId: 't',
      toolName: options.tool,
      args: {},
    })
  }
  const message = assistant(options.usage ?? {}, options.stopReason)
  await instance.emit('message_end', { message })
  if (options.tool) {
    await instance.emit('tool_execution_end', {
      toolCallId: 't',
      toolName: options.tool,
      result: {},
      isError: false,
    })
  }
  await instance.emit('agent_end', { messages: [message] })
  await instance.emit('agent_settled')
}

function storedGoal(overrides = {}) {
  return {
    id: 'goal-1',
    objective: 'restore me',
    status: 'active',
    tokensUsed: 10,
    timeUsedSeconds: 3,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('goal lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('hides the goal tool when no goal exists', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    expect(instance.activeTools()).not.toContain('goal')
    expect(instance.statuses.get('pi-goal')).toBeUndefined()
  })

  test('creates a goal from /goal and submits the objective as the user prompt', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'ship the release')
    expect(latestMode(instance)).toMatchObject({
      version: 2,
      mode: 'goal',
      goal: { objective: 'ship the release', status: 'active', tokensUsed: 0 },
    })
    expect(instance.activeTools()).toContain('goal')
    expect(instance.userMessages).toEqual([{ content: 'ship the release', options: undefined }])
    expect(instance.statuses.get('pi-goal')).toBe('Goal active 0')
    const injected = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(injected.message.customType).toBe('goal-mode-context')
    expect(injected.message.content).toContain('<objective>\nship the release\n</objective>')
    expect(injected.message.display).toBe(false)
  })

  test('steers goal context and the objective while streaming', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    instance.setIdle(false)
    await instance.command('goal', 'ship <it>')
    expect(instance.messages.at(-1)).toMatchObject({
      message: { customType: 'goal-mode-context' },
      options: { deliverAs: 'steer' },
    })
    expect(instance.messages.at(-1).message.content).toContain('ship &lt;it&gt;')
    expect(instance.userMessages).toEqual([
      { content: 'ship <it>', options: { deliverAs: 'steer' } },
    ])
  })

  test('sends a hidden continuation after the agent settles', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'finish migration')
    await runTurn(instance, { tool: 'read' })
    expect(instance.messages).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0]).toMatchObject({
      message: { customType: 'goal-continuation', display: false },
      options: { triggerTurn: true, deliverAs: 'followUp' },
    })
    expect(instance.messages[0].message.content).toContain('Continue active goal.')
    expect(instance.messages[0].message.content).toContain('NEVER narrate continuation')
  })

  test('suppresses one continuation after a continuation turn without tool calls', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'wait for evidence')
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(1)

    await runTurn(instance)
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(1)

    await instance.emit('message_start', { message: { role: 'user', content: 'go on' } })
    await runTurn(instance)
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(2)
  })

  test('keeps continuing while continuation turns use tools', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'keep working')
    for (let count = 1; count <= 3; count += 1) {
      await runTurn(instance, { tool: 'bash' })
      await vi.advanceTimersByTimeAsync(800)
      expect(instance.messages).toHaveLength(count)
    }
  })

  test('does not continue while the agent is busy or the editor has text', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'stay quiet')
    instance.setEditorText('draft')
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
    instance.setEditorText('')
    instance.setPending(true)
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
  })

  test('pauses the goal when the user aborts a run', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'long task')
    await runTurn(instance, { tool: 'read', stopReason: 'aborted' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
    expect(latestMode(instance)).toMatchObject({ mode: 'goal_paused', goal: { status: 'paused' } })
    expect(instance.notices.at(-1)).toEqual({
      text: 'Goal paused. Use /goal resume to continue.',
      level: 'info',
    })
    expect(instance.statuses.get('pi-goal')).toBe('Goal paused 0')
    expect(instance.activeTools()).toContain('goal')
  })

  test('accounts tokens and time and flips to budget-limited with a steer', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'bounded work')
    await instance.command('goal', 'budget 10')
    expect(instance.notices.at(-1).text).toBe('Goal budget set to 10.')
    expect(latestMode(instance).goal.tokenBudget).toBe(10)

    await instance.emit('agent_start')
    await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
    vi.setSystemTime(13_000)
    await instance.emit('message_end', {
      message: assistant({ input: 4, output: 2, cacheRead: 50 }),
    })
    await instance.emit('tool_execution_end', {
      toolCallId: 't',
      toolName: 'read',
      result: {},
      isError: false,
    })
    expect(latestMode(instance).goal).toMatchObject({
      tokensUsed: 6,
      timeUsedSeconds: 3,
      status: 'active',
    })
    expect(instance.statuses.get('pi-goal')).toBe('Goal active 6/10')

    await instance.emit('message_end', { message: assistant({ input: 3, output: 3 }) })
    await instance.emit('tool_execution_end', {
      toolCallId: 't2',
      toolName: 'read',
      result: {},
      isError: false,
    })
    expect(latestMode(instance).goal).toMatchObject({ tokensUsed: 12, status: 'budget-limited' })
    expect(instance.messages.at(-1)).toMatchObject({
      message: { customType: 'goal-budget-limit', display: false },
      options: { triggerTurn: false, deliverAs: 'steer' },
    })

    await instance.emit('agent_end', { messages: [assistant({})] })
    await instance.emit('agent_settled')
    await vi.advanceTimersByTimeAsync(800)
    expect(
      instance.messages.filter((entry) => entry.message.customType === 'goal-continuation'),
    ).toHaveLength(0)
  })

  test('replaces the active goal with /goal set and refuses bare objectives', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'first')
    const firstId = latestMode(instance).goal.id
    await instance.command('goal', 'second')
    expect(instance.notices.at(-1).text).toContain('Goal mode is already active.')
    expect(latestMode(instance).goal.objective).toBe('first')
    await instance.command('goal', 'set second')
    expect(latestMode(instance).goal.objective).toBe('second')
    expect(latestMode(instance).goal.id).not.toBe(firstId)
    expect(instance.userMessages.at(-1).content).toBe('second')
  })

  test('pauses, resumes, and refuses objectives while paused', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'release package')
    await instance.command('goal', 'pause')
    expect(latestMode(instance).mode).toBe('goal_paused')
    expect(instance.notices.at(-1).text).toBe('Goal mode paused.')
    expect(instance.activeTools()).toContain('goal')

    await instance.command('goal', 'another objective')
    expect(instance.notices.at(-1)).toEqual({
      text: 'Resume the current goal first, or drop it before setting a new objective.',
      level: 'warning',
    })
    await instance.command('goal', 'budget 5')
    expect(instance.notices.at(-1).text).toBe('Resume the goal before adjusting the budget.')

    await instance.command('goal', 'resume')
    expect(latestMode(instance)).toMatchObject({ mode: 'goal', goal: { status: 'active' } })
    expect(instance.notices.at(-1).text).toBe('Goal mode resumed.')
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages.at(-1).message.customType).toBe('goal-continuation')
  })

  test('opens the menu for a bare /goal and applies the choice', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'menu target')
    instance.setSelectAnswer('Pause')
    await instance.command('goal', '')
    expect(latestMode(instance).mode).toBe('goal_paused')
    instance.setSelectAnswer('Resume')
    await instance.command('goal', '')
    expect(latestMode(instance).mode).toBe('goal')
    instance.setSelectAnswer('Show details')
    await instance.command('goal', 'show')
    expect(instance.notices.at(-1).text).toContain('Objective: menu target')
    expect(instance.notices.at(-1).text).toContain('Tokens: 0 (no budget)')
  })

  test('drops a goal after confirmation', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'discard later')
    instance.setConfirmAnswer(false)
    await instance.command('goal', 'drop')
    expect(latestMode(instance).mode).toBe('goal')
    instance.setConfirmAnswer(true)
    await instance.command('goal', 'drop')
    expect(latestMode(instance).mode).toBe('none')
    expect(instance.notices.at(-1).text).toBe('Goal dropped.')
    expect(instance.activeTools()).not.toContain('goal')
    expect(instance.statuses.get('pi-goal')).toBeUndefined()
  })

  test('rejects invalid budgets', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'budget 5')
    expect(instance.notices.at(-1).text).toBe('No active goal.')
    await instance.command('goal', 'objective')
    await instance.command('goal', 'budget nope')
    expect(instance.notices.at(-1).text).toBe('Goal budget must be a positive integer or `off`.')
    await instance.command('goal', 'budget off')
    expect(instance.notices.at(-1).text).toBe('Goal budget cleared.')
  })

  test('uses a closed tool schema', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    expect(Value.Check(instance.schema(), { op: 'get' })).toBe(true)
    expect(Value.Check(instance.schema(), { op: 'get', extra: true })).toBe(false)
    expect(Value.Check(instance.schema(), { op: 'set' })).toBe(false)
  })

  test('drives the goal from the tool and exits after completion', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    const missing = await instance.tool({ op: 'get' })
    expect(missing.content[0].text).toBe('No active goal.')
    await expect(instance.tool({ op: 'complete' })).rejects.toThrow(
      'cannot complete goal because no goal is active',
    )
    await expect(instance.tool({ op: 'create', objective: '  ' })).rejects.toThrow(
      'objective is required when op=create',
    )

    const created = await instance.tool({ op: 'create', objective: 'tool goal', token_budget: 50 })
    expect(created.details).toMatchObject({
      op: 'create',
      goal: { objective: 'tool goal' },
      remainingTokens: 50,
    })
    expect(created.content[0].text).toContain('Remaining tokens: 50')
    await expect(instance.tool({ op: 'create', objective: 'again' })).rejects.toThrow(
      'cannot create a new goal because this session already has a goal',
    )

    await instance.emit('agent_start')
    await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
    vi.setSystemTime(15_000)
    const completed = await instance.tool({ op: 'complete' })
    expect(completed.details.goal.status).toBe('complete')
    expect(completed.content[0].text).toContain(
      'Goal achieved. Report final budget usage to the user',
    )
    expect(completed.content[0].text).toContain('time used: 5 seconds')
    await expect(instance.tool({ op: 'complete' })).rejects.toThrow('goal is already complete')

    await instance.emit('agent_end', { messages: [assistant({})] })
    await instance.emit('agent_settled')
    expect(latestMode(instance)).toEqual({ version: 2, mode: 'none' })
    expect(instance.entries.at(-1)).toMatchObject({
      customType: 'pi-goal-completed',
      data: { objective: 'tool goal', tokenBudget: 50 },
    })
    expect(instance.notices.at(-1).text).toBe('Goal mode completed.')
    expect(instance.activeTools()).not.toContain('goal')
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)

    const next = await instance.tool({ op: 'create', objective: 'phase two' })
    expect(next.details.goal.objective).toBe('phase two')
  })

  test('resumes and drops from the tool', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'tool controlled')
    await instance.command('goal', 'pause')
    const paused = await instance.tool({ op: 'get' })
    expect(paused.content[0].text).toContain('Status: paused')
    const resumed = await instance.tool({ op: 'resume' })
    expect(resumed.details.goal.status).toBe('active')
    expect(latestMode(instance).mode).toBe('goal')
    const dropped = await instance.tool({ op: 'drop' })
    expect(dropped.details.goal.status).toBe('dropped')
    expect(latestMode(instance).mode).toBe('none')
    expect(instance.activeTools()).not.toContain('goal')
  })

  test('starts a guided interview with the goal tool exposed', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('guided-goal', 'make <ci> green')
    expect(instance.activeTools()).toContain('goal')
    expect(instance.messages.at(-1)).toMatchObject({
      message: { customType: 'guided-goal-interview', display: false },
      options: { triggerTurn: true, deliverAs: 'followUp' },
    })
    expect(instance.messages.at(-1).message.content).toContain(
      '<rough-goal>\nmake &lt;ci&gt; green\n</rough-goal>',
    )
    await instance.command('guided-goal', '')
    expect(instance.messages.at(-1).message.content).toContain('No objective stated')
  })

  test('pauses an active goal on session resume', async () => {
    const instance = harness([
      {
        type: 'custom',
        customType: 'pi-goal-mode',
        data: { version: 2, mode: 'goal', goal: storedGoal() },
      },
    ])
    await instance.emit('session_start', { reason: 'resume' })
    expect(latestMode(instance)).toMatchObject({
      mode: 'goal_paused',
      goal: { status: 'paused', tokensUsed: 10 },
    })
    expect(instance.notices.at(-1).text).toBe(
      'Goal paused on session resume. Use /goal resume to continue.',
    )
    expect(instance.activeTools()).toContain('goal')
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
  })

  test('restores a paused goal and ignores invalid entries', async () => {
    const instance = harness([
      {
        type: 'custom',
        customType: 'pi-goal-mode',
        data: { version: 2, mode: 'goal_paused', goal: storedGoal({ status: 'paused' }) },
      },
      { type: 'custom', customType: 'pi-goal-mode', data: { version: 1 } },
    ])
    await instance.emit('session_start', { reason: 'resume' })
    expect(
      instance.notices.some((notice) => notice.text === 'Ignored an invalid persisted goal state.'),
    ).toBe(true)
    const result = await instance.tool({ op: 'get' })
    expect(result.details.goal).toMatchObject({ objective: 'restore me', status: 'paused' })
    expect(modeEntries(instance)).toHaveLength(0)
  })

  test('clears state after a none entry', async () => {
    const instance = harness([
      {
        type: 'custom',
        customType: 'pi-goal-mode',
        data: { version: 2, mode: 'goal', goal: storedGoal() },
      },
      { type: 'custom', customType: 'pi-goal-mode', data: { version: 2, mode: 'none' } },
    ])
    await instance.emit('session_start', { reason: 'resume' })
    expect(instance.activeTools()).not.toContain('goal')
    const result = await instance.tool({ op: 'get' })
    expect(result.content[0].text).toBe('No active goal.')
  })

  test('appends live todo state to the goal context when todo_write is active', async () => {
    const instance = harness([
      todoEntry([
        { id: '1', content: 'Read <config>', status: 'completed' },
        { id: '2', content: 'Write tests', status: 'in_progress' },
      ]),
    ])
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'ship with todos')
    const withoutTodoTool = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(withoutTodoTool.message.content).not.toContain('<todo_context>')

    instance.setActiveTools([...instance.activeTools(), 'todo_write'])
    const injected = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(injected.message.content).toContain('</goal_context>\n<todo_context>')
    expect(injected.message.content).toContain('Overall: 1/2 done, 1 open.')
    expect(injected.message.content).toContain('- [completed] #1 Read &lt;config&gt;')
    expect(injected.message.content).toContain('- [in_progress] #2 Write tests')
  })

  test('renders the goal tool call and result for the TUI', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    expect(instance.renderCall({ op: 'create', objective: 'ship it', token_budget: 5000 })).toBe(
      '<muted>⏳</muted> <accent>Goal</accent>: <muted>set</muted> <muted>"ship it"</muted> · budget 5,000',
    )
    expect(instance.renderCall({ op: 'get' })).toBe(
      '<muted>⏳</muted> <accent>Goal</accent>: <muted>check</muted>',
    )
    const created = await instance.tool({ op: 'create', objective: 'ship it', token_budget: 5000 })
    expect(instance.renderResult(created)).toBe(
      [
        '<accent>◎</accent> <accent>Goal</accent>: <muted>set</muted> <accent>⟦active⟧</accent>',
        '  <muted>"ship it"</muted>',
        '  0 / 5,000 tokens (5,000 left)',
      ].join('\n'),
    )
    await instance.emit('agent_start')
    await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
    vi.setSystemTime(72_000)
    const completed = await instance.tool({ op: 'complete' })
    expect(instance.renderResult(completed)).toBe(
      [
        '<accent>◎</accent> <accent>Goal</accent>: <muted>complete</muted> <success>⟦complete⟧</success>',
        '  <muted>"ship it"</muted>',
        '  0 / 5,000 tokens (5,000 left) · 1m 2s elapsed',
        '  Report',
        '    <muted>Goal achieved. Report final budget usage to the user: tokens used: 0 of 5000; time used: 62 seconds.</muted>',
      ].join('\n'),
    )
    const dropped = await instance.tool({ op: 'get' })
    expect(instance.renderResult(dropped)).toContain('<success>⟦complete⟧</success>')
    expect(
      instance.renderResult({ content: [{ type: 'text', text: 'boom' }], details: undefined }),
    ).toBe('✘ <accent>Goal</accent>\n  boom')
    expect(
      instance.renderResult({
        content: [],
        details: { op: 'get', goal: null, remainingTokens: null, completionBudgetReport: null },
      }),
    ).toBe(
      '<warning>⚠</warning> <accent>Goal</accent>: <muted>check</muted> <warning>no active goal</warning>',
    )
  })

  test('does not continue while a scheduled or repeat loop is active', async () => {
    const branch = []
    const instance = harness(branch)
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'ship under a loop')
    branch.push({ type: 'custom', customType: 'pi-loop-state', data: { status: 'active' } })
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
    branch.push({ type: 'custom', customType: 'pi-loop-state', data: { status: 'stopped' } })
    branch.push({ type: 'custom', customType: 'pi-loop-repeat', data: { enabled: true } })
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
    branch.push({ type: 'custom', customType: 'pi-loop-repeat', data: { enabled: false } })
    branch.push({ type: 'custom', customType: 'pi-loop-repeat', data: { nope: true } })
    await runTurn(instance, { tool: 'read' })
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(1)
    expect(instance.messages[0].message.customType).toBe('goal-continuation')
  })

  test('persists wall-clock usage on shutdown', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'shutdown safe')
    await instance.emit('agent_start')
    await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
    vi.setSystemTime(14_000)
    await instance.emit('session_shutdown')
    expect(latestMode(instance)).toMatchObject({
      mode: 'goal',
      goal: { status: 'active', timeUsedSeconds: 4 },
    })
  })
})
