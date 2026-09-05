import { spawn, type ChildProcess } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

import type { GoalProgressEvent } from './activity.ts'
import type { GoalCheckKind, GoalCheckResult } from './state.ts'

const PackageScriptsSchema = Type.Object(
  {
    check: Type.Optional(Type.String()),
    typecheck: Type.Optional(Type.String()),
    test: Type.Optional(Type.String()),
    lint: Type.Optional(Type.String()),
    probe: Type.Optional(Type.String()),
    smoke: Type.Optional(Type.String()),
    'test:e2e': Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const PackageManifestSchema = Type.Object(
  {
    packageManager: Type.Optional(Type.String()),
    scripts: Type.Optional(PackageScriptsSchema),
  },
  { additionalProperties: true },
)

interface ProjectManifest {
  directory: string
  packageManager: string
  scripts: ReturnType<typeof Value.Decode<typeof PackageScriptsSchema>>
}

interface CheckCommand {
  kind: GoalCheckKind
  label: string
  program: string
  args: readonly string[]
  timeoutMs: number
}

interface ProcessOutcome {
  status: 'passed' | 'failed' | 'unavailable'
  durationMs: number
  output?: string
}

export interface GoalCheckRequest {
  onProgress?: (event: GoalProgressEvent) => void
  cwd: string
  runtimeProbe: boolean
  signal: AbortSignal
  trusted: boolean
}

export interface GoalCheckRunner {
  run(request: GoalCheckRequest): Promise<GoalCheckResult[]>
}

export class GoalCheckAbortedError extends Error {}

function packageManagerProgram(name: string): string {
  return process.platform === 'win32' && name !== 'bun' ? `${name}.cmd` : name
}

function recognizedPackageManager(value: string | undefined): string | undefined {
  const name = value?.split('@')[0]?.trim()
  if (name === 'bun' || name === 'pnpm' || name === 'yarn' || name === 'npm') return name
  return undefined
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function detectPackageManager(
  directory: string,
  declared: string | undefined,
): Promise<string> {
  const recognized = recognizedPackageManager(declared)
  if (recognized !== undefined) return recognized
  const root = parse(directory).root
  let current = directory
  while (true) {
    if ((await exists(join(current, 'bun.lock'))) || (await exists(join(current, 'bun.lockb')))) {
      return 'bun'
    }
    if (await exists(join(current, 'pnpm-lock.yaml'))) return 'pnpm'
    if (await exists(join(current, 'yarn.lock'))) return 'yarn'
    if (await exists(join(current, 'package-lock.json'))) return 'npm'
    if (current === root) return 'npm'
    current = dirname(current)
  }
}

async function findManifest(cwd: string): Promise<ProjectManifest | undefined> {
  let directory = cwd
  const root = parse(directory).root
  while (true) {
    try {
      const decoded = Value.Decode(
        PackageManifestSchema,
        JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
      )
      return {
        directory,
        packageManager: await detectPackageManager(directory, decoded.packageManager),
        scripts: decoded.scripts ?? {},
      }
    } catch (error) {
      if (await exists(join(directory, 'package.json'))) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new Error(`Cannot read ${join(directory, 'package.json')}: ${reason}`)
      }
    }
    if (directory === root) return undefined
    directory = dirname(directory)
  }
}

function unavailable(kind: GoalCheckKind, label: string, output: string): GoalCheckResult {
  return { kind, label, status: 'unavailable', durationMs: 0, output }
}

function scriptCommand(
  manifest: ProjectManifest,
  kind: GoalCheckKind,
  label: string,
  script: string,
  timeoutMs: number,
): CheckCommand {
  return {
    kind,
    label,
    program: packageManagerProgram(manifest.packageManager),
    args: ['run', script],
    timeoutMs,
  }
}

function workspaceScopeCommand(): CheckCommand {
  return {
    kind: 'scope',
    label: 'Review scope',
    program: 'git',
    args: ['status', '--short', '--untracked-files=all'],
    timeoutMs: 30_000,
  }
}

function commandsFor(
  manifest: ProjectManifest,
  runtimeProbe: boolean,
): Array<CheckCommand | GoalCheckResult> {
  const typecheckScript =
    manifest.scripts.typecheck !== undefined
      ? 'typecheck'
      : manifest.scripts.check !== undefined
        ? 'check'
        : manifest.scripts.lint !== undefined
          ? 'lint'
          : undefined
  const commands: Array<CheckCommand | GoalCheckResult> = []
  if (typecheckScript === undefined) {
    commands.push(
      unavailable('typecheck', 'Typecheck', 'No check, typecheck, or lint script exists.'),
    )
  } else {
    commands.push(scriptCommand(manifest, 'typecheck', 'Typecheck', typecheckScript, 120_000))
  }
  if (manifest.scripts.test === undefined) {
    commands.push(unavailable('test', 'Tests', 'No test script exists.'))
  } else {
    commands.push(scriptCommand(manifest, 'test', 'Tests', 'test', 240_000))
  }
  if (runtimeProbe) {
    const runtimeScript =
      manifest.scripts.probe !== undefined
        ? 'probe'
        : manifest.scripts.smoke !== undefined
          ? 'smoke'
          : manifest.scripts['test:e2e'] !== undefined
            ? 'test:e2e'
            : undefined
    if (runtimeScript === undefined) {
      commands.push(
        unavailable('runtime', 'Runtime probe', 'No probe, smoke, or test:e2e script exists.'),
      )
    } else {
      commands.push(scriptCommand(manifest, 'runtime', 'Runtime probe', runtimeScript, 120_000))
    }
  }
  return commands
}

function commandText(command: CheckCommand): string {
  return [command.program, ...command.args].join(' ')
}

function appendTail(current: string, chunk: Buffer): string {
  return `${current}${chunk.toString('utf8')}`.slice(-32_000)
}

function processError(error: Error): string {
  return error.message
}

function terminateProcessTree(child: ChildProcess, signal: 'SIGTERM' | 'SIGKILL'): void {
  const pid = child.pid
  if (pid === undefined) return
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/t']
    if (signal === 'SIGKILL') args.push('/f')
    try {
      const killer = spawn('taskkill', args, { stdio: 'ignore' })
      killer.once('error', () => {
        try {
          child.kill(signal)
        } catch {}
      })
      killer.unref()
    } catch {
      try {
        child.kill(signal)
      } catch {}
    }
    return
  }
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {}
  }
}

function forceKillProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid
  if (process.platform !== 'win32' || pid === undefined) {
    terminateProcessTree(child, 'SIGKILL')
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' })
    killer.once('error', finish)
    killer.once('close', finish)
  })
}

function executeCommand(
  command: CheckCommand,
  cwd: string,
  signal: AbortSignal,
): Promise<ProcessOutcome> {
  if (signal.aborted) return Promise.reject(new GoalCheckAbortedError('Goal checks were aborted.'))
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    let output = ''
    let settled = false
    let termination: 'abort' | 'timeout' | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(command.program, command.args, {
      cwd,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const cleanup = () => {
      if (timeout !== undefined) clearTimeout(timeout)
      if (forceKillTimer !== undefined) clearTimeout(forceKillTimer)
      signal.removeEventListener('abort', abort)
    }
    const finish = (outcome: ProcessOutcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }
    const failAborted = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new GoalCheckAbortedError('Goal checks were aborted.'))
    }
    const terminate = (reason: 'abort' | 'timeout') => {
      if (settled || termination !== undefined) return
      termination = reason
      if (timeout !== undefined) clearTimeout(timeout)
      terminateProcessTree(child, 'SIGTERM')
      forceKillTimer = setTimeout(() => {
        const completeTermination = () => {
          if (reason === 'abort') {
            failAborted()
            return
          }
          finish({
            status: 'failed',
            durationMs: Math.max(0, Date.now() - startedAt),
            output: `Timed out after ${command.timeoutMs} ms.\n${output}`.slice(-1_600),
          })
        }
        forceKillProcessTree(child).then(completeTermination, completeTermination)
      }, 1_000)
    }
    const abort = () => terminate('abort')
    timeout = setTimeout(() => terminate('timeout'), command.timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      output = appendTail(output, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      output = appendTail(output, chunk)
    })
    child.once('error', (error) => {
      if (termination !== undefined) return
      finish({
        status: 'unavailable',
        durationMs: Math.max(0, Date.now() - startedAt),
        output: processError(error).slice(-1_600),
      })
    })
    child.once('close', (code) => {
      if (settled || termination !== undefined) return
      const durationMs = Math.max(0, Date.now() - startedAt)
      if (code === 0) {
        const content = output.trim()
        if (content.length > 0) {
          finish({ status: 'passed', durationMs, output: content.slice(-1_600) })
        } else {
          finish({ status: 'passed', durationMs })
        }
        return
      }
      finish({
        status: 'failed',
        durationMs,
        output: (output.trim() || `Process exited with code ${String(code)}.`).slice(-1_600),
      })
    })
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

async function runCommand(
  command: CheckCommand,
  cwd: string,
  signal: AbortSignal,
  onProgress: GoalCheckRequest['onProgress'],
): Promise<GoalCheckResult> {
  if (signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
  emitProgress(onProgress, {
    type: 'check-start',
    kind: command.kind,
    label: command.label,
    command: commandText(command),
  })
  let outcome: ProcessOutcome
  try {
    outcome = await executeCommand(command, cwd, signal)
  } catch (error) {
    emitProgress(onProgress, {
      type: 'check-end',
      check: {
        kind: command.kind,
        label: command.label,
        command: commandText(command),
        status: 'unavailable',
        durationMs: 0,
      },
    })
    throw error
  }
  const result: GoalCheckResult = {
    kind: command.kind,
    label: command.label,
    status: outcome.status,
    durationMs: outcome.durationMs,
    command: commandText(command),
  }
  if (outcome.output !== undefined && outcome.output.length > 0) result.output = outcome.output
  return result
}

function unavailableProjectChecks(reason: string, runtimeProbe: boolean): GoalCheckResult[] {
  const results = [
    unavailable('typecheck', 'Typecheck', reason),
    unavailable('test', 'Tests', reason),
  ]
  if (runtimeProbe) results.push(unavailable('runtime', 'Runtime probe', reason))
  return results
}

function emitProgress(onProgress: GoalCheckRequest['onProgress'], event: GoalProgressEvent): void {
  try {
    Promise.resolve(onProgress?.(event)).catch(() => {})
  } catch {}
}

export class ProjectGoalCheckRunner implements GoalCheckRunner {
  async run(request: GoalCheckRequest): Promise<GoalCheckResult[]> {
    const results: GoalCheckResult[] = []
    const append = (...checks: GoalCheckResult[]) => {
      for (const check of checks) {
        results.push(check)
        const progressCheck = { ...check }
        delete progressCheck.output
        emitProgress(request.onProgress, { type: 'check-end', check: progressCheck })
      }
      return results
    }
    if (request.signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
    if (!request.trusted) {
      return append(
        unavailable('scope', 'Review scope', 'Project trust is disabled.'),
        ...unavailableProjectChecks('Project trust is disabled.', request.runtimeProbe),
      )
    }
    const scope = await runCommand(
      workspaceScopeCommand(),
      request.cwd,
      request.signal,
      request.onProgress,
    )
    const reviewScope =
      scope.status === 'passed'
        ? { ...scope, output: scope.output ?? 'The Git working tree is clean.' }
        : unavailable('scope', 'Review scope', scope.output ?? 'Git scope is unavailable.')
    append(reviewScope)
    if (request.signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
    let manifest: ProjectManifest | undefined
    try {
      manifest = await findManifest(request.cwd)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (request.signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
      return append(
        ...unavailableProjectChecks(
          'Fix the project manifest before verification.',
          request.runtimeProbe,
        ).map((result): GoalCheckResult =>
          result.kind === 'typecheck'
            ? { ...result, status: 'failed', output: reason.slice(-1_600) }
            : result,
        ),
      )
    }
    if (request.signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
    if (manifest === undefined) {
      return append(
        ...unavailableProjectChecks(
          'No package.json exists in the directory tree.',
          request.runtimeProbe,
        ),
      )
    }
    for (const item of commandsFor(manifest, request.runtimeProbe)) {
      if (request.signal.aborted) throw new GoalCheckAbortedError('Goal checks were aborted.')
      if ('program' in item) {
        append(await runCommand(item, manifest.directory, request.signal, request.onProgress))
      } else {
        append(item)
      }
    }
    return results
  }
}
