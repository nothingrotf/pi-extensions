import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const railReplacementEntryType = 'hud-rail-replacement'

const RailReplacementEntrySchema = Type.Object({
  toolCallId: Type.String({ minLength: 1 }),
  turn: Type.Integer({ minimum: 0 }),
})

export type RailReplacementEntry = {
  toolCallId: string
  turn: number
}

export function decodeRailReplacementEntry<Input>(data: Input): RailReplacementEntry | undefined {
  return Value.Check(RailReplacementEntrySchema, data) ? data : undefined
}
