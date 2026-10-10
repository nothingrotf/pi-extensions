import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { acceptanceTest, acceptanceTestName, fixtureFiles } from './fixture.ts'
import { formatReport, type RunResult, sessionRunMetrics } from './metrics.ts'
import {
  type Arm,
  arms,
  benchmarkPrompt,
  pricingArms,
  replayArms,
  replayEnginePrompt,
  replayPrompt,
} from './prompts.ts'
import { ownerPolicy, replayTask, replayTasks, type ReplayTask } from './replays.ts'
import { mirrorAgentDirectory } from './revisions.ts'

const usage = `Usage: bun tools/delivery-bench/run.ts [options]

Runs the managed delivery benchmark with the real pi CLI and the configured models.
Each run creates a fresh repository and costs real model usage.

Options:
  --task <id>             pricing, the synthetic fixture (default), or a replay task: ${replayTasks.map((task) => task.id).join(', ')}
  --arms <list>           Pricing arms: baseline, workspace (default: both). Replay arms: workspace, engine (default: workspace)
  --owner <name=selector> Implementation owner variant, repeatable. Each variant rewrites the owner roles in a copy of the model policy
  --revision <name=rev>   pi-extensions revision variant, repeatable. Each variant runs pi with the packages of a worktree at rev
  --runs <n>              Runs per arm, interleaved by arm (default: 1)
  --out <dir>             Output directory (default: a new directory under the system temp)
  --coordinator <model>   Coordinator model (default: openai-codex/gpt-6.1-sol:medium)
  --code-review <model>   Code review selector (default: anthropic/claude-opus-5:xhigh)
  --runtime <model>       Runtime verification selector (default: openai-codex/gpt-6.1-sol:medium)
  --setup-seconds <n>     Duration of the fixture database setup (default: 20)
  --timeout-minutes <n>   Timeout for one run (default: 30)
`

interface Owner {
  label: string
  selector: string | undefined
}

interface Revision {
  agentDir: string | undefined
  label: string
  revision: string | undefined
  worktree: string | undefined
}

