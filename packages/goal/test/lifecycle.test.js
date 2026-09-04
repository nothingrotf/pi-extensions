import { Value } from 'typebox/value'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { createGoalExtension } from '../src/index.ts'
import { GoalReviewAbortedError } from '../src/reviewer.ts'

const theme = {
  bg(_color, text) {
    return text
  },
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

function outcome(overrides = {}) {
  return {
    status: 'FAIL',
    reason: 'The implementation is incomplete.',
    evidence: ['src/main.ts:1'],
    checks: [],
    reviewerModel: 'test/reviewer',
    report: '{"status":"FAIL"}',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    ...overrides,
  }
}

function passingChecks() {
  return [
    { kind: 'typecheck', label: 'Typecheck', status: 'passed', durationMs: 1 },
    { kind: 'test', label: 'Tests', status: 'passed', durationMs: 1 },
  ]
}

class FakeCheckRunner {
  constructor(results = passingChecks()) {
    this.results = results
    this.calls = []
  }

  async run(request) {
    this.calls.push(request)
    return structuredClone(this.results)
  }
}

class FakeReviewer {
  constructor(outcomes = [outcome()]) {
    this.outcomes = [...outcomes]
    this.calls = []
    this.steering = []
    this.imageSteering = []
    this.cancelCount = 0
    this.gate = undefined
    this.acceptSteering = true
  }

  hold() {
    this.gate = Promise.withResolvers()
    return this.gate
  }

  async review(request) {
    this.calls.push(request)
    if (this.gate !== undefined) return await this.gate.promise
    return structuredClone(this.outcomes.shift() ?? outcome())
  }

  async steer(message, images = []) {
    this.steering.push(message)
    this.imageSteering.push(structuredClone(images))
    return this.gate !== undefined && this.acceptSteering
  }

  async cancel() {
    this.cancelCount += 1
    this.gate?.resolve(outcome({ status: 'PARTIAL', reason: 'Cancelled.' }))
    this.gate = undefined
  }
}

function harness(options = {}) {
  const branch = options.branch ?? []
  const mode = options.mode ?? 'tui'
  const reviewer = options.reviewer ?? new FakeReviewer(options.outcomes)
  const checkRunner = options.checkRunner ?? new FakeCheckRunner(options.checks)
  const handlers = new Map()
  const tools = new Map()
  const commands = new Map()
  const messages = []
  const userMessages = []
  const entries = []
  const notices = []
  const busEvents = []
  const statuses = new Map()
  const widgetCalls = []
  let widget
  const tui = { requestRender() {} }
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
    sendMessage(message, sendOptions) {
      messages.push({ message, options: sendOptions })
    },
    sendUserMessage(content, sendOptions) {
      userMessages.push({ content, options: sendOptions })
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
    events: {
      emit(name, data) {
        busEvents.push({ name, data })
      },
    },
  }
  const ctx = {
    cwd: process.cwd(),
    hasUI: true,
    mode,
    model: undefined,
    modelRegistry: {},
    signal: undefined,
    thinkingLevel: 'medium',
    isIdle() {
      return idle
    },
    isProjectTrusted() {
      return true
    },
    hasPendingMessages() {
      return pending
    },
    sessionManager: {
      getBranch() {
        return branch
      },
      getSessionFile() {
        return undefined
      },
    },
    ui: {
      theme,
      notify(text, level) {
        notices.push({ text, level })
      },
      setStatus(key, value) {
        statuses.set(key, value)
      },
      setWidget(key, factory, widgetOptions) {
        widgetCalls.push({ key, factory, options: widgetOptions })
        widget = factory === undefined ? undefined : factory(tui, theme)
      },
      getEditorText() {
        return editorText
      },
      setEditorText(value) {
        editorText = value
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
  createGoalExtension({ checkRunner, reviewer })(api)
  return {
    async emit(name, event = {}) {
      const handler = handlers.get(name)
      if (handler === undefined) throw new Error(`Missing ${name} handler`)
      return await handler(event, ctx)
    },
    async command(name, args) {
      const command = commands.get(name)
      if (command === undefined) throw new Error(`Missing ${name} command`)
      return await command.handler(args, ctx)
    },
    async tool(params) {
      const tool = tools.get('goal')
      if (tool === undefined) throw new Error('Missing goal tool')
      return await tool.execute('call-1', params, undefined, undefined, ctx)
    },
    schema() {
      return tools.get('goal').parameters
    },
    renderCall(args) {
      return tools.get('goal').renderCall(args, theme, { state: {} }).render(200)[0]
    },
    renderResult(result) {
      return tools
        .get('goal')
        .renderResult(result, { expanded: false, isPartial: false }, theme, { state: {} }).text
    },
    entries,
    messages,
    userMessages,
    notices,
    busEvents,
    statuses,
    widgetCalls,
    reviewer,
    checkRunner,
    renderWidget(width = 120) {
      return widget?.render(width) ?? []
    },
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

function modeEntries(instance) {
  return instance.entries.filter((entry) => entry.customType === 'pi-goal-mode')
}

function latestMode(instance) {
  const entry = modeEntries(instance).at(-1)
  if (entry === undefined) throw new Error('No goal mode entry was persisted')
  return entry.data
}

function latestState(instance) {
  const mode = latestMode(instance)
  if (mode.mode === 'none') throw new Error('No goal state is active')
  return mode.state
}

function assistant(usage = {}, stopReason = 'stop') {
  return {
    role: 'assistant',
    content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...usage },
    stopReason,
  }
}

async function flushAsync() {
  for (let count = 0; count < 100; count += 1) await Promise.resolve()
}

async function runTurn(instance, options = {}) {
  await instance.emit('agent_start')
  await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
  const message = assistant(options.usage, options.stopReason)
  await instance.emit('message_end', { message })
  if (options.tool !== undefined) {
    await instance.emit('tool_execution_end', {
      toolCallId: 't',
      toolName: options.tool,
      result: {},
      isError: false,
    })
  }
  await instance.emit('agent_end', { messages: [message] })
  await instance.emit('agent_settled')
  await flushAsync()
}

function legacyGoal(overrides = {}) {
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

  test('creates a configured v3 goal and injects trusted context', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command(
      'goal',
      'ship the release --max=8 --review-model=openai/reviewer --runtime-probe',
    )
    expect(latestMode(instance)).toMatchObject({
      version: 3,
      mode: 'goal',
      state: {
        goal: { objective: 'ship the release', status: 'active', tokensUsed: 0 },
        loop: {
          maxIterations: 8,
          reviewModel: 'openai/reviewer',
          runtimeProbe: true,
        },
      },
    })
    expect(instance.userMessages).toEqual([{ content: 'ship the release', options: undefined }])
    expect(instance.renderWidget().join('\n')).toContain('⟲ goal · coding 1/8 ▾')
    const injected = await instance.emit('before_agent_start', { systemPrompt: 'base' })
    expect(injected.message.content).toContain('<objective>\nship the release\n</objective>')
    expect(injected.message.content).toContain('Only reviewer PASS can complete the goal.')
  })

  test('runs checks and independent review after every coding turn', async () => {
    const instance = harness({ outcomes: [outcome({ reason: 'Missing release notes.' })] })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'finish migration')
    await runTurn(instance, { tool: 'read', usage: { input: 2, output: 1 } })
    expect(instance.checkRunner.calls).toHaveLength(1)
    expect(instance.reviewer.calls).toHaveLength(1)
    expect(latestState(instance)).toMatchObject({
      enabled: true,
      goal: { status: 'active', tokensUsed: 3 },
      loop: { iteration: 1, phase: 'between' },
    })
    expect(latestState(instance).loop.verdictHistory[0]).toMatchObject({
      status: 'FAIL',
      reason: 'Missing release notes.',
    })
    expect(instance.entries.some((entry) => entry.customType === 'pi-goal-review')).toBe(true)
    await instance.command('goal', 'show')
    expect(instance.notices.at(-1).text).toContain('Review history:')
    expect(instance.notices.at(-1).text).toContain('Evidence: src/main.ts:1')
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages.at(-1)).toMatchObject({
      message: { customType: 'goal-continuation', display: false },
      options: { triggerTurn: true, deliverAs: 'followUp' },
    })
    expect(instance.messages.at(-1).message.content).toContain('Missing release notes.')
  })

  test('uses complete as a review request and exits only after PASS', async () => {
    const instance = harness({
      outcomes: [outcome({ status: 'PASS', reason: 'Every requirement is verified.' })],
    })
    await instance.emit('session_start', { reason: 'startup' })
    const created = await instance.tool({
      op: 'create',
      objective: 'tool goal',
      token_budget: 50,
      max_iterations: 6,
    })
    expect(created.details.loop.maxIterations).toBe(6)
    const requested = await instance.tool({ op: 'complete' })
    expect(requested.details.goal.status).toBe('active')
    expect(requested.details.loop.reviewRequested).toBe(true)
    expect(requested.content[0].text).toContain('Independent completion review requested')

    await runTurn(instance)
    expect(latestMode(instance)).toEqual({ version: 3, mode: 'none' })
    expect(instance.entries.at(-1)).toMatchObject({
      customType: 'pi-goal-completed',
      data: {
        version: 2,
        objective: 'tool goal',
        iterations: 1,
        finalVerdict: { status: 'PASS' },
      },
    })
    expect(instance.activeTools()).not.toContain('goal')
    expect(instance.notices.at(-1).text).toBe('Goal completed after independent review.')
  })

  test('overrides reviewer PASS when an automated check fails', async () => {
    const checkRunner = new FakeCheckRunner([
      {
        kind: 'typecheck',
        label: 'Typecheck',
        status: 'failed',
        durationMs: 3,
        command: 'bun run check',
        output: 'type error',
      },
      { kind: 'test', label: 'Tests', status: 'passed', durationMs: 2 },
    ])
    const instance = harness({
      checkRunner,
      outcomes: [outcome({ status: 'PASS', reason: 'Looks complete.' })],
    })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'fix types')
    await runTurn(instance)
    expect(latestState(instance).loop.verdictHistory[0]).toMatchObject({
      status: 'FAIL',
      reason: 'Automated checks failed: Typecheck.',
    })
    expect(latestState(instance).goal.status).toBe('active')
  })

  test('stops after an oscillating verdict', async () => {
    const repeated = outcome({ reason: 'Button remains broken at src/ui.ts:10.' })
    const instance = harness({ outcomes: [repeated, repeated, repeated] })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'repair button')
    await runTurn(instance)
    await vi.advanceTimersByTimeAsync(800)
    await runTurn(instance)
    expect(latestState(instance).enabled).toBe(true)
    await runTurn(instance)
    expect(latestMode(instance)).toMatchObject({
      mode: 'goal_paused',
      state: {
        enabled: false,
        reason: 'stuck',
        goal: { status: 'stuck' },
        loop: { iteration: 3 },
      },
    })
    expect(latestState(instance).loop.stopReason).toContain('same review failure')
    expect(instance.busEvents.at(-1)).toMatchObject({
      name: '@nothingrotf/goal/review-stop',
    })
  })

  test('preserves review steering for the coder and subsequent reviews', async () => {
    const reviewer = new FakeReviewer()
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'review steering')
    const gate = reviewer.hold()
    await runTurn(instance)
    expect(latestState(instance).loop.phase).toBe('reviewing')
    const result = await instance.emit('input', {
      text: 'Preserve the CLI output.',
      images: [{ type: 'image', data: 'AA==', mimeType: 'image/png' }],
      source: 'user',
    })
    expect(result).toEqual({ action: 'handled' })
    expect(reviewer.steering).toEqual(['Preserve the CLI output.'])
    expect(reviewer.imageSteering[0]).toHaveLength(1)
    gate.resolve(outcome({ reason: 'CLI output changed.' }))
    await flushAsync()
    expect(latestState(instance).loop.nextPrompt).toContain('Preserve the CLI output.')
    expect(latestState(instance).loop.userSteering).toEqual(['Preserve the CLI output.'])
    expect(latestState(instance).loop.pendingSteering).toEqual([])
    await runTurn(instance)
    expect(reviewer.calls.at(-1).state.loop.userSteering).toEqual(['Preserve the CLI output.'])
  })

  test('restarts a review when steering delivery fails', async () => {
    const reviewer = new FakeReviewer([
      outcome({ status: 'PASS', reason: 'The restarted review verified the note.' }),
    ])
    reviewer.acceptSteering = false
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'review delivery race')
    reviewer.hold()
    await runTurn(instance)
    await instance.emit('input', {
      text: 'Check the failure path.',
      images: [],
      source: 'user',
    })
    await flushAsync()
    expect(reviewer.calls).toHaveLength(2)
    expect(reviewer.calls[1].state.loop.pendingSteering).toContain('Check the failure path.')
    expect(latestMode(instance)).toEqual({ version: 3, mode: 'none' })
  })

  test('caps queued reviewer steering at five messages', async () => {
    const reviewer = new FakeReviewer()
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'bounded steering')
    const gate = reviewer.hold()
    await runTurn(instance)
    for (let index = 1; index <= 6; index += 1) {
      await instance.emit('input', {
        text: `Review note ${index}`,
        images: [],
        source: 'user',
      })
    }
    expect(reviewer.steering).toHaveLength(5)
    expect(latestState(instance).loop.pendingSteering).toHaveLength(5)
    gate.resolve(outcome({ status: 'PASS', reason: 'Verified with steering.' }))
    await flushAsync()
  })

  test('cancels review when the user pauses the goal', async () => {
    const reviewer = new FakeReviewer()
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'safely pause')
    reviewer.hold()
    await runTurn(instance)
    expect(latestState(instance).loop.phase).toBe('reviewing')
    await instance.command('goal', 'pause')
    await flushAsync()
    expect(reviewer.cancelCount).toBeGreaterThan(0)
    expect(latestState(instance)).toMatchObject({
      enabled: false,
      goal: { status: 'paused' },
      loop: { phase: 'between' },
    })
  })

  test('charges cancelled reviewer usage without applying its verdict', async () => {
    const reviewer = new FakeReviewer()
    reviewer.cancel = async () => {
      reviewer.gate?.reject(
        new GoalReviewAbortedError('Paused.', {
          input: 100,
          output: 20,
          cacheRead: 500,
          cacheWrite: 30,
        }),
      )
      reviewer.gate = undefined
    }
    const instance = harness({ reviewer })
    await instance.emit('session_start')
    await instance.command('goal', 'set pause review accounting')
    reviewer.hold()
    await runTurn(instance, { usage: { input: 10, output: 5 } })
    await instance.command('goal', 'pause')
    expect(latestState(instance).goal.tokensUsed).toBe(165)
    expect(latestState(instance).loop.verdictHistory).toEqual([])
    expect(latestState(instance).goal.status).toBe('paused')
  })

  test('cancels stale reviews before an external coding turn starts', async () => {
    const reviewer = new FakeReviewer()
    const instance = harness({ reviewer })
    await instance.emit('session_start')
    await instance.command('goal', 'review current code only')
    const gate = reviewer.hold()
    await runTurn(instance)
    await instance.emit('agent_start')
    gate.resolve(outcome({ status: 'PASS' }))
    await flushAsync()
    expect(latestState(instance).loop.phase).toBe('coding')
    expect(latestState(instance).loop.iteration).toBe(0)
    expect(instance.entries.some((entry) => entry.customType === 'pi-goal-completed')).toBe(false)
  })

  test('waits for late steering delivery before accepting PASS', async () => {
    const reviewer = new FakeReviewer([outcome({ reason: 'The new requirement needs work.' })])
    const delivery = Promise.withResolvers()
    reviewer.steer = async () => await delivery.promise
    const instance = harness({ reviewer })
    await instance.emit('session_start')
    await instance.command('goal', 'review with late guidance')
    const gate = reviewer.hold()
    await runTurn(instance)
    const input = instance.emit('input', { text: 'Check the cancellation path.', source: 'user' })
    await flushAsync()
    gate.resolve(outcome({ status: 'PASS' }))
    await flushAsync()
    expect(latestState(instance).loop.iteration).toBe(0)
    delivery.resolve(false)
    await input
    await flushAsync()
    expect(reviewer.calls).toHaveLength(2)
    expect(reviewer.calls[1].state.loop.pendingSteering).toContain('Check the cancellation path.')
    expect(latestState(instance).loop.verdictHistory[0].status).toBe('FAIL')
  })

  test('cancels an old review before goal replacement', async () => {
    const reviewer = new FakeReviewer()
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'first objective')
    const firstId = latestState(instance).goal.id
    reviewer.hold()
    await runTurn(instance)
    await instance.command('goal', 'set replacement objective')
    expect(latestState(instance)).toMatchObject({
      enabled: true,
      goal: { objective: 'replacement objective', status: 'active' },
      loop: { iteration: 0, phase: 'coding', verdictHistory: [] },
    })
    expect(latestState(instance).goal.id).not.toBe(firstId)
    expect(reviewer.cancelCount).toBeGreaterThan(0)
  })

  test('launches a final review when an idle budget becomes exhausted', async () => {
    const reviewer = new FakeReviewer([
      outcome({ reason: 'One fix remains.' }),
      outcome({ status: 'PASS', reason: 'The bounded goal passes.' }),
    ])
    const instance = harness({ reviewer })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'finish within budget --tokens=100')
    await runTurn(instance, { usage: { output: 6 } })
    expect(latestState(instance).loop.phase).toBe('between')
    await instance.command('goal', 'budget 1')
    await flushAsync()
    expect(reviewer.calls).toHaveLength(2)
    expect(latestMode(instance)).toEqual({ version: 3, mode: 'none' })
    expect(instance.busEvents.at(-1)).toMatchObject({
      name: '@nothingrotf/goal/review-stop',
      data: { reason: 'completed' },
    })
  })

  test('configures and resumes a stopped goal', async () => {
    const instance = harness({ outcomes: [outcome()] })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'one try --max=1')
    await runTurn(instance)
    expect(latestState(instance).goal.status).toBe('stuck')
    await instance.command('goal', 'resume')
    expect(instance.notices.at(-1).text).toContain('Increase the iteration cap')
    await instance.command('goal', 'max 3')
    await instance.command('goal', 'reviewer anthropic/reviewer')
    await instance.command('goal', 'probe on')
    await instance.command('goal', 'resume')
    expect(latestState(instance)).toMatchObject({
      enabled: true,
      goal: { status: 'active' },
      loop: { maxIterations: 3, reviewModel: 'anthropic/reviewer', runtimeProbe: true },
    })
  })

  test('pauses interrupted turns without a review', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'long task')
    await runTurn(instance, { stopReason: 'aborted', usage: { output: 4 } })
    expect(instance.reviewer.calls).toHaveLength(0)
    expect(latestState(instance)).toMatchObject({
      enabled: false,
      goal: { status: 'paused', tokensUsed: 4 },
    })
  })

  test('migrates v2 state and pauses active goals on resume', async () => {
    const instance = harness({
      branch: [
        {
          type: 'custom',
          customType: 'pi-goal-mode',
          data: { version: 2, mode: 'goal', goal: legacyGoal() },
        },
      ],
    })
    await instance.emit('session_start', { reason: 'resume' })
    expect(latestMode(instance)).toMatchObject({
      version: 3,
      mode: 'goal_paused',
      state: {
        goal: { status: 'paused', tokensUsed: 10 },
        loop: { iteration: 0, maxIterations: 5, phase: 'between' },
      },
    })
    expect(instance.notices.at(-1).text).toContain('Goal paused on session resume')
  })

  test('reviews under an external loop but leaves wake ownership external', async () => {
    const branch = [{ type: 'custom', customType: 'pi-loop-state', data: { status: 'active' } }]
    const instance = harness({ branch })
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'ship under loop')
    await runTurn(instance)
    expect(instance.reviewer.calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.messages).toHaveLength(0)
  })

  test('starts guided interview and keeps the goal tool exposed', async () => {
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
    expect(instance.messages.at(-1).message.content).toContain('max_iterations')
  })

  test('uses a closed schema and renders review metadata', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    expect(
      Value.Check(instance.schema(), {
        op: 'create',
        objective: 'ship',
        max_iterations: 7,
        runtime_probe: true,
      }),
    ).toBe(true)
    expect(Value.Check(instance.schema(), { op: 'get', extra: true })).toBe(false)
    expect(
      instance.renderCall({
        op: 'create',
        objective: 'ship it',
        token_budget: 5000,
        max_iterations: 7,
      }),
    ).toContain('budget 5,000 · max 7')
    const created = await instance.tool({
      op: 'create',
      objective: 'ship it',
      token_budget: 5000,
      max_iterations: 7,
    })
    expect(instance.renderResult(created)).toContain('review 0/7')
    expect(
      instance.renderResult({
        content: [],
        details: {
          op: 'get',
          goal: null,
          loop: null,
          remainingTokens: null,
          completionBudgetReport: null,
        },
      }),
    ).toContain('no active goal')
  })

  test('does not register the editor panel outside TUI mode', async () => {
    const instance = harness({ mode: 'rpc' })
    await instance.emit('session_start', { reason: 'startup' })
    expect(instance.widgetCalls).toEqual([])
  })

  test('persists wall time and cancels review on shutdown', async () => {
    const instance = harness()
    await instance.emit('session_start', { reason: 'startup' })
    await instance.command('goal', 'shutdown safe')
    await instance.emit('agent_start')
    await instance.emit('turn_start', { turnIndex: 0, timestamp: Date.now() })
    vi.setSystemTime(14_000)
    await instance.emit('session_shutdown')
    expect(latestState(instance).goal.timeUsedSeconds).toBe(4)
    expect(instance.widgetCalls.at(-1)).toMatchObject({ key: 'goal', factory: undefined })
  })
})
