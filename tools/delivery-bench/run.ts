import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { acceptanceTest, acceptanceTestName, fixtureFiles } from './fixture.ts'
import { formatReport, type RunResult, sessionRunMetrics } from './metrics.ts'
import { type Arm, arms, benchmarkPrompt } from './prompts.ts'

const usage = `Usage: bun tools/delivery-bench/run.ts [options]

Runs the managed delivery benchmark with the real pi CLI and the configured models.
Each run creates a fresh repository and costs real model usage.

Options:
  --arms <list>           Comma-separated arms: baseline, workspace (default: both)
  --runs <n>              Runs per arm, interleaved by arm (default: 1)
  --out <dir>             Output directory (default: a new directory under the system temp)
  --coordinator <model>   Coordinator model (default: openai-codex/gpt-6.1-sol:medium)
  --code-review <model>   Code review selector (default: anthropic/claude-opus-5:xhigh)
  --runtime <model>       Runtime verification selector (default: openai-codex/gpt-6.1-sol:medium)
  --setup-seconds <n>     Duration of the fixture database setup (default: 20)
  --timeout-minutes <n>   Timeout for one run (default: 30)
`

interface Options {
  arms: Arm[]
  codeReview: string
  coordinator: string
  out: string
  runs: number
  runtime: string
  setupSeconds: number
  timeoutMs: number
}

function write(text: string): void {
  process.stdout.write(text)
}

function nonNegative(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0)
    throw new Error(`${name} must be a number of 0 or more.`)
  return parsed
}

function positive(value: string | undefined, fallback: number, name: string): number {
  const parsed = nonNegative(value, fallback, name)
  if (parsed <= 0) throw new Error(`${name} must be greater than 0.`)
  return parsed
}

function parseArm(value: string): Arm {
  const arm = arms.find((candidate) => candidate === value)
  if (arm === undefined) throw new Error(`Unknown arm: ${value}. Use ${arms.join(' or ')}.`)
  return arm
}

function options(): Options | undefined {
  const { values } = parseArgs({
    options: {
      arms: { type: 'string' },
      'code-review': { type: 'string' },
      coordinator: { type: 'string' },
      help: { type: 'boolean' },
      out: { type: 'string' },
      runs: { type: 'string' },
      runtime: { type: 'string' },
      'setup-seconds': { type: 'string' },
      'timeout-minutes': { type: 'string' },
    },
  })
  if (values.help === true) {
    write(usage)
    return undefined
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
  return {
    arms: (values.arms ?? arms.join(',')).split(',').map((entry) => parseArm(entry.trim())),
    codeReview: values['code-review'] ?? 'anthropic/claude-opus-5:xhigh',
    coordinator: values.coordinator ?? 'openai-codex/gpt-6.1-sol:medium',
    out: resolve(values.out ?? join(tmpdir(), `delivery-bench-${stamp}`)),
    runs: Math.max(1, Math.floor(positive(values.runs, 1, '--runs'))),
    runtime: values.runtime ?? 'openai-codex/gpt-6.1-sol:medium',
    setupSeconds: nonNegative(values['setup-seconds'], 20, '--setup-seconds'),
    timeoutMs: Math.round(positive(values['timeout-minutes'], 30, '--timeout-minutes') * 60_000),
  }
}

interface Execution {
  code: number
  output: string
}

const TERMINATION_GRACE_MS = 10_000

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, signal)
  } catch {}
}

