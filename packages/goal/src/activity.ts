import { Type, type Static } from 'typebox'

import { GoalCheckKindSchema, type GoalCheckKind, type GoalCheckResult } from './state.ts'

export type GoalProgressEvent =
  | { type: 'check-start'; kind: GoalCheckKind; label: string; command: string }
  | { type: 'check-end'; check: GoalCheckResult }
  | {
      type: 'reviewer'
      phase: 'starting-reviewer' | 'reviewing'
      model?: string
      tool?: string
      tokens?: number
    }

export const GoalActivitySchema = Type.Object({
  goalId: Type.String(),
  phase: Type.Union([
    Type.Literal('coding'),
    Type.Literal('checks'),
    Type.Literal('starting-reviewer'),
    Type.Literal('reviewing'),
    Type.Literal('waiting'),
    Type.Literal('queued'),
  ]),
  startedAt: Type.Number(),
  updatedAt: Type.Number(),
  detail: Type.String(),
  model: Type.Optional(Type.String()),
  tool: Type.Optional(Type.String()),
  tokens: Type.Number(),
  checks: Type.Array(
    Type.Object({
      kind: GoalCheckKindSchema,
      label: Type.String(),
      command: Type.Optional(Type.String()),
      status: Type.Union([
        Type.Literal('running'),
        Type.Literal('passed'),
        Type.Literal('failed'),
        Type.Literal('unavailable'),
      ]),
      startedAt: Type.Number(),
      durationMs: Type.Optional(Type.Number()),
    }),
    { maxItems: 4 },
  ),
})

export type GoalActivity = Static<typeof GoalActivitySchema>
export type GoalActivityPhase = GoalActivity['phase']

export class GoalActivityTracker {
  private current: GoalActivity | undefined

  constructor(
    private readonly changed: () => void,
    private readonly now = Date.now,
  ) {}

  get(): GoalActivity | undefined {
    return this.current
  }

  touch(): void {
    if (this.current === undefined) return
    const now = this.now()
    if (this.current.updatedAt === now) return
    this.current = { ...this.current, updatedAt: now }
    this.changed()
  }

  clear(): void {
    if (this.current === undefined) return
    this.current = undefined
    this.changed()
  }

  transition(goalId: string, phase: GoalActivityPhase, detail: string, reset = false): void {
    const previous = reset ? undefined : this.current
    if (previous?.goalId === goalId && previous.phase === phase && previous.detail === detail)
      return
    const now = this.now()
    this.current = {
      goalId,
      phase,
      detail: detail.slice(0, 240),
      startedAt: previous?.goalId === goalId && previous.phase === phase ? previous.startedAt : now,
      updatedAt: now,
      tokens: 0,
      checks: previous?.goalId === goalId ? previous.checks : [],
    }
    this.changed()
  }

  progress(event: GoalProgressEvent): void {
    const current = this.current
    if (current === undefined) return
    const now = this.now()
    if (event.type === 'reviewer') {
      const next: GoalActivity = {
        ...current,
        phase: event.phase,
        startedAt: current.phase === event.phase ? current.startedAt : now,
        updatedAt: now,
        detail:
          event.phase === 'starting-reviewer'
            ? 'Starting independent reviewer'
            : 'Independent reviewer working',
        tokens: event.tokens === undefined ? current.tokens : Math.max(0, event.tokens),
      }
      if (event.model !== undefined) next.model = event.model.slice(0, 240)
      if (event.tool === undefined) delete next.tool
      else next.tool = event.tool.slice(0, 120)
      this.current = next
    } else {
      const check = event.type === 'check-start' ? event : event.check
      const previous = current.checks.find((item) => item.kind === check.kind)
      const item: GoalActivity['checks'][number] = {
        kind: check.kind,
        label: check.label.slice(0, 120),
        status: event.type === 'check-start' ? 'running' : event.check.status,
        startedAt: event.type === 'check-start' ? now : (previous?.startedAt ?? now),
      }
      if (check.command !== undefined) item.command = check.command.slice(0, 500)
      if (event.type === 'check-end') item.durationMs = event.check.durationMs
      const checks = current.checks.filter((other) => other.kind !== check.kind)
      const index = current.checks.findIndex((other) => other.kind === check.kind)
      checks.splice(index < 0 ? checks.length : index, 0, item)
      this.current = { ...current, updatedAt: now, checks }
    }
    this.changed()
  }
}
