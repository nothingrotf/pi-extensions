import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { appendFile, copyFile, mkdir, open, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'

import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { materializeDependencyDirectories } from '@nothingrotf/subagent'
import { type Static, Type } from 'typebox'
import { Value } from 'typebox/value'

export const deliveryWorkspaceEntryType = '@nothingrotf/pstack/delivery-workspace-v1'

const SETUP_SCRIPT = join('.pstack', 'worktree-setup.sh')
const INCLUDE_FILE = '.worktreeinclude'
const SETUP_TIMEOUT_MS = 15 * 60_000
const BASE_CONFIG_KEY = 'pstackbase'
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/

const id = Type.String({ minLength: 1, maxLength: 256 })
const path = Type.String({ minLength: 1, maxLength: 4096 })

export const DeliveryWorkspaceSchema = Type.Object(
  {
    version: Type.Literal(1),
    issue: id,
    ownerSessionId: id,
    worktree: path,
    branch: Type.String({ minLength: 1, maxLength: 512 }),
    base: Type.String({ pattern: '^[a-f0-9]{40,64}$' }),
    sourceRoot: path,
    createdAt: Type.Number({ minimum: 0 }),
    preparation: Type.Object(
      {
        dependencies: Type.Array(path, { maxItems: 256 }),
        included: Type.Integer({ minimum: 0 }),
        setup: Type.Object(
          {
            exitCode: Type.Optional(Type.Integer()),
            log: Type.Optional(path),
            status: Type.Enum(['absent', 'passed', 'failed']),
            timedOut: Type.Optional(Type.Boolean()),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
)

export type DeliveryWorkspace = Static<typeof DeliveryWorkspaceSchema>

interface CommandResult {
  code: number
  stderr: string
  stdout: string
}

function run(
  cwd: string,
  command: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env: env ?? process.env, stdio: 'pipe' })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      resolveResult({
        code: code ?? 1,
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdout: Buffer.concat(stdout).toString('utf8'),
      }),
    )
    child.stdin.end()
  })
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await run(cwd, 'git', args)
  if (result.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return result.stdout
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function issueSlug(issue: string): string {
  const slug = issue
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64)
  if (slug.length > 0 && slug === issue) return slug
  return `${slug.length > 0 ? `${slug}-` : ''}${digest(issue).slice(0, 6)}`
}

export function workspaceRoot(): string {
  const configured = process.env['PSTACK_WORKTREE_ROOT']
  return configured !== undefined && configured.length > 0
    ? resolve(configured)
    : join(homedir(), '.pi', 'worktrees')
}

export function readDeliveryWorkspaces(
  entries: readonly SessionEntry[],
  ownerSessionId: string,
): Map<string, DeliveryWorkspace> {
  const workspaces = new Map<string, DeliveryWorkspace>()
  for (const entry of entries) {
    if (entry.type !== 'custom' || entry.customType !== deliveryWorkspaceEntryType) continue
    if (!Value.Check(DeliveryWorkspaceSchema, entry.data)) continue
    if (entry.data.ownerSessionId !== ownerSessionId) continue
    workspaces.set(entry.data.issue, entry.data)
  }
  return workspaces
}

export function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`)
}

async function registeredWorktrees(sourceRoot: string): Promise<Set<string>> {
  const output = await git(sourceRoot, ['worktree', 'list', '--porcelain'])
  const paths = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line.startsWith('worktree ')) continue
    try {
      paths.add(await realpath(line.slice('worktree '.length)))
    } catch {}
  }
  return paths
}

async function copyIncludedFiles(sourceRoot: string, worktree: string): Promise<number> {
  const includeFile = join(sourceRoot, INCLUDE_FILE)
  if (!(await exists(includeFile))) return 0
  const output = await git(sourceRoot, [
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    `--exclude-from=${includeFile}`,
  ])
  let copied = 0
  for (const relativePath of output.split('\0')) {
    if (relativePath.length === 0) continue
    const target = join(worktree, relativePath)
    if (await exists(target)) continue
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(sourceRoot, relativePath), target, constants.COPYFILE_FICLONE)
    copied += 1
  }
  return copied
}

export function setupTimeoutMs(): number {
  const configured = Number(process.env['PSTACK_SETUP_TIMEOUT_SECONDS'])
  return Number.isFinite(configured) && configured > 0
    ? Math.round(configured * 1000)
    : SETUP_TIMEOUT_MS
}

function killProcessGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {}
}

async function runSetup(
  worktree: string,
  sourceRoot: string,
  issue: string,
): Promise<DeliveryWorkspace['preparation']['setup']> {
  const script = join(worktree, SETUP_SCRIPT)
  if (!(await exists(script))) return { status: 'absent' }
  const gitDir = (await git(worktree, ['rev-parse', '--path-format=absolute', '--git-dir'])).trim()
  const log = join(gitDir, 'pstack-setup.log')
  const timeoutMs = setupTimeoutMs()
  const output = await open(log, 'w')
  let timedOut = false
  let code: number
  try {
    code = await new Promise<number>((resolveCode, reject) => {
      const child = spawn('bash', [script], {
        cwd: worktree,
        detached: true,
        env: {
          ...process.env,
          PSTACK_ISSUE: issue,
          PSTACK_SOURCE_ROOT: sourceRoot,
          PSTACK_WORKTREE: worktree,
        },
        stdio: ['ignore', output.fd, output.fd],
      })
      const timer = setTimeout(() => {
        timedOut = true
        killProcessGroup(child.pid)
      }, timeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', (exitCode) => {
        clearTimeout(timer)
        resolveCode(exitCode ?? 1)
      })
    })
  } finally {
    await output.close()
  }
  if (timedOut) {
    await appendFile(log, `\nSetup timed out after ${timeoutMs / 1000} seconds.\n`)
    return { exitCode: code, log, status: 'failed', timedOut: true }
  }
  return { exitCode: code, log, status: code === 0 ? 'passed' : 'failed' }
}

async function commitOf(cwd: string, revision: string): Promise<string> {
  return (await git(cwd, ['rev-parse', '--verify', `${revision}^{commit}`])).trim()
}

async function recordedBase(
  sourceRoot: string,
  branch: string,
  tip: string,
): Promise<string | undefined> {
  const result = await run(sourceRoot, 'git', [
    'config',
    '--get',
    `branch.${branch}.${BASE_CONFIG_KEY}`,
  ])
  const value = result.stdout.trim()
  if (result.code !== 0 || !COMMIT_PATTERN.test(value)) return undefined
  const ancestor = await run(sourceRoot, 'git', ['merge-base', '--is-ancestor', value, tip])
  return ancestor.code === 0 ? value : undefined
}

async function existingBase(
  sourceRoot: string,
  branch: string,
  tip: string,
  requested: string,
  explicit: boolean,
): Promise<string> {
  const recorded = explicit ? undefined : await recordedBase(sourceRoot, branch, tip)
  if (recorded !== undefined) return recorded
  const fork = await run(sourceRoot, 'git', ['merge-base', tip, requested])
  const value = fork.stdout.trim()
  if (fork.code !== 0 || !COMMIT_PATTERN.test(value)) {
    throw new Error(
      `Branch ${branch} shares no history with ${requested}. Pass a base that the branch descends from.`,
    )
  }
  return value
}

export interface IssueWorkspaceRequest {
  base?: string
  cwd: string
  issue: string
  ownerSessionId: string
}

export async function prepareIssueWorkspace(
  request: IssueWorkspaceRequest,
): Promise<DeliveryWorkspace> {
  const top = (await git(request.cwd, ['rev-parse', '--show-toplevel'])).trim()
  const sourceRoot = await realpath(top)
  const commonDir = await realpath(
    resolve(
      sourceRoot,
      (await git(sourceRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(),
    ),
  )
  const slug = issueSlug(request.issue)
  const branch = `pstack/${slug}`
  const worktree = join(
    workspaceRoot(),
    `${basename(sourceRoot)}-${digest(commonDir).slice(0, 8)}`,
    slug,
  )
  const requested = await commitOf(sourceRoot, request.base ?? 'HEAD')
  const explicit = request.base !== undefined
  let base = requested
  if (await exists(worktree)) {
    if (!(await registeredWorktrees(sourceRoot)).has(await realpath(worktree))) {
      throw new Error(
        `${worktree} exists but is not a worktree of ${sourceRoot}. Move it aside, then retry.`,
      )
    }
    const tip = await commitOf(worktree, 'HEAD')
    base = await existingBase(sourceRoot, branch, tip, requested, explicit)
  } else {
    await mkdir(dirname(worktree), { recursive: true })
    const branchExists =
      (await run(sourceRoot, 'git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]))
        .code === 0
    if (branchExists) {
      const tip = await commitOf(sourceRoot, `refs/heads/${branch}`)
      base = await existingBase(sourceRoot, branch, tip, requested, explicit)
    }
    await git(
      sourceRoot,
      branchExists
        ? ['worktree', 'add', worktree, branch]
        : ['worktree', 'add', '-b', branch, worktree, base],
    )
  }
  await git(sourceRoot, ['config', `branch.${branch}.${BASE_CONFIG_KEY}`, base])
  const physical = await realpath(worktree)
  const included = await copyIncludedFiles(sourceRoot, physical)
  const dependencies = await materializeDependencyDirectories(sourceRoot, physical)
  const setup = await runSetup(physical, sourceRoot, request.issue)
  return {
    version: 1,
    issue: request.issue,
    ownerSessionId: request.ownerSessionId,
    worktree: physical,
    branch,
    base,
    sourceRoot,
    createdAt: Date.now(),
    preparation: { dependencies: dependencies.paths.slice(0, 256), included, setup },
  }
}

export function workspaceBrief(workspace: DeliveryWorkspace): string {
  const { dependencies, included, setup } = workspace.preparation
  const lines = [
    `Issue workspace: ${workspace.worktree} on branch ${workspace.branch}, base ${workspace.base}.`,
  ]
  if (setup.status === 'passed') {
    lines.push(
      `Environment setup already ran once for this workspace: ${SETUP_SCRIPT} passed. Reuse that environment. Do not rerun setup or install steps from repository instructions unless a check fails because the environment is missing.`,
    )
  } else if (setup.status === 'failed') {
    lines.push(
      `Environment setup ${setup.timedOut === true ? 'timed out' : `failed with exit code ${setup.exitCode ?? 'unknown'}`}. Its log is ${setup.log ?? 'unavailable'}. Repair the environment before you rely on checks.`,
    )
  } else {
    lines.push(
      `The repository has no ${SETUP_SCRIPT}. Prepare only the environment that your checks need, and keep it inside ignored paths.`,
    )
  }
  if (included > 0 || dependencies.length > 0) {
    lines.push(
      `Preparation also copied ${included} file${included === 1 ? '' : 's'} from ${INCLUDE_FILE} and ${dependencies.length > 0 ? `these dependency directories: ${dependencies.join(', ')}` : 'no dependency directories'}.`,
    )
  }
  return lines.join('\n')
}

export async function workspaceIsLive(workspace: DeliveryWorkspace): Promise<boolean> {
  try {
    return (await registeredWorktrees(workspace.sourceRoot)).has(await realpath(workspace.worktree))
  } catch {
    return false
  }
}