function execute(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  logPath?: string,
): Promise<Execution> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const log = logPath === undefined ? undefined : createWriteStream(logPath)
    const chunks: Buffer[] = []
    const collect = (chunk: Buffer) => {
      chunks.push(chunk)
      log?.write(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timers: NodeJS.Timeout[] = []
    const clearTimers = () => {
      for (const timer of timers) clearTimeout(timer)
    }
    timers.push(
      setTimeout(() => {
        signalGroup(child.pid, 'SIGTERM')
        timers.push(
          setTimeout(() => {
            signalGroup(child.pid, 'SIGKILL')
            timers.push(
              setTimeout(() => {
                child.stdout.destroy()
                child.stderr.destroy()
              }, TERMINATION_GRACE_MS),
            )
          }, TERMINATION_GRACE_MS),
        )
      }, timeoutMs),
    )
    child.on('error', (error) => {
      clearTimers()
      reject(error)
    })
    child.on('close', (code) => {
      clearTimers()
      log?.end()
      done({ code: code ?? 1, output: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

async function required(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await execute(command, args, cwd, env, 120_000)
  if (result.code !== 0) throw new Error(`${command} ${args.join(' ')} failed:\n${result.output}`)
}

async function createRepository(repo: string): Promise<void> {
  for (const [path, content] of fixtureFiles) {
    const target = join(repo, path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  await required('git', ['init', '-q', '-b', 'main'], repo)
  await required('git', ['add', '-A'], repo)
  await required(
    'git',
    ['-c', 'user.email=bench@example.com', '-c', 'user.name=Bench', 'commit', '-q', '-m', 'init'],
    repo,
  )
  await required('bun', ['run', 'setup'], repo, { ...process.env, BENCH_SETUP_SECONDS: '0' })
}

async function acceptance(tree: string | undefined): Promise<RunResult['acceptance']> {
  if (tree === undefined) return 'missing'
  const path = join(tree, acceptanceTestName)
  await writeFile(path, acceptanceTest)
  try {
    const result = await execute(
      'bun',
      ['test', `./${acceptanceTestName}`],
      tree,
      process.env,
      60_000,
    )
    return result.code === 0 ? 'pass' : 'fail'
  } finally {
    await rm(path, { force: true })
  }
}

async function lineCount(path: string): Promise<number> {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter((line) => line.trim().length > 0)
      .length
  } catch {
    return 0
  }
}

async function sessionFiles(directory: string) {
  const names = (await readdir(directory)).filter((name) => name.endsWith('.jsonl'))
  return Promise.all(
    names.map(async (name) => ({
      content: await readFile(join(directory, name), 'utf8'),
      path: join(directory, name),
    })),
  )
}

async function runOnce(config: Options, arm: Arm, run: number): Promise<RunResult> {
  const root = join(config.out, `${arm}-${run}`)
  const repo = join(root, 'repo')
  const sessions = join(root, 'sessions')
  const setupLog = join(root, 'setup-runs.log')
  await mkdir(sessions, { recursive: true })
  await createRepository(repo)
  const prompt = benchmarkPrompt(arm, { code: config.codeReview, runtime: config.runtime })
  await writeFile(join(root, 'prompt.md'), prompt)
  write(`${arm} run ${run}: ${root}\n`)
  const started = Date.now()
  const execution = await execute(
    'pi',
    ['-p', '--model', config.coordinator, '--session-dir', sessions, prompt],
    repo,
    {
      ...process.env,
      BENCH_LOG: setupLog,
      BENCH_SETUP_SECONDS: String(config.setupSeconds),
      PSTACK_WORKTREE_ROOT: join(root, 'worktrees'),
    },
    config.timeoutMs,
    join(root, 'pi.log'),
  )
  const wallMs = Date.now() - started
  const metrics = sessionRunMetrics(await sessionFiles(sessions))
  const result: RunResult = {
    ...metrics,
    acceptance: await acceptance(arm === 'workspace' ? metrics.worktree : repo),
    arm,
    exitCode: execution.code,
    run,
    setupRuns: await lineCount(setupLog),
    wallMs,
  }
  await writeFile(join(root, 'metrics.json'), `${JSON.stringify(result, null, 2)}\n`)
  write(
    `${arm} run ${run}: ${result.finalState ?? 'no checkpoint'}, acceptance ${result.acceptance}, ${(wallMs / 1000).toFixed(1)} s\n`,
  )
  return result
}

async function main(): Promise<void> {
  const config = options()
  if (config === undefined) return
  await mkdir(config.out, { recursive: true })
  write(`Writing results to ${config.out}\n`)
  const results: RunResult[] = []
  for (let run = 1; run <= config.runs; run += 1) {
    for (const arm of config.arms) results.push(await runOnce(config, arm, run))
  }
  const report = formatReport(results)
  await writeFile(join(config.out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
  await writeFile(join(config.out, 'report.md'), report)
  write(`\n${report}`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
