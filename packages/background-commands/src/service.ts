import { randomUUID } from 'node:crypto'

import { createLocalBashOperations } from '@earendil-works/pi-coding-agent'

import { CommandLog, outputTail } from './output.ts'
import {
  BackgroundCommandError,
  isTerminal,
  parseStartCommand,
  type CommandCompletion,
  type CommandOutput,
  type CommandResult,
  type CommandSnapshot,
  type StartCommand,
} from './schema.ts'
import { commandEnvironment, type CommandContext } from './shell.ts'

export interface CommandHandle {
  readonly id: string
  snapshot(): CommandSnapshot
  output(): CommandOutput | undefined
  stop(): CommandSnapshot
}

export interface CompletionReceiver {
  deliver(completion: CommandCompletion): void
  canDeliver?(): boolean
}

export interface CommandBinding {
  readonly sessionId: string
  getContext(): CommandContext
}

export interface BackgroundCommands {
  readonly sessionId: string
  start(input: StartCommand): CommandResult<CommandHandle>
  list(): CommandSnapshot[]
  find(id: string): CommandHandle | undefined
  acknowledge(id: string): void
  onChange(listener: () => void): () => void
  bindCompletion(receiver: CompletionReceiver): () => void
  flushCompletions(): void
  dispose(): Promise<void>
}

interface CommandRecord {
  readonly handle: CommandHandle
  readonly log: CommandLog
  readonly settled: Promise<void>
  pending: boolean
}

class SessionCommands implements BackgroundCommands {
  readonly sessionId: string
  private readonly records = new Map<string, CommandRecord>()
  private readonly completed: string[] = []
  private readonly listeners = new Set<() => void>()
  private receiver: CompletionReceiver | undefined
  private closed = false
  private flushing = false
  private disposal: Promise<void> | undefined

  constructor(private readonly binding: CommandBinding) {
    this.sessionId = binding.sessionId
  }

  start(input: StartCommand): CommandResult<CommandHandle> {
    if (this.closed)
      return {
        ok: false,
        error: new BackgroundCommandError(
          'closed',
          'Background commands are closed for this session.',
        ),
      }
    const parsed = parseStartCommand(input)
    if (!parsed.ok) return parsed
    if (this.list().filter((snapshot) => !isTerminal(snapshot)).length >= 8) {
      return {
        ok: false,
        error: new BackgroundCommandError(
          'capacity',
          'At most 8 background commands can run in this session. Stop a command before starting another.',
        ),
      }
    }
    const request = parsed.value
    const id = randomUUID()
    const controller = new AbortController()
    const log = new CommandLog()
    const identity = {
      id,
      sessionId: this.sessionId,
      name: request.name ?? 'Background command',
      command: request.command,
      startedAt: Date.now(),
    }
    let snapshot: CommandSnapshot = { ...identity, status: 'running' }
    const handle: CommandHandle = {
      id,
      snapshot: () => ({ ...snapshot }),
      output: () => log.read(),
      stop: () => {
        if (snapshot.status === 'running') {
          snapshot = { ...identity, status: 'stopping' }
          controller.abort()
          this.changed()
        }
        return { ...snapshot }
      },
    }
    const settled = Promise.withResolvers<void>()
    const record: CommandRecord = { handle, log, pending: false, settled: settled.promise }
    this.records.set(id, record)
    this.changed()
    const execute = async () => {
      try {
        controller.signal.throwIfAborted()
        const context = this.binding.getContext()
        controller.signal.throwIfAborted()
        const operations =
          context.shellPath === undefined
            ? createLocalBashOperations()
            : createLocalBashOperations({ shellPath: context.shellPath })
        const command =
          context.commandPrefix === undefined
            ? request.command
            : `${context.commandPrefix}\n${request.command}`
        const execution: Parameters<typeof operations.exec>[2] = {
          onData: (bytes) => log.append(bytes),
          env: commandEnvironment(this.sessionId, context),
          signal: controller.signal,
        }
        if (request.timeout !== undefined) execution.timeout = request.timeout
        const result = await operations.exec(command, context.cwd, execution)
        const finishedAt = Date.now()
        if (controller.signal.aborted)
          snapshot = { ...identity, status: 'stopped', finishedAt, exitCode: result.exitCode }
        else if (result.exitCode === 0)
          snapshot = { ...identity, status: 'completed', finishedAt, exitCode: 0 }
        else
          snapshot = {
            ...identity,
            status: 'error',
            finishedAt,
            exitCode: result.exitCode,
            errorMessage:
              result.exitCode === null
                ? 'The command ended without an exit code.'
                : `The command exited with code ${result.exitCode}.`,
          }
      } catch (error) {
        const finishedAt = Date.now()
        snapshot = controller.signal.aborted
          ? { ...identity, status: 'stopped', finishedAt, exitCode: null }
          : {
              ...identity,
              status: 'error',
              finishedAt,
              exitCode: null,
              errorMessage: outputTail(
                error instanceof Error &&
                  request.timeout !== undefined &&
                  error.message === `timeout:${request.timeout}`
                  ? `Timed out after ${request.timeout} seconds.`
                  : error instanceof Error
                    ? error.message
                    : String(error),
                4096,
                40,
              ).text,
            }
      }
      log.finish()
      record.pending = !this.closed
      this.completed.push(id)
      while (this.completed.length > 20) {
        const oldest = this.completed.shift()
        if (oldest === undefined) break
        this.records.get(oldest)?.log.release()
        this.records.delete(oldest)
      }
      this.changed()
      this.flushCompletions()
      settled.resolve()
    }
    execute().catch(() => settled.resolve())
    return { ok: true, value: handle }
  }

  list(): CommandSnapshot[] {
    return [...this.records.values()].map((record) => record.handle.snapshot())
  }

  find(id: string): CommandHandle | undefined {
    return this.records.get(id)?.handle
  }

  acknowledge(id: string): void {
    const record = this.records.get(id)
    if (record !== undefined && isTerminal(record.handle.snapshot())) record.pending = false
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  bindCompletion(receiver: CompletionReceiver): () => void {
    const binding: CompletionReceiver = {
      deliver: (completion) => receiver.deliver(completion),
      canDeliver: () => receiver.canDeliver?.() !== false,
    }
    if (!this.closed) this.receiver = binding
    this.flushCompletions()
    return () => {
      if (this.receiver === binding) this.receiver = undefined
    }
  }

  flushCompletions(): void {
    if (this.flushing || this.closed) return
    this.flushing = true
    try {
      for (const record of this.records.values()) {
        const receiver = this.receiver
        if (this.closed || receiver === undefined || !record.pending) continue
        try {
          if (receiver.canDeliver?.() === false) continue
          if (
            this.closed ||
            this.receiver !== receiver ||
            this.records.get(record.handle.id) !== record
          )
            continue
          const snapshot = record.handle.snapshot()
          const output = record.handle.output()
          if (!isTerminal(snapshot) || output === undefined) continue
          record.pending = false
          receiver.deliver({ snapshot, output })
        } catch {
          record.pending = true
        }
      }
    } finally {
      this.flushing = false
    }
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal
    this.closed = true
    this.receiver = undefined
    const records = [...this.records.values()]
    for (const record of records) record.handle.stop()
    this.disposal = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000)
      Promise.all(records.map((record) => record.settled))
        .then(() => {
          clearTimeout(timer)
          resolve()
        })
        .catch(() => {
          clearTimeout(timer)
          resolve()
        })
    })
    return this.disposal
  }

  private changed(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch {}
    }
  }
}

export function createBackgroundCommands(binding: CommandBinding): BackgroundCommands {
  return new SessionCommands(binding)
}
