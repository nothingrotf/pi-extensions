import { decideGoalReview, type GoalReviewDecision } from './convergence.ts'
import { completionBudgetReport, renderGoalPrompt } from './prompts.ts'
import {
  cloneGoalState,
  createGoalLoop,
  type Goal,
  type GoalBudgetSteering,
  type GoalCheckResult,
  type GoalLoopOptions,
  type GoalModeState,
  type GoalPersistMode,
  type GoalRuntimeEvent,
  type GoalTokenUsage,
  type GoalVerdictStatus,
  goalUsageTotal,
  isAccountingStatus,
  MAX_GOAL_ITERATIONS,
  MAX_GOAL_STEERING,
  MAX_PENDING_STEERING,
  MAX_VERDICT_HISTORY,
  withTokenBudget,
} from './state.ts'

export interface GoalRuntimeHost {
  getState(): GoalModeState | undefined
  setState(state: GoalModeState | undefined): void
  getCurrentUsage(): GoalTokenUsage
  emit(event: GoalRuntimeEvent): void | Promise<void>
  persist(mode: GoalPersistMode, state?: GoalModeState): void
  sendHiddenMessage(message: {
    customType: string
    content: string
    deliverAs?: 'steer' | 'followUp' | 'nextTurn'
  }): Promise<void>
  nextId(): string
  now?(): number
}

export interface GoalTurnSnapshot {
  turnId: string
  baselineUsage: GoalTokenUsage
  activeGoalId?: string
}

export interface GoalWallClockSnapshot {
  lastAccountedAt: number
  activeGoalId?: string
}

export interface GoalRuntimeSnapshot {
  turnSnapshot?: GoalTurnSnapshot
  wallClock: GoalWallClockSnapshot
  budgetReportedFor?: string
}

export interface GoalCreateInput extends GoalLoopOptions {
  objective: string
  tokenBudget?: number
}

export interface GoalReviewOutcome {
  status: GoalVerdictStatus
  reason: string
  evidence: readonly string[]
  checks: readonly GoalCheckResult[]
  reviewerModel: string
  report: string
  usage: GoalTokenUsage
}

export interface GoalReviewApplication {
  decision: GoalReviewDecision
  state: GoalModeState
}

export interface GoalReviewIdentity {
  goalId: string
  iteration: number
}

export class GoalRuntimeError extends Error {}

function cloneUsage(usage: GoalTokenUsage): GoalTokenUsage {
  return { ...usage }
}

function persistMode(state: GoalModeState): GoalPersistMode {
  return state.enabled ? 'goal' : 'goal_paused'
}

function boundedText(value: string, length: number, fallback: string): string {
  const trimmed = value.trim()
  return (trimmed.length === 0 ? fallback : trimmed).slice(0, length)
}

function boundedList(values: readonly string[], count: number, length: number): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, count)
    .map((value) => value.slice(0, length))
}

function reviewRecord(outcome: GoalReviewOutcome, now: number) {
  return {
    status: outcome.status,
    reason: boundedText(outcome.reason, 2_000, 'The reviewer returned no reason.'),
    evidence: boundedList(outcome.evidence, 24, 1_000),
    checks: structuredClone(outcome.checks).slice(0, 4),
    reviewedAt: now,
    reviewerModel: boundedText(outcome.reviewerModel, 240, 'unknown'),
    report: outcome.report.slice(0, 4_000),
    usage: cloneUsage(outcome.usage),
  }
}

export function goalTokenDelta(current: GoalTokenUsage, baseline: GoalTokenUsage): number {
  return (
    Math.max(0, current.input - baseline.input) +
    Math.max(0, current.cacheWrite - baseline.cacheWrite) +
    Math.max(0, current.output - baseline.output)
  )
}

export function validateTokenBudget(tokenBudget: number | undefined): void {
  if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
    throw new GoalRuntimeError('token_budget must be a positive integer when provided')
  }
}

export function validateMaxIterations(maxIterations: number): void {
  if (
    !Number.isInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > MAX_GOAL_ITERATIONS
  ) {
    throw new GoalRuntimeError(`max_iterations must be an integer from 1 to ${MAX_GOAL_ITERATIONS}`)
  }
}

