import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join, relative, resolve } from 'node:path'

import { defineTool } from '@earendil-works/pi-coding-agent'
import { captureWorkspaceSnapshot } from '@nothingrotf/subagent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

export const GATE_TOOL = 'pstack_gate'
const DEFAULT_TIMEOUT_SECONDS = 30 * 60
const RETAINED_RECORDS = 256
const RETAINED_LOGS = 512
const TAIL_BYTES = 8 * 1024
const PASS_TAIL_LINES = 12
const FAILURE_TAIL_LINES = 80

export const GateParametersSchema = Type.Object(
  {
    command: Type.String({
      minLength: 1,
      maxLength: 4096,
      description:
        'Deterministic check to run from the session directory, such as a full test suite, type check, lint, or build.',
    }),
    fresh: Type.Optional(
      Type.Boolean({ description: 'Run the command even when this tree already has a pass.' }),
    ),
  },
  { additionalProperties: false },
)

const TreeSchema = Type.Object(
  { path: Type.String(), tree: Type.String({ pattern: '^[a-f0-9]{40,64}$' }) },
  { additionalProperties: false },
)

export const GateRecordSchema = Type.Object(
  {
    version: Type.Literal(1),
    key: Type.String({ pattern: '^[a-f0-9]{64}$' }),
    command: Type.String({ minLength: 1 }),
    cwd: Type.String({ minLength: 1 }),
    root: Type.String({ minLength: 1 }),
    trees: Type.Array(TreeSchema, { minItems: 1 }),
    exitCode: Type.Literal(0),
    durationMs: Type.Number({ minimum: 0 }),
    finishedAt: Type.Number({ minimum: 0 }),
    log: Type.String({ minLength: 1 }),
    logSha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  },
  { additionalProperties: false },
)

export type GateRecord = Static<typeof GateRecordSchema>
type GateTree = Static<typeof TreeSchema>

export interface GateIdentity {
  cwd: string
  key: string
  root: string
  store: string
  trees: GateTree[]
}

export interface GateOutcome {
  cached: boolean
  durationMs: number
  exitCode: number | undefined
  finishedAt: number
  identity: GateIdentity
  log: string
  logSha256: string
  reusable: boolean
  status: 'passed' | 'failed' | 'timed-out'
  tail: string
}

export interface GateRequest {
  command: string
  cwd: string
  fresh?: boolean
  signal?: AbortSignal | undefined
}

function positiveNumber(name: string): number | undefined {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function gateTimeoutMs(): number {
  return Math.round(
    (positiveNumber('PSTACK_GATE_TIMEOUT_SECONDS') ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
  )
}

export function gateConcurrency(): number {
  const configured = positiveNumber('PSTACK_GATE_CONCURRENCY')
  if (configured !== undefined) return Math.max(1, Math.floor(configured))
  return Math.max(1, Math.floor(availableParallelism() / 4))
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function git(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolveOutput(Buffer.concat(stdout).toString('utf8').trim())
      else reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `git exited ${code}`))
    })
  })
}

export async function gateIdentity(cwd: string, command: string): Promise<GateIdentity> {
  let root: string
  let common: string
  try {
    root = await realpath(await git(cwd, ['rev-parse', '--show-toplevel']))
    common = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  } catch {
    throw new Error(`${GATE_TOOL} needs a Git worktree, but ${cwd} is not inside one.`)
  }
  const snapshot = await captureWorkspaceSnapshot(root)
  if (snapshot === undefined) throw new Error(`${GATE_TOOL} could not capture the tree of ${root}.`)
  const trees = snapshot.repositories.map((repository) => ({
    path: repository.relativePath || '.',
    tree: repository.tree,
  }))
  const relativeCwd = relative(root, await realpath(cwd)) || '.'
  const key = sha256(JSON.stringify({ version: 1, command, cwd: relativeCwd, root, trees }))
  return {
    cwd: relativeCwd,
    key,
    root,
    store: join(resolve(root, common), 'pstack', 'gates'),
    trees,
  }
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function readPass(identity: GateIdentity): Promise<GateRecord | undefined> {
  let value: unknown
  try {
    value = JSON.parse(await readFile(join(identity.store, `${identity.key}.json`), 'utf8'))
  } catch {
    return undefined
  }
  if (!Value.Check(GateRecordSchema, value) || value.key !== identity.key) return undefined
  try {
    return (await fileSha256(value.log)) === value.logSha256 ? value : undefined
  } catch {
    return undefined
  }
}

async function tail(path: string, lines: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const text = buffer.toString('utf8').replace(/\r/g, '')
    return text.trimEnd().split('\n').slice(-lines).join('\n')
  } finally {
    await handle.close()
  }
}

let running = 0
const waiting: Array<() => void> = []

