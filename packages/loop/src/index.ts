import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import { type Component, Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'

import {
  createLoop,
  decodeLoopState,
  dispatchLoopIteration,
  isActiveLoop,
  isDynamicLoop,
  isFixedLoop,
  type LoopState,
  recordDynamicWake,
  recordFixedWake,
  recoverLoop,
  scheduleDynamicLoop,
  settleLoopIteration,
  stopLoop,
  type Watch,
} from './machine.ts'
import { formatDuration, parseLoopInput, type ParsedLoop } from './policy.ts'
import {
  consumeRepeatIteration,
  decodeRepeatState,
  describeRepeat,
  describeRepeatLimit,
  describeRepeatLimitConfig,
  disableRepeat,
  enableRepeat,
  isRepeatExpired,
  parseRepeatArgs,
  pauseRepeat,
  type RepeatState,
  setRepeatPrompt,
} from './repeat.ts'
import { type LoopWatcher, startWatcher, validateWatch } from './watcher.ts'

const entryType = 'pi-loop-state'
const repeatEntryType = 'pi-loop-repeat'
const statusKey = 'pi-loop'
const repeatDelayMs = 800
const maximumDelaySeconds = 8_000_000_000_000
const LOOP_ICON = '↻'

interface LoopNextDetails {
  nextRunAt?: number | null
  scheduled: boolean
}

interface LoopStopDetails {
  stopped: boolean
}

interface LoopRenderState {
  hasResult?: boolean
}

function pendingLine(state: LoopRenderState, line: string): Component {
  return {
    invalidate: () => undefined,
    render: (): string[] => (state.hasResult === true ? [] : [line]),
  }
}

const LoopNextSchema = Type.Object({
  delaySeconds: Type.Integer({ minimum: 1, maximum: maximumDelaySeconds }),
  prompt: Type.Optional(Type.String({ minLength: 1 })),
  watch: Type.Optional(
    Type.Object({
      command: Type.String({ minLength: 1 }),
      pattern: Type.Optional(Type.String({ minLength: 1 })),
    }),
  ),
})

const LoopStopSchema = Type.Object({ reason: Type.String({ minLength: 1 }) })

function loopStatusLine(
  options: { icon: string; meta?: readonly string[]; title: string },
  theme: Theme,
): string {
  const meta = (options.meta ?? []).filter((part) => part.length > 0)
  const suffix = meta.length > 0 ? ` ${theme.fg('dim', meta.join(' · '))}` : ''
  return `${options.icon} ${theme.fg('accent', options.title)}${suffix}`
}
const maximumTimerDelayMs = 2_147_483_647

function describeState(state: LoopState | null, repeat: RepeatState | null = null): string {
  if (repeat?.enabled === true && !isActiveLoop(state)) {
    return describeRepeat(repeat)
  }
  if (state === null) {
    return 'No loop exists in this session.'
  }
  const cadence = state.mode === 'fixed' ? `every ${formatDuration(state.intervalMs)}` : 'dynamic'
  const next =
    state.nextRunAt === null ? '' : ` Next wake: ${new Date(state.nextRunAt).toISOString()}.`
  const pending = state.pendingWake ? ' One wake is pending.' : ''
  const reason = state.stopReason === null ? '' : ` Reason: ${state.stopReason}`
  return `Loop ${state.status}. Cadence: ${cadence}. Iterations: ${state.iterations}. Prompt: ${state.prompt}.${next}${pending}${reason}`
}

function activeInstructions(state: LoopState & { status: 'active' }): string {
  const instructions = [
    'A Pi loop is active in this session.',
    `Loop prompt: ${JSON.stringify(state.prompt)}`,
    `Loop iteration: ${state.iterations}`,
    'Execute the loop prompt in this turn.',
    'Call loop_stop when the loop must stop.',
  ]
  if (state.mode === 'dynamic') {
    instructions.push('Before this loop turn ends, call loop_next with the next useful delay.')
    instructions.push('You can change the next prompt or add an event watcher in loop_next.')
    instructions.push('Do not create a shell sleep loop. The loop machine owns the wake timer.')
  } else {
    instructions.push(`The loop machine fires every ${formatDuration(state.intervalMs)}.`)
    instructions.push('Do not create another timer or loop.')
  }
  return instructions.join('\n')
}

function trimmedText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function supportsLoops(ctx: ExtensionContext): boolean {
  return ctx.mode === 'tui' || ctx.mode === 'rpc'
}

function isExactDuplicate(state: LoopState, parsed: ParsedLoop): boolean {
  if (!isActiveLoop(state) || !parsed.ok || state.prompt !== parsed.prompt) {
    return false
  }
  if (state.mode === 'dynamic') {
    return parsed.schedule.mode === 'dynamic'
  }
  return parsed.schedule.mode === 'fixed' && state.intervalMs === parsed.schedule.intervalMs
}

export default function loop(pi: ExtensionAPI): void {
  let state: LoopState | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let timerGeneration = 0
  let watcher: LoopWatcher | undefined
  let watcherGeneration = 0
  let sessionContext: ExtensionContext | null = null
  let repeat: RepeatState | null = null
  let repeatTimer: ReturnType<typeof setTimeout> | undefined

  const cancelRepeatTimer = () => {
    if (repeatTimer !== undefined) {
      clearTimeout(repeatTimer)
      repeatTimer = undefined
    }
  }

  const persistRepeat = (ctx: ExtensionContext) => {
    if (repeat === null) {
      return
    }
    pi.appendEntry(repeatEntryType, repeat)
    refreshStatus(ctx)
  }

  const clearTimer = () => {
    timerGeneration += 1
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    timer = undefined
  }

  const stopWatcher = () => {
    watcherGeneration += 1
    watcher?.stop()
    watcher = undefined
  }

  const refreshStatus = (ctx: ExtensionContext) => {
    if (!isActiveLoop(state)) {
      if (repeat?.enabled === true) {
        const count =
          repeat.limit?.kind === 'iterations'
            ? `${repeat.iterations}/${repeat.limit.initial}`
            : String(repeat.iterations)
        const phase = repeat.paused ? 'paused' : repeat.prompt === null ? 'waiting' : 'running'
        ctx.ui.setStatus(statusKey, `Loop ${phase} ${count}`)
        return
      }
      ctx.ui.setStatus(statusKey, undefined)
      return
    }
    const cadence = state.mode === 'fixed' ? `every ${formatDuration(state.intervalMs)}` : 'dynamic'
    const phase = state.pendingWake ? 'running' : 'waiting'
    ctx.ui.setStatus(statusKey, `Loop ${phase} ${state.iterations} ${cadence}`)
  }

  const persist = (ctx: ExtensionContext) => {
    if (state === null) {
      return
    }
    pi.appendEntry(entryType, state)
    refreshStatus(ctx)
  }

  const restore = (ctx: ExtensionContext) => {
    clearTimer()
    stopWatcher()
    cancelRepeatTimer()
    state = null
    repeat = null
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== 'custom') {
        continue
      }
      if (entry.customType === entryType) {
        state = decodeLoopState(entry.data)
      } else if (entry.customType === repeatEntryType) {
        repeat = decodeRepeatState(entry.data)
      }
    }
    if (isActiveLoop(state)) {
      state = recoverLoop(state)
    }
    if (repeat?.enabled === true && !repeat.paused) {
      repeat = pauseRepeat(repeat)
      pi.appendEntry(repeatEntryType, repeat)
      ctx.ui.notify(
        'Repeat loop paused on session resume. Send a prompt or /loop resume to continue.',
        'info',
      )
    }
    refreshStatus(ctx)
  }

  const stopRepeat = (message: string, ctx: ExtensionContext): boolean => {
    cancelRepeatTimer()
    if (repeat?.enabled !== true) {
      return false
    }
    repeat = disableRepeat(repeat)
    persistRepeat(ctx)
    ctx.ui.notify(message, 'info')
    return true
  }

  const submitRepeatPrompt = (prompt: string) => {
    pi.sendUserMessage(prompt, { expandPromptTemplates: true })
  }

  const repeatBlocked = (ctx: ExtensionContext): boolean => {
    if (repeat?.enabled !== true || repeat.paused || repeat.prompt === null) {
      return true
    }
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      return true
    }
    return ctx.hasUI && ctx.ui.getEditorText().trim().length > 0
  }

  const runRepeatIteration = (ctx: ExtensionContext) => {
    if (repeat === null || repeatBlocked(ctx)) {
      return
    }
    const now = Date.now()
    if (isRepeatExpired(repeat, now)) {
      stopRepeat('Loop time limit reached. Repeat loop disabled.', ctx)
      return
    }
    const consumed = consumeRepeatIteration(repeat, now)
    if (!consumed.ok) {
      stopRepeat(`${consumed.reason} Repeat loop disabled.`, ctx)
      return
    }
    repeat = consumed.state
    persistRepeat(ctx)
    const prompt = consumed.state.prompt
    if (prompt === null) {
      return
    }
    if (consumed.state.between === 'compact') {
      ctx.compact({
        onComplete: () => submitRepeatPrompt(prompt),
        onError: () => submitRepeatPrompt(prompt),
      })
      return
    }
    submitRepeatPrompt(prompt)
  }

  const scheduleRepeat = (ctx: ExtensionContext) => {
    cancelRepeatTimer()
    if (repeatBlocked(ctx)) {
      return
    }
    repeatTimer = setTimeout(() => {
      repeatTimer = undefined
      runRepeatIteration(ctx)
    }, repeatDelayMs)
  }

  const startRepeat = (args: string, ctx: ExtensionContext) => {
    if (!supportsLoops(ctx)) {
      ctx.ui.notify('A loop requires a persistent TUI or RPC session.', 'error')
      return
    }
    if (repeat?.enabled === true) {
      stopRepeat('Repeat loop disabled.', ctx)
      return
    }
    if (isActiveLoop(state)) {
      ctx.ui.notify('Stop the scheduled loop before a repeat loop starts.', 'warning')
      return
    }
    const result = parseRepeatArgs(args)
    if (!result.ok) {
      ctx.ui.notify(result.error, 'error')
      return
    }
    const parsed = result.args
    repeat = enableRepeat(parsed, Date.now())
    persistRepeat(ctx)
    const limitSuffix = parsed.limit
      ? ` Limited to ${describeRepeatLimitConfig(parsed.limit)}.`
      : ''
    const remainingSuffix = repeat.limit ? ` ${describeRepeatLimit(repeat.limit)}.` : ''
    const betweenSuffix = parsed.between === 'compact' ? ' Compacts before each iteration.' : ''
    const tail = parsed.prompt
      ? 'Repeating it after each turn.'
      : 'Your next prompt will repeat after each turn.'
    ctx.ui.notify(
      `Repeat loop enabled.${limitSuffix}${remainingSuffix}${betweenSuffix} ${tail} Esc pauses; /loop repeat again disables.`,
      'info',
    )
    if (parsed.prompt !== undefined) {
      submitRepeatPrompt(parsed.prompt)
    }
  }

  const resumeRepeat = (ctx: ExtensionContext) => {
    if (repeat?.enabled !== true) {
      ctx.ui.notify('No repeat loop exists.', 'warning')
      return
    }
    if (repeat.prompt === null) {
      repeat = { ...repeat, paused: false }
      persistRepeat(ctx)
      ctx.ui.notify('Repeat loop waiting. Your next prompt will repeat after each turn.', 'info')
      return
    }
    repeat = { ...repeat, paused: false }
    persistRepeat(ctx)
    ctx.ui.notify('Repeat loop resumed.', 'info')
    scheduleRepeat(ctx)
  }

  const finish = (reason: string, ctx: ExtensionContext): boolean => {
    if (!isActiveLoop(state)) {
      return stopRepeat(`Repeat loop stopped. ${reason}`, ctx)
    }
    state = stopLoop(state, reason)
    clearTimer()
    stopWatcher()
    persist(ctx)
    return true
  }

  const sendPrompt = (prompt: string) => {
    pi.sendUserMessage(prompt, {
      deliverAs: 'followUp',
      expandPromptTemplates: true,
    })
  }

  const dispatchPending = (ctx: ExtensionContext) => {
    if (!isActiveLoop(state) || state.inFlight || !state.pendingWake || !ctx.isIdle()) {
      return
    }
    const nextState = dispatchLoopIteration(state, Date.now())
    state = nextState
    persist(ctx)
    sendPrompt(nextState.prompt)
  }

  const arm = (ctx: ExtensionContext) => {
    clearTimer()
    if (!isActiveLoop(state) || state.nextRunAt === null) {
      return
    }
    const loopId = state.id
    const expectedRunAt = state.nextRunAt
    const generation = timerGeneration
    const now = Date.now()
    const delay = Math.min(maximumTimerDelayMs, Math.max(0, expectedRunAt - now))
    timer = setTimeout(() => {
      timer = undefined
      if (
        generation !== timerGeneration ||
        !isActiveLoop(state) ||
        state.id !== loopId ||
        state.nextRunAt !== expectedRunAt
      ) {
        return
      }
      const currentTime = Date.now()
      if (currentTime < expectedRunAt) {
        arm(ctx)
        return
      }
      if (isFixedLoop(state)) {
        state = recordFixedWake(state, currentTime)
        persist(ctx)
        arm(ctx)
      } else if (isDynamicLoop(state)) {
        state = recordDynamicWake(state)
        stopWatcher()
        persist(ctx)
      }
      dispatchPending(ctx)
    }, delay)
  }

  const wakeFromWatcher = (
    loopId: string,
    expectedRunAt: number,
    generation: number,
    ctx: ExtensionContext,
  ) => {
    if (
      generation !== watcherGeneration ||
      !isDynamicLoop(state) ||
      state.id !== loopId ||
      state.nextRunAt !== expectedRunAt
    ) {
      return
    }
    state = recordDynamicWake(state)
    clearTimer()
    stopWatcher()
    persist(ctx)
    dispatchPending(ctx)
  }

  const armWatcher = (ctx: ExtensionContext) => {
    stopWatcher()
    if (!isDynamicLoop(state) || state.watch === null || state.nextRunAt === null) {
      return
    }
    const loopId = state.id
    const expectedRunAt = state.nextRunAt
    const generation = watcherGeneration
    let current: LoopWatcher | undefined
    current = startWatcher(state.watch, ctx.cwd, {
      wake() {
        wakeFromWatcher(loopId, expectedRunAt, generation, ctx)
      },
      exit() {
        if (watcher === current) {
          watcher = undefined
        }
      },
    })
    watcher = current
  }

  const stopFromCommand = (reason: string, ctx: ExtensionContext) => {
    if (!finish(reason, ctx)) {
      ctx.ui.notify('No active loop exists.', 'warning')
      return
    }
    ctx.ui.notify(`Loop stopped. ${reason}`, 'info')
  }

  const start = async (args: string, ctx: ExtensionContext): Promise<void> => {
    if (!supportsLoops(ctx)) {
      ctx.ui.notify('A loop requires a persistent TUI or RPC session.', 'error')
      return
    }
    const parsed = parseLoopInput(args)
    if (!parsed.ok) {
      ctx.ui.notify(parsed.error, 'warning')
      return
    }
    if (repeat?.enabled === true) {
      ctx.ui.notify('Stop the repeat loop before a scheduled loop starts.', 'warning')
      return
    }
    if (state !== null && isExactDuplicate(state, parsed)) {
      ctx.ui.notify(`The matching loop is already active. ${describeState(state)}`, 'info')
      return
    }
    if (isActiveLoop(state)) {
      if (!ctx.hasUI) {
        ctx.ui.notify('Stop the active loop before a new loop starts.', 'error')
        return
      }
      const replace = await ctx.ui.confirm(
        'Replace the active loop?',
        `Current: ${state.prompt}\n\nNew: ${parsed.prompt}`,
      )
      if (!replace) {
        return
      }
      finish('Replaced by a new loop.', ctx)
    }
    const now = Date.now()
    const nextState = createLoop(parsed, now, crypto.randomUUID())
    state = nextState
    persist(ctx)
    arm(sessionContext ?? ctx)
    if (nextState.mode === 'fixed') {
      ctx.ui.notify(`Loop started every ${formatDuration(nextState.intervalMs)}.`, 'info')
    } else {
      ctx.ui.notify('Dynamic loop started. The agent will select each next wake.', 'info')
    }
    sendPrompt(nextState.prompt)
  }

  const startSession = (ctx: ExtensionContext) => {
    sessionContext = ctx
    restore(ctx)
    if (!supportsLoops(ctx)) {
      return
    }
    dispatchPending(ctx)
    arm(ctx)
    armWatcher(ctx)
  }

  pi.on('session_start', (_event, ctx) => {
    startSession(ctx)
  })

  pi.on('session_tree', (_event, ctx) => {
    startSession(ctx)
  })

  pi.on('session_shutdown', () => {
    clearTimer()
    stopWatcher()
    cancelRepeatTimer()
    sessionContext = null
  })

  pi.on('input', (event, ctx) => {
    if (repeat?.enabled !== true || event.source === 'extension') {
      return
    }
    const text = event.text.trim()
    if (text.length === 0 || text.startsWith('/')) {
      return
    }
    cancelRepeatTimer()
    repeat = setRepeatPrompt(repeat, text)
    persistRepeat(ctx)
  })

  pi.on('agent_start', () => {
    cancelRepeatTimer()
  })

  pi.on('agent_end', (event, ctx) => {
    if (repeat?.enabled !== true || repeat.paused) {
      return
    }
    for (let index = event.messages.length - 1; index >= 0; index -= 1) {
      const message = event.messages[index]
      if (message?.role !== 'assistant') {
        continue
      }
      if (message.stopReason === 'aborted') {
        cancelRepeatTimer()
        repeat = pauseRepeat(repeat)
        persistRepeat(ctx)
        ctx.ui.notify('Repeat loop paused. Send a prompt or /loop resume to continue.', 'info')
      }
      return
    }
  })

  pi.on('before_agent_start', (event, ctx) => {
    if (!supportsLoops(ctx) || !isActiveLoop(state) || !state.inFlight) {
      return
    }
    return { systemPrompt: `${event.systemPrompt}\n\n${activeInstructions(state)}` }
  })

  pi.on('agent_settled', (_event, ctx) => {
    if (!isActiveLoop(state)) {
      scheduleRepeat(ctx)
      return
    }
    if (state.inFlight) {
      state = settleLoopIteration(state)
      persist(ctx)
    }
    dispatchPending(ctx)
  })

  pi.registerTool<typeof LoopNextSchema, LoopNextDetails, LoopRenderState>({
    name: 'loop_next',
    label: 'Loop next',
    description: 'Set the next wake for an active dynamic loop. An optional watcher wakes earlier.',
    promptSnippet: 'Schedule the next wake for an active dynamic loop',
    parameters: LoopNextSchema,
    executionMode: 'sequential',
    renderCall(args, theme, context) {
      const meta = [`in ${formatDuration(args.delaySeconds * 1_000)}`]
      if (args.watch !== undefined) meta.push(`watch ${trimmedText(args.watch.command) ?? ''}`)
      if (args.prompt !== undefined) meta.push('new prompt')
      return pendingLine(
        context.state,
        loopStatusLine({ icon: theme.fg('muted', '⏳'), meta, title: 'Loop next' }, theme),
      )
    },
    renderResult(result, _options, theme, context) {
      context.state.hasResult = true
      const text = result.content.find((item) => item.type === 'text')
      const message = text?.type === 'text' ? text.text : ''
      const scheduled = result.details?.scheduled === true
      return new Text(
        loopStatusLine(
          {
            icon: scheduled ? theme.fg('accent', LOOP_ICON) : theme.fg('warning', '⚠'),
            meta: [message],
            title: 'Loop next',
          },
          theme,
        ),
        0,
        0,
      )
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isDynamicLoop(state)) {
        return {
          content: [{ type: 'text', text: 'No active dynamic loop exists.' }],
          details: { scheduled: false },
        }
      }
      const prompt = params.prompt === undefined ? null : trimmedText(params.prompt)
      if (params.prompt !== undefined && prompt === null) {
        return {
          content: [{ type: 'text', text: 'A replacement prompt cannot be blank.' }],
          details: { scheduled: false },
        }
      }
      const nextWatch: Watch | null = params.watch
        ? {
            command: params.watch.command.trim(),
            pattern: params.watch.pattern?.trim() ?? null,
          }
        : null
      if (nextWatch !== null) {
        const error = validateWatch(nextWatch)
        if (error !== null) {
          return {
            content: [{ type: 'text', text: error }],
            details: { scheduled: false },
          }
        }
      }
      const nextState = scheduleDynamicLoop(
        state,
        {
          delayMs: params.delaySeconds * 1_000,
          prompt,
          watch: nextWatch,
        },
        Date.now(),
      )
      state = nextState
      persist(ctx)
      const runtimeContext = sessionContext ?? ctx
      arm(runtimeContext)
      armWatcher(runtimeContext)
      const watcherText = nextWatch === null ? '' : ' The watcher can wake it earlier.'
      return {
        content: [
          {
            type: 'text',
            text: `Next loop wake scheduled in ${formatDuration(params.delaySeconds * 1_000)}.${watcherText}`,
          },
        ],
        details: { scheduled: true, nextRunAt: nextState.nextRunAt },
      }
    },
  })

  pi.registerTool<typeof LoopStopSchema, LoopStopDetails, LoopRenderState>({
    name: 'loop_stop',
    label: 'Loop stop',
    description: 'Stop the active loop and cancel its timer and watcher.',
    promptSnippet: 'Stop an active loop',
    parameters: LoopStopSchema,
    executionMode: 'sequential',
    renderCall(args, theme) {
      return new Text(
        loopStatusLine(
          {
            icon: theme.fg('muted', '⏳'),
            meta: [trimmedText(args.reason) ?? ''],
            title: 'Loop stop',
          },
          theme,
        ),
        0,
        0,
      )
    },
    renderResult(result, _options, theme) {
      const text = result.content.find((item) => item.type === 'text')
      const message = text?.type === 'text' ? text.text : ''
      const stopped = result.details?.stopped === true
      return new Text(
        loopStatusLine(
          {
            icon: stopped ? theme.fg('warning', '⏹') : theme.fg('warning', '⚠'),
            meta: [message],
            title: 'Loop stop',
          },
          theme,
        ),
        0,
        0,
      )
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const reason = trimmedText(params.reason)
      if (!isActiveLoop(state)) {
        return {
          content: [{ type: 'text', text: 'No active loop exists.' }],
          details: { stopped: false },
        }
      }
      if (reason === null) {
        return {
          content: [{ type: 'text', text: 'A stop reason cannot be blank.' }],
          details: { stopped: false },
        }
      }
      finish(reason, ctx)
      ctx.ui.notify('Loop stopped by the agent.', 'warning')
      return {
        content: [{ type: 'text', text: 'Loop stopped. Do not schedule another wake.' }],
        details: { stopped: true },
      }
    },
  })

  pi.registerCommand('loop', {
    description: 'Run a prompt or skill on a fixed or dynamic interval',
    async handler(args, ctx) {
      const trimmed = args.trim()
      if (trimmed === 'status' || trimmed === 'list') {
        ctx.ui.notify(describeState(state, repeat), 'info')
        return
      }
      if (trimmed === 'repeat' || trimmed.startsWith('repeat ')) {
        startRepeat(trimmed.slice(6).trim(), ctx)
        return
      }
      if (trimmed === 'pause') {
        if (repeat?.enabled !== true) {
          ctx.ui.notify('No repeat loop exists.', 'warning')
          return
        }
        cancelRepeatTimer()
        repeat = pauseRepeat(repeat)
        persistRepeat(ctx)
        ctx.ui.notify('Repeat loop paused.', 'info')
        return
      }
      if (trimmed === 'resume') {
        resumeRepeat(ctx)
        return
      }
      if (trimmed === 'stop' || trimmed.startsWith('stop ')) {
        stopFromCommand(trimmed.slice(4).trim() || 'Stopped by the user.', ctx)
        return
      }
      await start(args, ctx)
    },
  })

  pi.registerCommand('loop-list', {
    description: 'Show the loop state for this session',
    handler: async (_args, ctx) => {
      ctx.ui.notify(describeState(state, repeat), 'info')
    },
  })

  pi.registerCommand('loop-stop', {
    description: 'Stop the active loop in this session',
    handler: async (args, ctx) => {
      stopFromCommand(args.trim() || 'Stopped by the user.', ctx)
    },
  })
}