export function validateReviewModel(model: string | undefined, label: string): void {
  if (model === undefined) return
  const separator = model.indexOf('/')
  if (separator <= 0 || separator === model.length - 1 || /\s/.test(model) || model.length > 240) {
    throw new GoalRuntimeError(`${label} must use provider/model-id syntax`)
  }
}

export { completionBudgetReport }

export class GoalRuntime {
  readonly #host: GoalRuntimeHost
  #turnSnapshot: GoalTurnSnapshot | undefined
  #wallClock: GoalWallClockSnapshot
  #budgetReportedFor: string | undefined
  #accountingTail: Promise<void> = Promise.resolve()

  constructor(host: GoalRuntimeHost) {
    this.#host = host
    this.#wallClock = { lastAccountedAt: this.#now() }
  }

  get snapshot(): GoalRuntimeSnapshot {
    const snapshot: GoalRuntimeSnapshot = { wallClock: { ...this.#wallClock } }
    if (this.#turnSnapshot !== undefined) {
      snapshot.turnSnapshot = {
        ...this.#turnSnapshot,
        baselineUsage: cloneUsage(this.#turnSnapshot.baselineUsage),
      }
    }
    if (this.#budgetReportedFor !== undefined) snapshot.budgetReportedFor = this.#budgetReportedFor
    return snapshot
  }

  #now(): number {
    return this.#host.now?.() ?? Date.now()
  }

  #hasAccountingState(): boolean {
    const state = this.#host.getState()
    return Boolean(state?.enabled && isAccountingStatus(state.goal))
  }

  async #withAccounting<T>(fn: () => Promise<T> | T): Promise<T> {
    const previous = this.#accountingTail
    const { promise, resolve } = Promise.withResolvers<void>()
    this.#accountingTail = previous.then(
      () => promise,
      () => promise,
    )
    await previous.catch(() => {})
    try {
      return await fn()
    } finally {
      resolve()
    }
  }