function acquireSlot(signal: AbortSignal | undefined): Promise<() => void> {
  const release = () => {
    const next = waiting.shift()
    if (next === undefined) running -= 1
    else next()
  }
  if (signal?.aborted === true) {
    return Promise.reject(new Error(`${GATE_TOOL} was aborted.`))
  }
  if (running < gateConcurrency()) {
    running += 1
    return Promise.resolve(release)
  }
  return new Promise((resolveSlot, reject) => {
    const grant = () => {
      signal?.removeEventListener('abort', cancel)
      resolveSlot(release)
    }
    const cancel = () => {
      const index = waiting.indexOf(grant)
      if (index >= 0) waiting.splice(index, 1)
      reject(new Error(`${GATE_TOOL} was aborted.`))
    }
    signal?.addEventListener('abort', cancel, { once: true })
    waiting.push(grant)
  })
}

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {}
}

interface Execution {
  durationMs: number
  exitCode: number | undefined
  status: 'completed' | 'timed-out' | 'aborted'
}

async function execute(
  command: string,
  cwd: string,
  log: string,
  signal: AbortSignal | undefined,
): Promise<Execution> {
  const output = await open(log, 'w')
  const started = Date.now()
  try {
    return await new Promise<Execution>((resolveExecution, reject) => {
      const child = spawn('bash', ['-c', command], {
        cwd,
        detached: true,
        env: { ...process.env, PSTACK_GATE: '1' },
        stdio: ['ignore', output.fd, output.fd],
      })
      let status: Execution['status'] = 'completed'
      const stop = (reason: Execution['status']) => {
        status = reason
        killGroup(child.pid)
      }
      const timer = setTimeout(() => stop('timed-out'), gateTimeoutMs())
      const abort = () => stop('aborted')
      if (signal?.aborted === true) abort()
      else signal?.addEventListener('abort', abort, { once: true })
      child.on('error', (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        reject(error)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        resolveExecution({
          durationMs: Date.now() - started,
          exitCode: code ?? undefined,
          status,
        })
      })
    })
  } finally {
    await output.close()
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, content)
  await rename(temporary, path)
}

async function prune(store: string): Promise<void> {
  const entries = await readdir(store)
  const byAge = async (suffix: string) => {
    const files = entries.filter((name) => name.endsWith(suffix))
    const stats = await Promise.all(
      files.map(async (name) => ({ name, time: (await stat(join(store, name))).mtimeMs })),
    )
    return stats.sort((left, right) => right.time - left.time).map((entry) => entry.name)
  }
  const stale = [
    ...(await byAge('.json')).slice(RETAINED_RECORDS),
    ...(await byAge('.log')).slice(RETAINED_LOGS),
  ]
  await Promise.all(stale.map((name) => rm(join(store, name), { force: true })))
}

async function runFresh(
  request: GateRequest,
  identity: GateIdentity,
  signal: AbortSignal,
): Promise<GateOutcome> {
  const release = await acquireSlot(signal)
  try {
    await mkdir(identity.store, { recursive: true })
    const log = join(identity.store, `${identity.key}.${Date.now()}.log`)
    const execution = await execute(request.command, request.cwd, log, signal)
    if (execution.status === 'aborted') throw new Error(`${GATE_TOOL} was aborted.`)
    const finishedAt = Date.now()
    const logSha256 = await fileSha256(log)
    const after = await gateIdentity(request.cwd, request.command)
    const reusable = after.key === identity.key
    const passed = execution.status === 'completed' && execution.exitCode === 0
    let status: GateOutcome['status'] = 'timed-out'
    if (execution.status === 'completed') status = passed ? 'passed' : 'failed'
    if (passed && reusable) {
      const record: GateRecord = {
        version: 1,
        key: identity.key,
        command: request.command,
        cwd: identity.cwd,
        root: identity.root,
        trees: identity.trees,
        exitCode: 0,
        durationMs: execution.durationMs,
        finishedAt,
        log,
        logSha256,
      }
      await writeAtomic(join(identity.store, `${identity.key}.json`), `${JSON.stringify(record)}\n`)
    }
    await prune(identity.store)
    return {
      cached: false,
      durationMs: execution.durationMs,
      exitCode: execution.exitCode,
      finishedAt,
      identity,
      log,
      logSha256,
      reusable: passed && reusable,
      status,
      tail: await tail(log, passed ? PASS_TAIL_LINES : FAILURE_TAIL_LINES),
    }
  } finally {
    release()
  }
}

interface SharedRun {
  controller: AbortController
  participants: number
  promise: Promise<GateOutcome>
}

const inflight = new Map<string, SharedRun>()

function participate(shared: SharedRun, signal: AbortSignal | undefined): Promise<GateOutcome> {
  shared.participants += 1
  return new Promise((resolve, reject) => {
    let joined = true
    const leave = () => {
      if (!joined) return
      joined = false
      signal?.removeEventListener('abort', abort)
      shared.participants -= 1
    }
    const abort = () => {
      leave()
      if (shared.participants === 0) shared.controller.abort()
      reject(new Error(`${GATE_TOOL} was aborted.`))
    }
    if (signal?.aborted === true) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    shared.promise.then(
      (outcome) => {
        leave()
        resolve(outcome)
      },
      (error) => {
        leave()
        reject(error)
      },
    )
  })
}

