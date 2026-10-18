import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const backgroundStateChannel = 'background-commands:state'
export const backgroundStateRequestChannel = 'background-commands:state:request'

const BackgroundStateSchema = Type.Object({
  version: Type.Literal(1),
  running: Type.Integer({ minimum: 0 }),
  stopping: Type.Integer({ minimum: 0 }),
})

export type BackgroundCommandsState = {
  running: number
  stopping: number
}

export function idleBackgroundCommands(): BackgroundCommandsState {
  return { running: 0, stopping: 0 }
}

export function decodeBackgroundState<Input>(data: Input): BackgroundCommandsState | undefined {
  if (!Value.Check(BackgroundStateSchema, data)) return undefined
  return { running: data.running, stopping: data.stopping }
}