  #getStateClone(): GoalModeState | undefined {
    const state = this.#host.getState()
    return state === undefined ? undefined : cloneGoalState(state)
  }

  async #commitState(
    state: GoalModeState | undefined,
    options?: { persist?: GoalPersistMode; emit?: boolean },
  ): Promise<void> {
    this.#host.setState(state === undefined ? undefined : cloneGoalState(state))
    if (options?.persist !== undefined) this.#host.persist(options.persist, state)
    if (options?.emit === false) return
    const event: GoalRuntimeEvent = {
      type: 'goal_updated',
      goal: state === undefined ? null : { ...state.goal },
    }
    if (state !== undefined) event.state = cloneGoalState(state)
    await this.#host.emit(event)
  }

  #markActiveAccounting(goal: Goal, resetWallClock = false): void {
    if (resetWallClock || this.#wallClock.activeGoalId !== goal.id) {
      this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: goal.id }
    }
    if (this.#turnSnapshot !== undefined) {
      this.#turnSnapshot.activeGoalId = goal.id
      this.#turnSnapshot.baselineUsage = cloneUsage(this.#host.getCurrentUsage())
    }
  }

  #clearActiveAccounting(): void {
    this.#wallClock = { lastAccountedAt: this.#now() }
    if (this.#turnSnapshot !== undefined) delete this.#turnSnapshot.activeGoalId
  }

  clearAccounting(): void {
    this.#turnSnapshot = undefined
    this.#clearActiveAccounting()
    this.#budgetReportedFor = undefined
  }

  onTurnStart(turnId: string, baselineUsage: GoalTokenUsage): void {
    this.#turnSnapshot = { turnId, baselineUsage: cloneUsage(baselineUsage) }
    const state = this.#host.getState()
    if (state?.enabled === true && isAccountingStatus(state.goal)) {
      this.#turnSnapshot.activeGoalId = state.goal.id
      if (this.#wallClock.activeGoalId !== state.goal.id) {
        this.#wallClock = { lastAccountedAt: this.#now(), activeGoalId: state.goal.id }
      }
    }
  }

  async onToolCompleted(toolName: string): Promise<void> {
    if (toolName === 'goal' || !this.#hasAccountingState()) return
    await this.flushUsage('allowed')
  }

  async onGoalToolCompleted(): Promise<void> {
    if (!this.#hasAccountingState()) return
    await this.flushUsage('suppressed')
  }

  async onAgentEnd(options?: { currentUsage?: GoalTokenUsage }): Promise<void> {
    if (!this.#hasAccountingState()) {
      this.#turnSnapshot = undefined
      return
    }
    await this.flushUsage('suppressed', options?.currentUsage)
    this.#turnSnapshot = undefined
  }

  async onTaskAborted(options?: { reason?: 'interrupted' | 'internal' }): Promise<void> {
    const state = this.#host.getState()
    const needsAccounting = state?.enabled === true && isAccountingStatus(state.goal)
    const needsPause = options?.reason === 'interrupted' && needsAccounting
    if (!needsAccounting && !needsPause) {
      this.#turnSnapshot = undefined
      return
    }
    await this.#withAccounting(async () => {
      await this.#flushUsageLocked('suppressed', undefined, options?.reason === 'internal')
      this.#turnSnapshot = undefined
      if (options?.reason !== 'interrupted') return
      const cloned = this.#getStateClone()
      if (cloned?.enabled !== true || !isAccountingStatus(cloned.goal)) return
      cloned.enabled = false
      cloned.mode = 'active'
      cloned.goal.status = 'paused'
      cloned.goal.updatedAt = this.#now()
      cloned.loop.phase = 'between'
      cloned.loop.reviewRequested = false
      this.#clearActiveAccounting()
      this.#budgetReportedFor = undefined
      await this.#commitState(cloned, { persist: 'goal_paused' })
    })
  }

  async onThreadResumed(options?: {
    preserveActiveGoal?: boolean
  }): Promise<GoalModeState | undefined> {
    const state = this.#getStateClone()
    if (state === undefined) return undefined
    if (options?.preserveActiveGoal === true && state.enabled && isAccountingStatus(state.goal)) {
      this.#markActiveAccounting(state.goal, true)
      await this.#commitState(state, { emit: true })
      return state
    }
    if (state.enabled && isAccountingStatus(state.goal)) {
      state.enabled = false
      state.mode = 'active'
      state.goal.status = 'paused'
      state.goal.updatedAt = this.#now()
      state.loop.phase = 'between'
      state.loop.reviewRequested = false
      this.#clearActiveAccounting()
      this.#budgetReportedFor = undefined
      await this.#commitState(state, { persist: 'goal_paused' })
      return state
    }
    this.#clearActiveAccounting()
    await this.#commitState(state, { emit: true })
    return state
  }

  async onBudgetMutated(newBudget: number | undefined): Promise<GoalModeState | undefined> {
    validateTokenBudget(newBudget)
    return await this.#withAccounting(async () => {
      this.#budgetReportedFor = undefined
      await this.#flushUsageLocked('suppressed')
      const state = this.#getStateClone()
      if (state === undefined) return undefined
      state.goal = withTokenBudget(state.goal, newBudget)
      state.goal.updatedAt = this.#now()
      let shouldSteer = false
      if (newBudget !== undefined && state.goal.tokensUsed >= newBudget) {
        if (state.goal.status === 'active') {
          state.goal.status = 'budget-limited'
          shouldSteer = true
        }
      } else if (state.goal.status === 'budget-limited') {
        state.goal.status = state.enabled ? 'active' : 'paused'
        if (state.enabled) this.#markActiveAccounting(state.goal)
      } else if (
        state.goal.status === 'stuck' &&
        state.loop.stopReason?.startsWith('Token budget exhausted') === true
      ) {
        state.goal.status = 'paused'
        delete state.reason
        delete state.loop.stopReason
      }
      await this.#commitState(state, { persist: persistMode(state) })
      if (shouldSteer) await this.#sendBudgetLimitSteer(state.goal)
      return state
    })
  }

  async #flushUsageLocked(
    steering: GoalBudgetSteering,
    currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
    persistWallClock = false,
  ): Promise<void> {
    const state = this.#getStateClone()
    if (state?.enabled !== true || !isAccountingStatus(state.goal)) return
    if (
      this.#turnSnapshot?.activeGoalId !== state.goal.id &&
      this.#wallClock.activeGoalId !== state.goal.id
    ) {
      return
    }
    const tokenDelta =
      this.#turnSnapshot?.activeGoalId === state.goal.id
        ? goalTokenDelta(currentUsage, this.#turnSnapshot.baselineUsage)
        : 0
    const wallSeconds =
      this.#wallClock.activeGoalId === state.goal.id
        ? Math.max(0, Math.floor((this.#now() - this.#wallClock.lastAccountedAt) / 1_000))
        : 0
    if (tokenDelta <= 0 && wallSeconds <= 0) return
    state.goal.tokensUsed += tokenDelta
    state.goal.timeUsedSeconds += wallSeconds
    state.goal.updatedAt = this.#now()
    const flippedToBudgetLimited =
      state.goal.tokenBudget !== undefined &&
      state.goal.tokensUsed >= state.goal.tokenBudget &&
      state.goal.status === 'active'
    if (flippedToBudgetLimited) state.goal.status = 'budget-limited'
    if (this.#turnSnapshot?.activeGoalId === state.goal.id) {
      this.#turnSnapshot.baselineUsage = cloneUsage(currentUsage)
    }
    if (this.#wallClock.activeGoalId === state.goal.id && wallSeconds > 0) {
      this.#wallClock.lastAccountedAt += wallSeconds * 1_000
    }
    const shouldPersistUsage =
      tokenDelta > 0 || flippedToBudgetLimited || (persistWallClock && wallSeconds > 0)
    await this.#commitState(state, shouldPersistUsage ? { persist: 'goal' } : undefined)
    if (state.goal.status !== 'budget-limited') this.#budgetReportedFor = undefined
    if (
      steering === 'allowed' &&
      flippedToBudgetLimited &&
      this.#budgetReportedFor !== state.goal.id
    ) {
      await this.#sendBudgetLimitSteer(state.goal)
    }
  }

  liveUsage(): { tokensUsed: number; timeUsedSeconds: number } | undefined {
    const state = this.#host.getState()
    if (state === undefined) return undefined
    let tokensUsed = state.goal.tokensUsed
    let timeUsedSeconds = state.goal.timeUsedSeconds
    if (state.enabled && isAccountingStatus(state.goal)) {
      if (this.#turnSnapshot?.activeGoalId === state.goal.id) {
        tokensUsed += goalTokenDelta(this.#host.getCurrentUsage(), this.#turnSnapshot.baselineUsage)
      }
      if (this.#wallClock.activeGoalId === state.goal.id) {
        timeUsedSeconds += Math.max(
          0,
          Math.floor((this.#now() - this.#wallClock.lastAccountedAt) / 1000),
        )
      }
    }
    return { tokensUsed, timeUsedSeconds }
  }

  async flushUsage(
    steering: GoalBudgetSteering,
    currentUsage: GoalTokenUsage = this.#host.getCurrentUsage(),
  ): Promise<void> {
    await this.#withAccounting(() => this.#flushUsageLocked(steering, currentUsage))
  }

  #createGoalState(input: GoalCreateInput): GoalModeState {
    const now = this.#now()
    const goal = withTokenBudget(
      {
        id: this.#host.nextId(),
        objective: input.objective,
        status: 'active',
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: now,
        updatedAt: now,
      },
      input.tokenBudget,
    )
    return { enabled: true, mode: 'active', goal, loop: createGoalLoop(input) }
  }

  async createGoal(input: GoalCreateInput): Promise<GoalModeState> {
    const objective = input.objective.trim()
    if (objective.length === 0) {
      throw new GoalRuntimeError('objective is required when op=create')
    }
    validateTokenBudget(input.tokenBudget)
    validateMaxIterations(input.maxIterations ?? createGoalLoop().maxIterations)
    validateReviewModel(input.reviewModel, 'review_model')
    validateReviewModel(input.reviewFallbackModel, 'review_fallback_model')
    return await this.#withAccounting(async () => {
      const existing = this.#host.getState()
      if (
        existing !== undefined &&
        existing.goal.status !== 'dropped' &&
        existing.goal.status !== 'complete'
      ) {
        throw new GoalRuntimeError(
          'cannot create a new goal because this session already has a goal',
        )
      }
      const state = this.#createGoalState({ ...input, objective })
      this.#budgetReportedFor = undefined
      this.#markActiveAccounting(state.goal)
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async replaceGoal(input: GoalCreateInput): Promise<GoalModeState> {
    const objective = input.objective.trim()
    if (objective.length === 0) {
      throw new GoalRuntimeError('objective is required when op=replace')
    }
    validateTokenBudget(input.tokenBudget)
    validateMaxIterations(input.maxIterations ?? createGoalLoop().maxIterations)
    validateReviewModel(input.reviewModel, 'review_model')
    validateReviewModel(input.reviewFallbackModel, 'review_fallback_model')
    return await this.#withAccounting(async () => {
      const existing = this.#host.getState()
      if (existing?.enabled !== true || !isAccountingStatus(existing.goal)) {
        throw new GoalRuntimeError('cannot replace goal because no goal is active')
      }
      await this.#flushUsageLocked('suppressed')
      const state = this.#createGoalState({ ...input, objective })
      this.#budgetReportedFor = undefined
      this.#markActiveAccounting(state.goal)
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async resumeGoal(): Promise<GoalModeState> {
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state === undefined) throw new GoalRuntimeError('No paused goal.')
      if (state.goal.status === 'complete') throw new GoalRuntimeError('Goal is already complete.')
      if (state.goal.status === 'dropped') throw new GoalRuntimeError('Goal was dropped.')
      if (state.enabled) throw new GoalRuntimeError('Goal is already active.')
      if (state.goal.tokenBudget !== undefined && state.goal.tokensUsed >= state.goal.tokenBudget) {
        throw new GoalRuntimeError('Increase or clear the exhausted token budget before resume.')
      }
      if (state.loop.iteration >= state.loop.maxIterations) {
        throw new GoalRuntimeError('Increase the iteration cap before resume.')
      }
      state.enabled = true
      state.mode = 'active'
      delete state.reason
      delete state.loop.stopReason
      state.loop.convergenceStart = state.loop.iteration
      state.goal.status = 'active'
      state.goal.updatedAt = this.#now()
      state.loop.phase = 'between'
      state.loop.reviewRequested = false
      this.#budgetReportedFor = undefined
      this.#markActiveAccounting(state.goal)
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async pauseGoal(expected?: {
    goalId: string
    phase: GoalModeState['loop']['phase']
  }): Promise<GoalModeState | undefined> {
    return await this.#withAccounting(async () => {
      const current = this.#host.getState()
      if (
        expected !== undefined &&
        (current?.goal.id !== expected.goalId || current.loop.phase !== expected.phase)
      )
        return undefined
      await this.#flushUsageLocked('suppressed')
      const state = this.#getStateClone()
      if (state === undefined) return undefined
      if (
        expected !== undefined &&
        (state.goal.id !== expected.goalId || state.loop.phase !== expected.phase)
      )
        return undefined
      if (state.goal.status === 'complete') return state
      state.enabled = false
      state.mode = 'active'
      delete state.reason
      if (isAccountingStatus(state.goal)) state.goal.status = 'paused'
      state.goal.updatedAt = this.#now()
      state.loop.phase = 'between'
      state.loop.reviewRequested = false
      this.#clearActiveAccounting()
      this.#budgetReportedFor = undefined
      await this.#commitState(state, { persist: 'goal_paused' })
      return state
    })
  }

  async dropGoal(): Promise<Goal | undefined> {
    return await this.#withAccounting(async () => {
      await this.#flushUsageLocked('suppressed')
      const state = this.#getStateClone()
      if (state === undefined) return undefined
      const dropped: Goal = { ...state.goal, status: 'dropped', updatedAt: this.#now() }
      this.#clearActiveAccounting()
      this.#budgetReportedFor = undefined
      await this.#host.emit({
        type: 'goal_updated',
        goal: dropped,
        state: { ...state, enabled: false, goal: dropped },
      })
      await this.#commitState(undefined, { persist: 'none', emit: false })
      return dropped
    })
  }

  async requestReviewFromTool(): Promise<GoalModeState> {
    return await this.#withAccounting(async () => {
      await this.#flushUsageLocked('suppressed')
      const state = this.#getStateClone()
      if (state?.enabled !== true || !isAccountingStatus(state.goal)) {
        throw new GoalRuntimeError('cannot request review because no goal is active')
      }
      state.loop.reviewRequested = true
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async beginCodingTurn(): Promise<GoalModeState | undefined> {
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state?.enabled !== true || !isAccountingStatus(state.goal)) return state
      state.loop.phase = 'coding'
      state.loop.reviewRequested = false
      delete state.loop.nextPrompt
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async beginReview(): Promise<GoalModeState | undefined> {
    return await this.#withAccounting(async () => {
      await this.#flushUsageLocked('suppressed')
      const state = this.#getStateClone()
      if (state?.enabled !== true || !isAccountingStatus(state.goal)) return undefined
      if (state.loop.phase === 'reviewing') return undefined
      state.loop.phase = 'reviewing'
      state.loop.reviewRequested = false
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async queueReviewSteering(message: string): Promise<GoalModeState | undefined> {
    const text = message.trim()
    if (text.length > 2_000)
      throw new GoalRuntimeError(
        'Review steering must be at most 2,000 characters. Shorten it or revise the goal objective.',
      )
    if (text.length === 0) return this.#getStateClone()
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state?.enabled !== true || state.loop.phase !== 'reviewing') return state
      if (
        state.loop.pendingSteering.length >= MAX_PENDING_STEERING ||
        (state.loop.userSteering?.length ?? 0) + state.loop.pendingSteering.length >=
          MAX_GOAL_STEERING
      )
        throw new GoalRuntimeError('Goal steering is full. Pause the goal to revise its objective.')
      state.loop.pendingSteering = [...state.loop.pendingSteering, text]
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: 'goal' })
      return state
    })
  }

  async accountCancelledReview(goalId: string, usage: GoalTokenUsage): Promise<void> {
    await this.#withAccounting(async () => {
      const current = this.#host.getState()
      if (current?.goal.id !== goalId) return
      await this.#flushUsageLocked('suppressed', undefined, true)
      const state = this.#getStateClone()
      if (state === undefined || state.goal.id !== goalId || goalUsageTotal(usage) === 0) return
      state.goal.tokensUsed += goalUsageTotal(usage)
      state.goal.updatedAt = this.#now()
      if (
        state.goal.status === 'active' &&
        state.goal.tokenBudget !== undefined &&
        state.goal.tokensUsed >= state.goal.tokenBudget
      ) {
        state.goal.status = 'budget-limited'
      }
      await this.#commitState(state, { persist: persistMode(state) })
    })
  }

  async applyReview(
    outcome: GoalReviewOutcome,
    identity?: GoalReviewIdentity,
  ): Promise<GoalReviewApplication | undefined> {
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state?.enabled !== true || state.loop.phase !== 'reviewing') return undefined
      if (
        identity !== undefined &&
        (state.goal.id !== identity.goalId || state.loop.iteration !== identity.iteration)
      )
        return undefined
      await this.#flushUsageLocked('suppressed')
      const accounted = this.#host.getState()
      if (accounted === undefined) return undefined
      state.goal = { ...accounted.goal }
      state.goal.tokensUsed += goalUsageTotal(outcome.usage)
      state.goal.updatedAt = this.#now()
      if (
        state.goal.tokenBudget !== undefined &&
        state.goal.tokensUsed >= state.goal.tokenBudget &&
        state.goal.status === 'active'
      ) {
        state.goal.status = 'budget-limited'
      }
      const verdict = reviewRecord(outcome, this.#now())
      state.loop.iteration += 1
      state.loop.verdictHistory = [...state.loop.verdictHistory, verdict].slice(
        -MAX_VERDICT_HISTORY,
      )
      state.loop.phase = 'between'
      state.loop.reviewRequested = false
      if (state.loop.pendingSteering.length > 0) {
        state.loop.userSteering = [
          ...(state.loop.userSteering ?? []),
          ...state.loop.pendingSteering,
        ]
        state.loop.pendingSteering = []
      }
      const decision = decideGoalReview(state, verdict)
      if (decision.action === 'pass') {
        state.enabled = false
        state.mode = 'exiting'
        state.reason = 'completed'
        state.goal.status = 'complete'
        state.loop.pendingSteering = []
        delete state.loop.nextPrompt
        delete state.loop.stopReason
        this.#clearActiveAccounting()
        this.#budgetReportedFor = undefined
      } else if (decision.action === 'stuck') {
        state.enabled = false
        state.mode = 'active'
        state.reason = 'stuck'
        state.goal.status = 'stuck'
        state.loop.stopReason = decision.reason.slice(0, 2_000)
        delete state.loop.nextPrompt
        this.#clearActiveAccounting()
        this.#budgetReportedFor = undefined
      } else {
        state.enabled = true
        state.mode = 'active'
        state.goal.status = 'active'
        state.loop.nextPrompt = decision.coderPrompt.slice(0, 12_000)
        state.loop.pendingSteering = []
        delete state.reason
        delete state.loop.stopReason
      }
      await this.#commitState(state, { persist: persistMode(state) })
      return { decision, state: cloneGoalState(state) }
    })
  }

  async setMaxIterations(maxIterations: number): Promise<GoalModeState> {
    validateMaxIterations(maxIterations)
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state === undefined) throw new GoalRuntimeError('No goal is set.')
      if (state.enabled && maxIterations <= state.loop.iteration) {
        throw new GoalRuntimeError('The active iteration cap must exceed completed reviews.')
      }
      state.loop.maxIterations = maxIterations
      if (
        state.goal.status === 'stuck' &&
        state.loop.stopReason?.startsWith('Iteration cap reached') === true &&
        maxIterations > state.loop.iteration
      ) {
        state.goal.status = 'paused'
        delete state.reason
        delete state.loop.stopReason
      }
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: persistMode(state) })
      return state
    })
  }

  async setReviewModel(model: string | undefined): Promise<GoalModeState> {
    validateReviewModel(model, 'review_model')
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state === undefined) throw new GoalRuntimeError('No goal is set.')
      const trimmed = model?.trim()
      if (trimmed === undefined || trimmed.length === 0) delete state.loop.reviewModel
      else state.loop.reviewModel = trimmed.slice(0, 240)
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: persistMode(state) })
      return state
    })
  }

  async setRuntimeProbe(enabled: boolean): Promise<GoalModeState> {
    return await this.#withAccounting(async () => {
      const state = this.#getStateClone()
      if (state === undefined) throw new GoalRuntimeError('No goal is set.')
      state.loop.runtimeProbe = enabled
      state.goal.updatedAt = this.#now()
      await this.#commitState(state, { persist: persistMode(state) })
      return state
    })
  }

  buildActivePrompt(): string | undefined {
    const state = this.#host.getState()
    if (state?.enabled !== true || state.goal.status !== 'active') return undefined
    const base = renderGoalPrompt('active', state.goal, state.loop)
    return state.loop.nextPrompt === undefined ? base : `${base}\n\n${state.loop.nextPrompt}`
  }

  buildContinuationPrompt(): string | undefined {
    const state = this.#host.getState()
    if (state?.enabled !== true || state.goal.status !== 'active') return undefined
    return state.loop.nextPrompt ?? renderGoalPrompt('continuation', state.goal, state.loop)
  }

  async #sendBudgetLimitSteer(goal: Goal): Promise<void> {
    if (this.#budgetReportedFor === goal.id) return
    this.#budgetReportedFor = goal.id
    await this.#host.sendHiddenMessage({
      customType: 'goal-budget-limit',
      content: renderGoalPrompt('budget-limit', goal, this.#host.getState()?.loop),
      deliverAs: 'steer',
    })
  }
}
