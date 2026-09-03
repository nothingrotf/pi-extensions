import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Component } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const railToolsChannel = 'hud:rail-tools'
export const railActionChannel = 'hud:rail-action'
export const railEnabledChannel = 'hud:rail-enabled'

export type RailStatus = 'error' | 'ok' | 'pending'

export type RailIconKey =
  | 'agent'
  | 'ask'
  | 'edit'
  | 'find'
  | 'read'
  | 'search'
  | 'shell'
  | 'todo'
  | 'tool'
  | 'web'

export type RailActionReport = {
  detail?: string
  doneLabel?: string
  iconKey?: RailIconKey
  output?: string
  runningLabel?: string
  status: RailStatus
  summary?: string
  toolCallId: string
  toolName: string
}

export const emptyRailComponent: Component = {
  invalidate: () => undefined,
  render: () => [],
}

const RailEnabledSchema = Type.Object({ enabled: Type.Boolean() })

export class RailBridge {
  private enabled = false

  constructor(
    private readonly pi: ExtensionAPI,
    tools: readonly string[],
  ) {
    const names = [...tools]
    pi.events.on(railEnabledChannel, (data) => {
      this.enabled = Value.Check(RailEnabledSchema, data) && data.enabled
    })
    pi.on('session_start', () => {
      pi.events.emit(railToolsChannel, { tools: names })
    })
  }

  get active(): boolean {
    return this.enabled
  }

  report(report: RailActionReport): void {
    this.pi.events.emit(railActionChannel, report)
  }
}

export function railOutputText(content: readonly { type: string }[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && 'text' in block) {
      const value = block.text
      if (Value.Check(Type.String(), value)) parts.push(value)
    }
  }
  return parts.join('\n')
}
