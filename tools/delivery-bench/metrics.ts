import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { sessionMetrics } from '../../packages/pstack/src/session-metrics.ts'

const HeaderSchema = Type.Object(
  {
    type: Type.Literal('session'),
    timestamp: Type.String(),
    parentSession: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const PartSchema = Type.Object(
  { type: Type.String(), name: Type.Optional(Type.String()), text: Type.Optional(Type.String()) },
  { additionalProperties: true },
)

const MessageEntrySchema = Type.Object(
  {
    type: Type.Literal('message'),
    timestamp: Type.String(),
    message: Type.Object(
      {
        role: Type.String(),
        content: Type.Optional(Type.Array(PartSchema)),
        toolName: Type.Optional(Type.String()),
        isError: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: true },
)

const TaskBatchSchema = Type.Object(
  { arguments: Type.Object({ tasks: Type.Array(Type.Unknown()) }, { additionalProperties: true }) },
  { additionalProperties: true },
)

const CustomEntrySchema = Type.Object(
  { type: Type.Literal('custom'), customType: Type.String(), data: Type.Unknown() },
  { additionalProperties: true },
)

const SubagentStateSchema = Type.Object(
  {
    records: Type.Array(
      Type.Object(
        {
          agentId: Type.String(),
          runGeneration: Type.Optional(Type.Number()),
          timing: Type.Optional(
            Type.Object(
              {
                requestedAt: Type.Number(),
                executionStartedAt: Type.Number(),
                executionEndedAt: Type.Optional(Type.Number()),
                workspaceSetupMs: Type.Number(),
              },
              { additionalProperties: true },
            ),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)

const WorkspaceSchema = Type.Object({ worktree: Type.String() }, { additionalProperties: true })

const CheckpointSchema = Type.Object(
  { summary: Type.Object({ state: Type.String() }, { additionalProperties: true }) },
  { additionalProperties: true },
)

export interface SessionFile {
  content: string
  path: string
}

export interface SessionRunMetrics {
  acceptedAfterMs: number | undefined
  agentExecutionMs: number
  attempts: number
  cacheReadTokens: number
  childSessions: number
  coordinatorTurns: number
  costUsd: number
  finalState: string | undefined
  inputTokens: number
  outputTokens: number
  preparationMs: number
  rootSession: string | undefined
  taskDispatches: number
  workspaceSetupMs: number
  worktree: string | undefined
}

interface AttemptTiming {
  executionEndedAt: number | undefined
  executionStartedAt: number
  requestedAt: number
  workspaceSetupMs: number
}

function entries(content: string): unknown[] {
  const parsed: unknown[] = []
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue
    try {
      parsed.push(JSON.parse(line))
    } catch {}
  }
  return parsed
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function isRoot(file: SessionFile): boolean {
  const header = entries(file.content)[0]
  return Value.Check(HeaderSchema, header) && header.parentSession === undefined
}

export function sessionRunMetrics(files: readonly SessionFile[]): SessionRunMetrics {
  const root = files.find(isRoot)
  const metrics: SessionRunMetrics = {
    acceptedAfterMs: undefined,
    agentExecutionMs: 0,
    attempts: 0,
    cacheReadTokens: 0,
    childSessions: files.filter((file) => file !== root).length,
    coordinatorTurns: 0,
    costUsd: 0,
    finalState: undefined,
    inputTokens: 0,
    outputTokens: 0,
    preparationMs: 0,
    rootSession: root?.path,
    taskDispatches: 0,
    workspaceSetupMs: 0,
    worktree: undefined,
  }
  for (const file of files) {
    const usage = sessionMetrics(file.content)
    metrics.cacheReadTokens += usage.cacheReadTokens
    metrics.costUsd += usage.costUsd
    metrics.inputTokens += usage.inputTokens
    metrics.outputTokens += usage.outputTokens
  }
  if (root === undefined) return metrics
  const attempts = new Map<string, AttemptTiming | undefined>()
  let startedAt: number | undefined
  for (const entry of entries(root.content)) {
    if (Value.Check(HeaderSchema, entry)) {
      startedAt = Date.parse(entry.timestamp)
    } else if (Value.Check(MessageEntrySchema, entry)) {
      const message = entry.message
      if (message.role === 'assistant') {
        metrics.coordinatorTurns += 1
        for (const part of message.content ?? []) {
          if (part.type !== 'toolCall' || part.name !== 'Task') continue
          metrics.taskDispatches += Value.Check(TaskBatchSchema, part)
            ? part.arguments.tasks.length
            : 1
        }
      } else if (
        message.role === 'toolResult' &&
        message.toolName === 'pstack_delivery' &&
        message.isError !== true
      ) {
        const text = (message.content ?? []).map((part) => part.text ?? '').join('')
        const checkpoint = parseJson(text)
        if (!Value.Check(CheckpointSchema, checkpoint)) continue
        metrics.finalState = checkpoint.summary.state
        if (
          checkpoint.summary.state === 'accepted' &&
          metrics.acceptedAfterMs === undefined &&
          startedAt !== undefined
        ) {
          metrics.acceptedAfterMs = Date.parse(entry.timestamp) - startedAt
        }
      }
    } else if (Value.Check(CustomEntrySchema, entry)) {
      if (
        entry.customType === '@nothingrotf/pstack/delivery-workspace-v1' &&
        Value.Check(WorkspaceSchema, entry.data)
      ) {
        metrics.worktree = entry.data.worktree
      } else if (
        entry.customType === 'pi-subagent-state' &&
        Value.Check(SubagentStateSchema, entry.data)
      ) {
        for (const record of entry.data.records) {
          const timing = record.timing
          attempts.set(
            `${record.agentId}:${record.runGeneration ?? 1}`,
            timing === undefined
              ? undefined
              : {
                  executionEndedAt: timing.executionEndedAt,
                  executionStartedAt: timing.executionStartedAt,
                  requestedAt: timing.requestedAt,
                  workspaceSetupMs: timing.workspaceSetupMs,
                },
          )
        }
      }
    }
  }
  metrics.attempts = attempts.size
  for (const timing of attempts.values()) {
    if (timing === undefined) continue
    metrics.preparationMs += timing.executionStartedAt - timing.requestedAt
    metrics.workspaceSetupMs += timing.workspaceSetupMs
    if (timing.executionEndedAt !== undefined)
      metrics.agentExecutionMs += timing.executionEndedAt - timing.executionStartedAt
  }
  return metrics
}

export interface RunResult extends SessionRunMetrics {
  acceptance: 'pass' | 'fail' | 'missing'
  arm: string
  exitCode: number
  run: number
  setupRuns: number
  wallMs: number
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle]
  const lower = sorted[middle - 1]
  if (upper === undefined) return undefined
  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2
}

function seconds(value: number | undefined): string {
  return value === undefined ? '-' : (value / 1000).toFixed(1)
}

function count(value: number | undefined): string {
  return value === undefined ? '-' : String(Math.round(value * 10) / 10)
}

function dollars(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(3)
}

function tokens(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value / 1000)}k`
}

interface Column {
  label: string
  value: (result: RunResult) => number | undefined
  format: (value: number | undefined) => string
}

const columns: readonly Column[] = [
  { label: 'Wall s', value: (result) => result.wallMs, format: seconds },
  { label: 'To accepted s', value: (result) => result.acceptedAfterMs, format: seconds },
  { label: 'Setup runs', value: (result) => result.setupRuns, format: count },
  { label: 'Attempts', value: (result) => result.attempts, format: count },
  { label: 'Agent exec s', value: (result) => result.agentExecutionMs, format: seconds },
  { label: 'Prep s', value: (result) => result.preparationMs, format: seconds },
  { label: 'Coordinator turns', value: (result) => result.coordinatorTurns, format: count },
  {
    label: 'Tokens in+out',
    value: (result) => result.inputTokens + result.outputTokens,
    format: tokens,
  },
  { label: 'Cache read', value: (result) => result.cacheReadTokens, format: tokens },
  { label: 'Cost USD', value: (result) => result.costUsd, format: dollars },
]

function row(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`
}

export function formatReport(results: readonly RunResult[]): string {
  const header = ['Arm', 'Run', 'State', 'Acceptance', ...columns.map((column) => column.label)]
  const lines = [
    '## Runs',
    '',
    row(header),
    row(header.map(() => '---')),
    ...results.map((result) =>
      row([
        result.arm,
        String(result.run),
        result.finalState ?? '-',
        result.acceptance,
        ...columns.map((column) => column.format(column.value(result))),
      ]),
    ),
  ]
  const armNames = [...new Set(results.map((result) => result.arm))]
  const medianHeader = [
    'Arm',
    'Runs',
    'Accepted',
    'Acceptance pass',
    ...columns.map((c) => c.label),
  ]
  lines.push(
    '',
    '## Medians',
    '',
    row(medianHeader),
    row(medianHeader.map(() => '---')),
    ...armNames.map((arm) => {
      const runs = results.filter((result) => result.arm === arm)
      return row([
        arm,
        String(runs.length),
        String(runs.filter((result) => result.finalState === 'accepted').length),
        String(runs.filter((result) => result.acceptance === 'pass').length),
        ...columns.map((column) =>
          column.format(
            median(
              runs.map((result) => column.value(result)).filter((value) => value !== undefined),
            ),
          ),
        ),
      ])
    }),
  )
  return `${lines.join('\n')}\n`
}
