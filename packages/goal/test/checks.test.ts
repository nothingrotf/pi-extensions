import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'

import { afterEach, describe, expect, test } from 'vite-plus/test'

import { GoalCheckAbortedError, ProjectGoalCheckRunner } from '../src/checks.ts'
import type { GoalCheckResult } from '../src/state.ts'

const execute = promisify(execFile)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function project(packageJson: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'goal-checks-'))
  temporaryDirectories.push(directory)
  await writeFile(join(directory, 'package.json'), packageJson)
  return directory
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path)
      return
    } catch {
      await delay(10)
    }
  }
  throw new Error(`Timed out while waiting for ${path}`)
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('project goal checks', () => {
  test('reports command boundaries and missing checks without exposing output', async () => {
    const directory = await project(
      JSON.stringify({
        packageManager: 'bun@1.4.0',
        scripts: { check: 'node -e "console.log(\'private output\')"' },
      }),
    )
    const events: Array<{ type: string; check?: GoalCheckResult; command?: string }> = []
    const request = {
      cwd: directory,
      runtimeProbe: true,
      signal: new AbortController().signal,
      trusted: true,
      onProgress: (event: { type: string; check?: GoalCheckResult; command?: string }) => {
        events.push(structuredClone(event))
        if (event.check !== undefined) event.check.status = 'failed'
      },
    }
    const results = await new ProjectGoalCheckRunner().run(request)
    expect(events.map((event) => event.type)).toEqual([
      'check-start',
      'check-end',
      'check-start',
      'check-end',
      'check-end',
      'check-end',
    ])
    expect(events[2]?.command).toBe('bun run check')
    expect(
      events.filter((event) => event.type === 'check-end').map((event) => event.check?.kind),
    ).toEqual(results.map((result) => result.kind))
    expect(JSON.stringify(events)).not.toContain('private output')
    expect(results[1]?.status).toBe('passed')
    expect(results[1]?.output).toContain('private output')
  })

  test.each([true, false])('isolates throwing callbacks with project trust %s', async (trusted) => {
    const directory = await project('{invalid manifest')
    let completions = 0
    const request = {
      cwd: directory,
      runtimeProbe: true,
      signal: new AbortController().signal,
      trusted,
      onProgress: (event: { type: string }) => {
        if (event.type === 'check-end') completions += 1
        throw new Error('UI unavailable')
      },
    }
    const results = await new ProjectGoalCheckRunner().run(request)
    expect(completions).toBe(4)
    expect(results[1]?.status).toBe(trusted ? 'failed' : 'unavailable')
  })

  test('isolates rejected progress promises', async () => {
    const directory = await project('{}')
    const request = {
      cwd: directory,
      runtimeProbe: false,
      signal: new AbortController().signal,
      trusted: true,
      onProgress: async () => {
        throw new Error('Async UI unavailable')
      },
    }
    expect(await new ProjectGoalCheckRunner().run(request)).toHaveLength(3)
  })

  test('honors cancellation from command progress before launching the command', async () => {
    const directory = await project(
      JSON.stringify({
        packageManager: 'bun@1.4.0',
        scripts: { check: "node -e \"require('fs').writeFileSync('ran', 'yes')\"" },
      }),
    )
    const controller = new AbortController()
    const completed: GoalCheckResult[] = []
    const request = {
      cwd: directory,
      runtimeProbe: false,
      signal: controller.signal,
      trusted: true,
      onProgress: (event: { type: string; command?: string; check?: GoalCheckResult }) => {
        if (event.type === 'check-start' && event.command === 'bun run check') controller.abort()
        if (event.check !== undefined) completed.push(event.check)
      },
    }
    await expect(new ProjectGoalCheckRunner().run(request)).rejects.toBeInstanceOf(
      GoalCheckAbortedError,
    )
    expect(completed.at(-1)).toMatchObject({ kind: 'typecheck', status: 'unavailable' })
    await expect(access(join(directory, 'ran'))).rejects.toThrow(Error)
  })

  test('runs typecheck, tests, and the optional runtime probe', async () => {
    const directory = await project(
      JSON.stringify({
        packageManager: 'bun@1.4.0',
        scripts: {
          typecheck: 'node -e "process.exit(0)"',
          test: 'node -e "console.error(\'test failure\'); process.exit(2)"',
          smoke: 'node -e "process.exit(0)"',
        },
      }),
    )
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: directory,
      runtimeProbe: true,
      signal: new AbortController().signal,
      trusted: true,
    })
    expect(results.map((result) => [result.kind, result.status])).toEqual([
      ['scope', 'unavailable'],
      ['typecheck', 'passed'],
      ['test', 'failed'],
      ['runtime', 'passed'],
    ])
    expect(results[2]?.command).toBe('bun run test')
    expect(results[2]?.output).toContain('test failure')
  })

  test('captures uncommitted files as fresh review scope', async () => {
    const directory = await project(JSON.stringify({ scripts: {} }))
    await execute('git', ['init'], { cwd: directory })
    await writeFile(join(directory, 'changed.txt'), 'changed')
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: directory,
      runtimeProbe: false,
      signal: new AbortController().signal,
      trusted: true,
    })
    expect(results[0]).toMatchObject({
      kind: 'scope',
      label: 'Review scope',
      status: 'passed',
    })
    expect(results[0]?.output).toContain('changed.txt')
  })

  test('does not execute commands without project trust', async () => {
    const directory = await project(
      JSON.stringify({
        scripts: {
          check: "node -e \"require('fs').writeFileSync('ran', 'yes')\"",
          test: 'node -e "process.exit(0)"',
        },
      }),
    )
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: directory,
      runtimeProbe: false,
      signal: new AbortController().signal,
      trusted: false,
    })
    expect(results.every((result) => result.status === 'unavailable')).toBe(true)
    await expect(access(join(directory, 'ran'))).rejects.toThrow(Error)
  })

  test('closes stdin for noninteractive project checks', async () => {
    const directory = await project(
      JSON.stringify({ packageManager: 'bun@1.4.0', scripts: { check: 'node input.mjs' } }),
    )
    await writeFile(
      join(directory, 'input.mjs'),
      "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))",
    )
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: directory,
      runtimeProbe: false,
      signal: AbortSignal.timeout(2000),
      trusted: true,
    })
    expect(results.find((result) => result.kind === 'typecheck')?.status).toBe('passed')
  })

  test('does not run ancestor scripts when the nearest manifest is invalid', async () => {
    const directory = await project(
      JSON.stringify({ packageManager: 'bun@1.4.0', scripts: { check: 'bun run parent.ts' } }),
    )
    await writeFile(join(directory, 'parent.ts'), "await Bun.write('unexpected', 'ran')")
    const nested = join(directory, 'nested')
    await mkdir(nested)
    await writeFile(join(nested, 'package.json'), '{invalid json')
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: nested,
      runtimeProbe: false,
      signal: new AbortController().signal,
      trusted: true,
    })
    expect(results.find((result) => result.kind === 'typecheck')?.status).toBe('failed')
    await expect(access(join(directory, 'unexpected'))).rejects.toThrow(Error)
  })

  test('reports missing scripts without failure', async () => {
    const directory = await project(JSON.stringify({ scripts: {} }))
    const runner = new ProjectGoalCheckRunner()
    const results = await runner.run({
      cwd: directory,
      runtimeProbe: true,
      signal: new AbortController().signal,
      trusted: true,
    })
    expect(results).toHaveLength(4)
    expect(results.every((result) => result.status === 'unavailable')).toBe(true)
  })

  test.skipIf(process.platform === 'win32')(
    'kills the full process group when active checks are aborted',
    async () => {
      const directory = await project(
        JSON.stringify({
          packageManager: 'bun@1.4.0',
          scripts: { check: 'node parent.mjs' },
        }),
      )
      await writeFile(
        join(directory, 'parent.mjs'),
        `import { spawn } from 'node:child_process'\nimport { writeFileSync } from 'node:fs'\nconst child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' })\nwriteFileSync('child.pid', String(child.pid))\nprocess.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n`,
      )
      const controller = new AbortController()
      const runner = new ProjectGoalCheckRunner()
      const pending = runner.run({
        cwd: directory,
        runtimeProbe: false,
        signal: controller.signal,
        trusted: true,
      })
      const pidFile = join(directory, 'child.pid')
      await waitForFile(pidFile)
      const pid = Number(await readFile(pidFile, 'utf8'))
      controller.abort()
      await expect(pending).rejects.toBeInstanceOf(GoalCheckAbortedError)
      for (let attempt = 0; attempt < 100 && processExists(pid); attempt += 1) await delay(10)
      const alive = processExists(pid)
      if (alive) process.kill(pid, 'SIGKILL')
      expect(alive).toBe(false)
    },
  )

  test('rejects an aborted check request before process launch', async () => {
    const directory = await project(
      JSON.stringify({ scripts: { check: 'node -e "process.exit(0)"' } }),
    )
    const controller = new AbortController()
    controller.abort()
    const runner = new ProjectGoalCheckRunner()
    await expect(
      runner.run({ cwd: directory, runtimeProbe: false, signal: controller.signal, trusted: true }),
    ).rejects.toBeInstanceOf(GoalCheckAbortedError)
    expect(await readFile(join(directory, 'package.json'), 'utf8')).toContain('scripts')
  })
})
