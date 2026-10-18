import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { stripTerminalSequences } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { isTerminal, type CommandSnapshot, type ToolOutput } from './schema.ts'

export const stateChannel = 'background-commands:state'
export const stateRequestChannel = 'background-commands:state:request'
export const railToolsChannel = 'hud:rail-tools'
export const railActionChannel = 'hud:rail-action'
export const railEnabledChannel = 'hud:rail-enabled'

const toolName = 'background_command'

export interface CommandsState {
  readonly version: 1
  readonly running: number
  readonly stopping: number
}

export function commandsState(snapshots: readonly CommandSnapshot[]): CommandsState {
  let running = 0
  let stopping = 0
  for (const snapshot of snapshots) {
    if (snapshot.status === 'running') running += 1
    else if (snapshot.status === 'stopping') stopping += 1
  }
  return { version: 1, running, stopping }
}

export type RailStatus = 'error' | 'ok' | 'pending'

export interface RailActionReport {
  readonly toolCallId: string
  readonly toolName: typeof toolName
  readonly status: RailStatus
  readonly category: 'other'
  readonly iconKey: 'shell'
  readonly runningLabel: string
  readonly doneLabel: string
  readonly detail: string
  readonly summary?: string
  readonly output?: string
}

export interface RailCallArguments {
  readonly action: string
  readonly command?: string | undefined
  readonly name?: string | undefined
  readonly id?: string | undefined
}

const labels = new Map<string, readonly [string, string]>([
  ['start', ['Launching', 'Launched']],
  ['list', ['Listing', 'Listed']],
  ['output', ['Reading', 'Read']],
  ['stop', ['Stopping', 'Signaled']],
])

function scalar(value: string, maximum: number): string {
  const text = stripTerminalSequences(value).replace(/\s+/gu, ' ').trim()
  return text.length > maximum ? `${text.slice(0, maximum - 3)}...` : text
}

function shortId(id: string | undefined): string {
  return id === undefined ? '' : scalar(id, 128).slice(0, 8)
}

function statusText(snapshot: CommandSnapshot): string {
  return isTerminal(snapshot) && snapshot.exitCode !== null
    ? `${snapshot.status}, exit ${snapshot.exitCode}`
    : snapshot.status
}

function callDetail(args: RailCallArguments): string {
  switch (args.action) {
    case 'start':
      return scalar(args.name ?? args.command ?? '', 60)
    case 'list':
      return 'background commands'
    case 'output':
      return `${shortId(args.id)} log`.trim()
    default:
      return shortId(args.id)
  }
}

function resultParts(result: ToolOutput): { detail: string; summary: string } {
  switch (result.action) {
    case 'start':
      return { detail: scalar(result.snapshot.name, 60), summary: 'in background' }
    case 'list': {
      const state = commandsState(result.commands)
      const active = state.running + state.stopping
      const finished = result.commands.length - active
      const parts = [
        active > 0 ? `${active} active` : '',
        finished > 0 ? `${finished} finished` : '',
      ].filter((part) => part.length > 0)
      return { detail: 'background commands', summary: parts.join(' · ') || 'none' }
    }
    case 'output':
      return {
        detail: `${scalar(result.snapshot.name, 52)} log`,
        summary: statusText(result.snapshot),
      }
    case 'stop':
      return { detail: scalar(result.snapshot.name, 60), summary: statusText(result.snapshot) }
  }
}

export function railCallReport(toolCallId: string, args: RailCallArguments): RailActionReport {
  const [runningLabel, doneLabel] = labels.get(args.action) ?? ['Background', 'Background']
  return {
    toolCallId,
    toolName,
    status: 'pending',
    category: 'other',
    iconKey: 'shell',
    runningLabel,
    doneLabel,
    detail: callDetail(args),
  }
}

export function railResultReport(
  toolCallId: string,
  args: RailCallArguments,
  result: ToolOutput | undefined,
  errorText: string | undefined,
): RailActionReport {
  const call = railCallReport(toolCallId, args)
  if (errorText !== undefined || result === undefined)
    return { ...call, status: 'error', output: errorText ?? '' }
  return { ...call, ...resultParts(result), status: 'ok' }
}

const RailEnabledSchema = Type.Object({ enabled: Type.Boolean() })

export class HudBridge {
  private railEnabled = false

  constructor(private readonly pi: ExtensionAPI) {
    pi.events.on(railEnabledChannel, (data) => {
      this.railEnabled = Value.Check(RailEnabledSchema, data) && data.enabled
    })
  }

  get railActive(): boolean {
    return this.railEnabled
  }

  announce(): void {
    this.pi.events.emit(railToolsChannel, { tools: [toolName] })
  }

  report(report: RailActionReport): void {
    if (this.railEnabled) this.pi.events.emit(railActionChannel, report)
  }

  publish(state: CommandsState): void {
    this.pi.events.emit(stateChannel, state)
  }
}
