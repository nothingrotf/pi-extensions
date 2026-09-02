import { Type } from 'typebox'
import { Value } from 'typebox/value'

const ScheduledLoopEntrySchema = Type.Object({
  status: Type.Union([Type.Literal('active'), Type.Literal('stopped')]),
})

const RepeatLoopEntrySchema = Type.Object({ enabled: Type.Boolean() })

export const scheduledLoopEntryType = 'pi-loop-state'
export const repeatLoopEntryType = 'pi-loop-repeat'

interface BranchEntry {
  type: string
  customType?: string
  data?: unknown
}

function decodeScheduled<Input>(value: Input): boolean | null {
  try {
    return Value.Decode(ScheduledLoopEntrySchema, value).status === 'active'
  } catch {
    return null
  }
}

function decodeRepeat<Input>(value: Input): boolean | null {
  try {
    return Value.Decode(RepeatLoopEntrySchema, value).enabled
  } catch {
    return null
  }
}

export function isLoopActive(entries: readonly BranchEntry[]): boolean {
  let scheduled = false
  let repeat = false
  for (const entry of entries) {
    if (entry.type !== 'custom') {
      continue
    }
    if (entry.customType === scheduledLoopEntryType) {
      const decoded = decodeScheduled(entry.data)
      if (decoded !== null) {
        scheduled = decoded
      }
    } else if (entry.customType === repeatLoopEntryType) {
      const decoded = decodeRepeat(entry.data)
      if (decoded !== null) {
        repeat = decoded
      }
    }
  }
  return scheduled || repeat
}
