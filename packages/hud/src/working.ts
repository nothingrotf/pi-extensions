import { Type } from 'typebox'
import { Value } from 'typebox/value'

export const workingMessageChannel = 'hud:working-message'

const WorkingMessageSchema = Type.Union([Type.String({ minLength: 1 }), Type.Null()])

export function decodeWorkingMessage<Input>(data: Input): string | null | undefined {
  return Value.Check(WorkingMessageSchema, data) ? data : undefined
}

export const defaultWorkingMessage = 'waiting for the model'
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_ADVANCE_MS = 80
const ELAPSED_DELAY_MS = 3_000

export type WorkingFrame = {
  elapsed: string | undefined
  message: string
  spinner: string
}

export function spinnerFrame(now: number): string {
  return SPINNER_FRAMES[Math.floor(now / SPINNER_ADVANCE_MS) % SPINNER_FRAMES.length] ?? '⠋'
}

export function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest > 0 ? `${minutes}m${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 > 0 ? `${hours}h${minutes % 60}m` : `${hours}h`
}

export function formatWorkingFrame(frame: WorkingFrame): string {
  const elapsed = frame.elapsed === undefined ? '' : ` · ${frame.elapsed}`
  return `${frame.spinner} ${frame.message}${elapsed}`
}

export class WorkingStatus {
  private message: string | undefined

  setMessage(message: string | undefined): void {
    this.message = message
  }

  overridden(): boolean {
    return this.message !== undefined
  }

  frame(startedAt: number, now = Date.now()): WorkingFrame {
    const duration = Math.max(0, now - startedAt)
    return {
      elapsed: duration < ELAPSED_DELAY_MS ? undefined : formatElapsed(duration),
      message: this.message ?? defaultWorkingMessage,
      spinner: spinnerFrame(now),
    }
  }
}