interface Options {
  arms: Arm[]
  codeReview: string
  coordinator: string
  out: string
  owners: Owner[]
  revisions: Revision[]
  runs: number
  runtime: string
  setupSeconds: number
  task: ReplayTask | undefined
  timeoutMs: number
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

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

function parseArms(value: string | undefined, task: ReplayTask | undefined): Arm[] {
  const allowed = task === undefined ? pricingArms : replayArms
  if (value === undefined) return task === undefined ? [...pricingArms] : ['workspace']
  return value.split(',').map((entry) => {
    const arm = parseArm(entry.trim())
    if (!allowed.includes(arm))
      throw new Error(
        `The ${task === undefined ? 'pricing' : 'replay'} task supports arms ${allowed.join(', ')}.`,
      )
    return arm
  })
}

function parseOwner(value: string): Owner {
  const separator = value.indexOf('=')
  const selector = (separator < 0 ? value : value.slice(separator + 1)).trim()
  const label =
    separator < 0 ? selector.replaceAll(/[^A-Za-z0-9.-]+/g, '-') : value.slice(0, separator)
  if (selector.length === 0 || label.trim().length === 0)
    throw new Error(`--owner needs name=selector or a selector: ${value}`)
  return { label: label.trim(), selector }
}

function parseRevision(value: string): Revision {
  const separator = value.indexOf('=')
  const label = separator < 0 ? value : value.slice(0, separator).trim()
  const revision = separator < 0 ? value : value.slice(separator + 1).trim()
  if (label.length === 0 || revision.length === 0 || !/^[A-Za-z0-9._-]+$/.test(label))
    throw new Error(
      `--revision needs name=rev with a name of letters, digits, dots, or dashes: ${value}`,
    )
  return { agentDir: undefined, label, revision, worktree: undefined }
}

function parseTask(value: string | undefined): ReplayTask | undefined {
  if (value === undefined || value === 'pricing') return undefined
  const task = replayTask(value)
  if (task === undefined)
    throw new Error(
      `Unknown task: ${value}. Use pricing or ${replayTasks.map((entry) => entry.id).join(', ')}.`,
    )
  return task
}

function options(): Options | undefined {
  const { values } = parseArgs({
    options: {
      arms: { type: 'string' },
      owner: { type: 'string', multiple: true },
      revision: { type: 'string', multiple: true },
      task: { type: 'string' },
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
  const task = parseTask(values.task)
  return {
    arms: parseArms(values.arms, task),
    codeReview: values['code-review'] ?? 'anthropic/claude-opus-5:xhigh',
    coordinator: values.coordinator ?? 'openai-codex/gpt-6.1-sol:medium',
    out: resolve(values.out ?? join(tmpdir(), `delivery-bench-${stamp}`)),
    owners:
      values.owner === undefined || values.owner.length === 0
        ? [{ label: 'policy', selector: undefined }]
        : values.owner.map(parseOwner),
    revisions:
      values.revision === undefined || values.revision.length === 0
        ? [{ agentDir: undefined, label: 'current', revision: undefined, worktree: undefined }]
        : values.revision.map(parseRevision),
    runs: Math.max(1, Math.floor(positive(values.runs, 1, '--runs'))),
    runtime: values.runtime ?? 'openai-codex/gpt-6.1-sol:medium',
    setupSeconds: nonNegative(values['setup-seconds'], 20, '--setup-seconds'),
    task,
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
    let terminating = false
    timers.push(
      setTimeout(() => {
        terminating = true
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
      if (terminating) signalGroup(child.pid, 'SIGKILL')
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
  timeoutMs = 120_000,
): Promise<void> {
  const result = await execute(command, args, cwd, env, timeoutMs)
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

async function createReplayRepository(repo: string, task: ReplayTask): Promise<void> {
  await required('git', ['clone', '-q', sourceRoot, repo], dirname(repo))
  await required('git', ['checkout', '-q', '-B', 'main', `${task.fix}^`], repo)
  await required('git', ['remote', 'remove', 'origin'], repo)
  await required('bun', ['install', '--frozen-lockfile'], repo)
}

async function replayAcceptance(
  repo: string,
  tree: string | undefined,
  task: ReplayTask,
): Promise<RunResult['acceptance']> {
  if (tree === undefined) return 'missing'
  for (const path of task.hiddenTests) {
    const content = await execute('git', ['show', `${task.fix}:${path}`], repo, process.env, 60_000)
    if (content.code !== 0) throw new Error(`Cannot read hidden test ${path}:\n${content.output}`)
    await writeFile(join(tree, path), content.output)
  }
  const [command, ...args] = task.acceptance
  if (command === undefined) throw new Error(`Replay task ${task.id} has no acceptance command.`)
  const result = await execute(command, args, tree, process.env, 600_000)
  await writeFile(join(dirname(repo), 'acceptance.log'), result.output)
  return result.code === 0 ? 'pass' : 'fail'
}

async function prepareRevision(config: Options, revision: Revision): Promise<Revision> {
  if (revision.revision === undefined) return revision
  const worktree = join(config.out, 'revisions', revision.label)
  await required(
    'git',
    ['worktree', 'add', '--detach', '-q', worktree, revision.revision],
    sourceRoot,
  )
  await required('bun', ['install', '--frozen-lockfile'], worktree, process.env, 600_000)
  const agentDir = await mirrorAgentDirectory({
    revisionRoot: worktree,
    sourceRoot,
    target: join(config.out, 'agents', revision.label),
  })
  write(`Revision ${revision.label}: ${revision.revision} in ${worktree}\n`)
  return { ...revision, agentDir, worktree }
}

async function releaseRevisions(config: Options, revisions: readonly Revision[]): Promise<void> {
  for (const revision of revisions) {
    if (revision.worktree === undefined) continue
    await execute(
      'git',
      ['worktree', 'remove', '--force', revision.worktree],
      sourceRoot,
      process.env,
      120_000,
    )
  }
  await rm(join(config.out, 'agents'), { force: true, recursive: true })
}

async function policyFor(config: Options, owner: Owner): Promise<string | undefined> {
  if (owner.selector === undefined) return undefined
  const configured = process.env['PSTACK_MODEL_POLICY']
  const source =
    configured !== undefined && configured.length > 0
      ? configured
      : join(homedir(), '.agents', 'rules', 'pstack-models.md')
  const path = join(config.out, `policy-${owner.label}.md`)
  await writeFile(path, ownerPolicy(await readFile(source, 'utf8'), owner.selector))
  return path
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

function variantLabel(config: Options, revision: Revision, owner: Owner): string {
  if (revision.revision === undefined) return owner.label
  return owner.selector === undefined ? revision.label : `${revision.label}+${owner.label}`
}

async function runOnce(
  config: Options,
  arm: Arm,
  revision: Revision,
  owner: Owner,
  run: number,
): Promise<RunResult> {
  const task = config.task
  const subject = task === undefined ? arm : arm === 'workspace' ? task.id : `${task.id}:${arm}`
  const label = `${subject}@${variantLabel(config, revision, owner)}`
  const root = join(config.out, `${label}-${run}`)
  const repo = join(root, 'repo')
  const sessions = join(root, 'sessions')
  const setupLog = join(root, 'setup-runs.log')
  await mkdir(sessions, { recursive: true })
  const models = { code: config.codeReview, runtime: config.runtime }
  if (task === undefined) await createRepository(repo)
  else await createReplayRepository(repo, task)
  const prompt =
    task === undefined
      ? benchmarkPrompt(arm, models)
      : arm === 'engine'
        ? replayEnginePrompt(task, models)
        : replayPrompt(task, models)
  const policy = await policyFor(config, owner)
  await writeFile(join(root, 'prompt.md'), prompt)
  write(`${label} run ${run}: ${root}\n`)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BENCH_LOG: setupLog,
    BENCH_SETUP_SECONDS: String(config.setupSeconds),
    PSTACK_WORKTREE_ROOT: join(root, 'worktrees'),
  }
  if (policy !== undefined) env['PSTACK_MODEL_POLICY'] = policy
  if (revision.agentDir !== undefined) env['PI_CODING_AGENT_DIR'] = revision.agentDir
  const started = Date.now()
  const execution = await execute(
    'pi',
    ['-p', '--model', config.coordinator, '--session-dir', sessions, prompt],
    repo,
    env,
    config.timeoutMs,
    join(root, 'pi.log'),
  )
  const wallMs = Date.now() - started
  const metrics = sessionRunMetrics(await sessionFiles(sessions))
  const result: RunResult = {
    ...metrics,
    acceptance:
      task === undefined
        ? await acceptance(arm === 'workspace' ? metrics.worktree : repo)
        : await replayAcceptance(repo, metrics.worktree, task),
    arm: label,
    exitCode: execution.code,
    run,
    setupRuns: await lineCount(setupLog),
    wallMs,
  }
  await writeFile(join(root, 'metrics.json'), `${JSON.stringify(result, null, 2)}\n`)
  write(
    `${label} run ${run}: ${result.finalState ?? 'no checkpoint'}, acceptance ${result.acceptance}, ${(wallMs / 1000).toFixed(1)} s\n`,
  )
  return result
}

async function main(): Promise<void> {
  const config = options()
  if (config === undefined) return
  await mkdir(config.out, { recursive: true })
  write(`Writing results to ${config.out}\n`)
  const results: RunResult[] = []
  const variants = config.arms
  const revisions: Revision[] = []
  try {
    for (const revision of config.revisions) revisions.push(await prepareRevision(config, revision))
    for (let run = 1; run <= config.runs; run += 1) {
      for (const arm of variants) {
        for (const revision of revisions) {
          for (const owner of config.owners)
            results.push(await runOnce(config, arm, revision, owner, run))
        }
      }
    }
  } finally {
    await releaseRevisions(config, revisions)
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
