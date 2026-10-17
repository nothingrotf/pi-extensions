import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

const command = Type.String({ minLength: 1, maxLength: 65536, pattern: '\\S' })
const name = Type.String({ minLength: 1, maxLength: 200, pattern: '\\S' })
const timeout = Type.Number({ exclusiveMinimum: 0, maximum: 2_147_483.647 })
const id = Type.String({ minLength: 1, maxLength: 128 })

const StartSchema = Type.Object(
  { command, name: Type.Optional(name), timeout: Type.Optional(timeout) },
  { additionalProperties: false },
)
const RequestSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('start'), ...StartSchema.properties },
    { additionalProperties: false },
  ),
  Type.Object({ action: Type.Literal('list') }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('output'), id }, { additionalProperties: false }),
  Type.Object({ action: Type.Literal('stop'), id }, { additionalProperties: false }),
])

export const toolParameters = Type.Object(
  {
    action: Type.Union(['start', 'list', 'output', 'stop'].map((action) => Type.Literal(action))),
    command: Type.Optional(command),
    name: Type.Optional(name),
    timeout: Type.Optional(timeout),
    id: Type.Optional(id),
  },
  { additionalProperties: false },
)

export type StartCommand = Static<typeof StartSchema>
export type CommandRequest = Static<typeof RequestSchema>

export class BackgroundCommandError extends Error {
  constructor(
    readonly code: 'invalid-input' | 'capacity' | 'closed' | 'unavailable',
    message: string,
  ) {
    super(message)
    this.name = 'BackgroundCommandError'
  }
}

export type CommandResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: BackgroundCommandError }

export function parseStartCommand<Input>(input: Input): CommandResult<StartCommand> {
  if (!Value.Check(StartSchema, input) || Buffer.byteLength(input.command, 'utf8') > 65536) {
    return {
      ok: false,
      error: new BackgroundCommandError(
        'invalid-input',
        'Invalid background command. Supply a nonempty command up to 64 KiB, an optional name up to 200 characters, and a positive finite timeout in seconds.',
      ),
    }
  }
  return { ok: true, value: Value.Decode(StartSchema, input) }
}

export function parseCommandRequest<Input>(input: Input): CommandResult<CommandRequest> {
  if (!Value.Check(RequestSchema, input)) {
    return {
      ok: false,
      error: new BackgroundCommandError(
        'invalid-input',
        'Invalid background command action. Use start with command, list without arguments, or output/stop with id. Extra fields are not allowed.',
      ),
    }
  }
  return { ok: true, value: Value.Decode(RequestSchema, input) }
}

export interface CommandOutput {
  readonly text: string
  readonly truncated: boolean
}

const identity = { id, sessionId: id, name: Type.String(), command, startedAt: Type.Number() }
const terminal = { finishedAt: Type.Number(), exitCode: Type.Union([Type.Number(), Type.Null()]) }
const OutputSchema = Type.Object(
  { text: Type.String(), truncated: Type.Boolean() },
  { additionalProperties: false },
)
export const SnapshotSchema = Type.Union([
  Type.Object(
    { ...identity, status: Type.Union([Type.Literal('running'), Type.Literal('stopping')]) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...identity,
      status: Type.Literal('completed'),
      finishedAt: Type.Number(),
      exitCode: Type.Literal(0),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...identity, ...terminal, status: Type.Literal('error'), errorMessage: Type.String() },
    { additionalProperties: false },
  ),
  Type.Object(
    { ...identity, ...terminal, status: Type.Literal('stopped') },
    { additionalProperties: false },
  ),
])
export type CommandSnapshot = Static<typeof SnapshotSchema>

export const CompletionSchema = Type.Object(
  {
    id,
    sessionId: id,
    name: Type.String(),
    startedAt: Type.Number(),
    ...terminal,
    status: Type.Union([Type.Literal('completed'), Type.Literal('error'), Type.Literal('stopped')]),
    errorMessage: Type.Optional(Type.String()),
    output: OutputSchema,
  },
  { additionalProperties: false },
)

export const ToolOutputSchema = Type.Union([
  Type.Object(
    { action: Type.Literal('start'), snapshot: SnapshotSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('list'), commands: Type.Array(SnapshotSchema) },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('output'), snapshot: SnapshotSchema, output: OutputSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    { action: Type.Literal('stop'), snapshot: SnapshotSchema },
    { additionalProperties: false },
  ),
])
export type ToolOutput = Static<typeof ToolOutputSchema>

export type CommandCompletion = {
  readonly snapshot: Exclude<CommandSnapshot, { readonly status: 'running' | 'stopping' }>
  readonly output: CommandOutput
}

export function isTerminal(snapshot: CommandSnapshot): snapshot is CommandCompletion['snapshot'] {
  return (
    snapshot.status === 'completed' || snapshot.status === 'error' || snapshot.status === 'stopped'
  )
}
