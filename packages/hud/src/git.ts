import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const timeoutMs = 2_000

export type GitStatus = {
  branch: string | undefined
  dirty: boolean
  ahead: number
  behind: number
  staged: number
  modified: number
  added: number
  deleted: number
  renamed: number
  copied: number
  untracked: number
  conflicted: number
}

export function emptyGitStatus(): GitStatus {
  return {
    branch: undefined,
    dirty: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    modified: 0,
    added: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    untracked: 0,
    conflicted: 0,
  }
}

export function parsePorcelain(output: string): GitStatus {
  const status = emptyGitStatus()
  for (const line of output.split(/\r?\n/u)) {
    if (line.startsWith('# branch.head ')) {
      const branch = line.slice('# branch.head '.length).trim()
      status.branch = branch && branch !== '(detached)' ? branch : undefined
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const counts = line.match(/\+(\d+)\s+-(\d+)/u)
      status.ahead = Number(counts?.[1] ?? 0)
      status.behind = Number(counts?.[2] ?? 0)
      continue
    }
    if (!line || line.startsWith('#')) {
      continue
    }
    status.dirty = true
    if (line.startsWith('? ')) {
      status.untracked += 1
      continue
    }
    if (line.startsWith('u ')) {
      status.conflicted += 1
      continue
    }
    if (!line.startsWith('1 ') && !line.startsWith('2 ')) {
      continue
    }
    const code = line.split(' ')[1] ?? '..'
    const index = code[0] ?? '.'
    if (index !== '.' && index !== ' ') {
      status.staged += 1
    }
    if (code.includes('M') || code.includes('T')) {
      status.modified += 1
    }
    if (code.includes('A')) {
      status.added += 1
    }
    if (code.includes('D')) {
      status.deleted += 1
    }
    if (code.includes('R')) {
      status.renamed += 1
    }
    if (code.includes('C')) {
      status.copied += 1
    }
  }
  return status
}

export async function readGitStatus(
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<GitStatus> {
  try {
    const result = await execFileAsync('git', ['status', '--porcelain=2', '--branch'], {
      cwd,
      timeout: timeoutMs,
      signal,
    })
    return parsePorcelain(String(result.stdout))
  } catch {
    return emptyGitStatus()
  }
}
