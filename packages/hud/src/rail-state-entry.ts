import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { decodeRailAction, type RailActionReport } from './rail-channel.ts'

export const railStateEntryType = 'hud-rail-state'

const RailStateEntrySchema = Type.Object({
  report: Type.Unknown(),
  turn: Type.Integer({ minimum: 0 }),
})

export type RailStateEntry = {
  report: RailActionReport
  turn: number
}

export function decodeRailStateEntry<Input>(data: Input): RailStateEntry | undefined {
  if (!Value.Check(RailStateEntrySchema, data)) return undefined
  const report = decodeRailAction(data.report)
  return report === undefined ? undefined : { report, turn: data.turn }
}