export async function runGate(request: GateRequest): Promise<GateOutcome> {
  request.signal?.throwIfAborted()
  const identity = await gateIdentity(request.cwd, request.command)
  if (request.fresh !== true) {
    const pass = await readPass(identity)
    if (pass !== undefined) {
      return {
        cached: true,
        durationMs: pass.durationMs,
        exitCode: 0,
        finishedAt: pass.finishedAt,
        identity,
        log: pass.log,
        logSha256: pass.logSha256,
        reusable: true,
        status: 'passed',
        tail: await tail(pass.log, PASS_TAIL_LINES),
      }
    }
  }
  const existing = request.fresh === true ? undefined : inflight.get(identity.key)
  if (existing !== undefined) return participate(existing, request.signal)
  const controller = new AbortController()
  const shared: SharedRun = {
    controller,
    participants: 0,
    promise: runFresh(request, identity, controller.signal),
  }
  inflight.set(identity.key, shared)
  const settle = () => {
    if (inflight.get(identity.key) === shared) inflight.delete(identity.key)
  }
  shared.promise.then(settle, settle)
  return participate(shared, request.signal)
}

function seconds(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)} s`
}

export function formatGateOutcome(command: string, outcome: GateOutcome): string {
  const trees = outcome.identity.trees
    .map((entry) => `${entry.path === '.' ? 'root' : entry.path} ${entry.tree}`)
    .join(', ')
  const lines: string[] = []
  if (outcome.status === 'passed') {
    lines.push(`Gate passed: ${command}`)
    if (outcome.cached) {
      lines.push(
        `Reused a pass recorded at ${new Date(outcome.finishedAt).toISOString()} for this exact tree and command. No command ran. The recorded run took ${seconds(outcome.durationMs)}.`,
      )
    } else if (outcome.reusable) {
      lines.push(
        `Exit code 0 after ${seconds(outcome.durationMs)}. A later call for this tree reuses this pass.`,
      )
    } else {
      lines.push(
        `Exit code 0 after ${seconds(outcome.durationMs)}. The command changed the tree, so this pass is not reusable. Use bash for commands that edit files.`,
      )
    }
  } else if (outcome.status === 'failed') {
    lines.push(`Gate failed: ${command}`)
    lines.push(`Exit code ${outcome.exitCode ?? 'unknown'} after ${seconds(outcome.durationMs)}.`)
  } else {
    lines.push(`Gate timed out: ${command}`)
    lines.push(
      `The command was stopped after ${seconds(outcome.durationMs)}. Narrow the command, or raise PSTACK_GATE_TIMEOUT_SECONDS.`,
    )
  }
  lines.push(`Tree: ${trees}. Working directory: ${outcome.identity.cwd}.`)
  lines.push(`Log: ${outcome.log} (sha256 ${outcome.logSha256}).`)
  if (outcome.tail.length > 0) lines.push('Last lines:', outcome.tail)
  return lines.join('\n')
}

export function createGateTools() {
  return [
    defineTool({
      name: GATE_TOOL,
      label: 'Gate',
      description:
        'Run a deterministic repository check, such as a full test suite, type check, lint, or build, against the current tree. A pass is recorded for the exact tree and command, and a later call for an unchanged tree returns it without running the command. Failures are never reused.',
      promptSnippet: 'Run full suites and repository gates once per tree',
      promptGuidelines: [
        'Use pstack_gate, not bash, for full test suites, type checks, lint, builds, and repository gates. The tool owns the timeout, so run each gate once and wait for its result.',
        'Use bash for focused tests, reproductions, and commands that edit files. A command that changes the tree is not a gate.',
        'Apply formatters and fixes first, then run fast gates such as format, lint, and type checks before slow suites. Any edit after a pass changes the tree and requires a new run.',
        'A pstack_gate receipt is command evidence. A reused pass proves that this exact tree passed this command.',
      ],
      parameters: GateParametersSchema,
      async execute(_toolCallId, params, signal, _onUpdate, ctx) {
        const outcome = await runGate({
          command: params.command,
          cwd: ctx.cwd,
          fresh: params.fresh === true,
          signal,
        })
        const text = formatGateOutcome(params.command, outcome)
        if (outcome.status !== 'passed') throw new Error(text)
        return {
          content: [{ type: 'text', text }],
          details: {
            cached: outcome.cached,
            durationMs: outcome.durationMs,
            key: outcome.identity.key,
            log: outcome.log,
            logSha256: outcome.logSha256,
            reusable: outcome.reusable,
            trees: outcome.identity.trees,
          },
        }
      },
    }),
  ]
}
