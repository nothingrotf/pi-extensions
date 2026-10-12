import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import { formatGateOutcome, gateIdentity, runGate } from '../src/delivery-gates.ts'

const exec = promisify(execFile)
const roots: string[] = []
const environment = { ...process.env }

async function repository(): Promise<{ counter: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pstack-gates-'))
  roots.push(root)
  const repo = join(root, 'repo')
  await exec('git', ['init', '-q', repo])
  await writeFile(join(repo, 'source.txt'), 'one\n')
  await exec('git', ['add', '.'], { cwd: repo })
  await exec(
    'git',
    ['-c', 'user.name=Gate', '-c', 'user.email=gate@example.test', 'commit', '-qm', 'base'],
    { cwd: repo },
  )
  return { counter: join(root, 'counter.log'), root: repo }
}

async function runs(counter: string): Promise<number> {
  try {
    return (await readFile(counter, 'utf8')).split('\n').filter(Boolean).length
  } catch {
    return 0
  }
}

afterEach(async () => {
  process.env = { ...environment }
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('tree-keyed gates', () => {
  it('reuses a pass for the same tree and runs again after the tree changes', async () => {
    const { counter, root } = await repository()
    const command = `echo run >> '${counter}'`
    const first = await runGate({ command, cwd: root })
    expect(first).toMatchObject({ cached: false, reusable: true, status: 'passed' })
    const second = await runGate({ command, cwd: root })
    expect(second).toMatchObject({ cached: true, status: 'passed' })
    expect(second.log).toBe(first.log)
    expect(formatGateOutcome(command, second)).toContain('No command ran.')
    expect(await runs(counter)).toBe(1)
    await writeFile(join(root, 'untracked.txt'), 'new\n')
    expect((await runGate({ command, cwd: root })).cached).toBe(false)
    await writeFile(join(root, 'source.txt'), 'two\n')
    expect((await runGate({ command, cwd: root })).cached).toBe(false)
    expect((await runGate({ command, cwd: root, fresh: true })).cached).toBe(false)
    expect(await runs(counter)).toBe(4)
  }, 30_000)

  it('keys the result by command and working directory', async () => {
    const { root } = await repository()
    const base = await gateIdentity(root, 'true')
    expect((await gateIdentity(root, 'true ')).key).not.toBe(base.key)
    await exec('mkdir', [join(root, 'nested')])
    await writeFile(join(root, 'nested', 'file.txt'), 'x\n')
    const moved = await gateIdentity(join(root, 'nested'), 'true')
    expect(moved.cwd).toBe('nested')
    expect(moved.trees[0]?.path).toBe('.')
  })

  it('never reuses a failure', async () => {
    const { counter, root } = await repository()
    const command = `echo run >> '${counter}'; echo boom; exit 3`
    const first = await runGate({ command, cwd: root })
    expect(first).toMatchObject({ cached: false, exitCode: 3, reusable: false, status: 'failed' })
    expect(first.tail).toContain('boom')
    await runGate({ command, cwd: root })
    expect(await runs(counter)).toBe(2)
  })

  it('does not reuse a pass from a command that changed the tree', async () => {
    const { root } = await repository()
    const outcome = await runGate({ command: 'echo edited > generated.txt', cwd: root })
    expect(outcome).toMatchObject({ reusable: false, status: 'passed' })
    expect(formatGateOutcome('echo edited > generated.txt', outcome)).toContain('not reusable')
  })

  it('shares one run between concurrent callers', async () => {
    const { counter, root } = await repository()
    const command = `sleep 0.3; echo run >> '${counter}'`
    const [left, right] = await Promise.all([
      runGate({ command, cwd: root }),
      runGate({ command, cwd: root }),
    ])
    expect(left).toBe(right)
    expect(await runs(counter)).toBe(1)
  })

  it('keeps a shared run alive until every caller aborts', async () => {
    const { counter, root } = await repository()
    const command = `sleep 0.5; echo run >> '${counter}'`
    const leaving = new AbortController()
    const staying = runGate({ command, cwd: root })
    const left = runGate({ command, cwd: root, signal: leaving.signal })
    setTimeout(() => leaving.abort(), 100)
    await expect(left).rejects.toThrow('pstack_gate was aborted.')
    expect(await staying).toMatchObject({ cached: false, status: 'passed' })
    expect(await runs(counter)).toBe(1)

    const first = new AbortController()
    const second = new AbortController()
    const slow = 'sleep 5; echo slow >> ' + `'${counter}'`
    const started = Date.now()
    const calls = [
      runGate({ command: slow, cwd: root, signal: first.signal }),
      runGate({ command: slow, cwd: root, signal: second.signal }),
    ]
    setTimeout(() => {
      first.abort()
      second.abort()
    }, 200)
    for (const call of calls) await expect(call).rejects.toThrow('pstack_gate was aborted.')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(Date.now() - started).toBeLessThan(4000)
    expect(await runs(counter)).toBe(1)
  })

  it('starts a fresh run instead of joining a run in flight', async () => {
    const { counter, root } = await repository()
    const command = `sleep 0.5; echo run >> '${counter}'`
    const shared = runGate({ command, cwd: root })
    await new Promise((resolve) => setTimeout(resolve, 150))
    const fresh = runGate({ command, cwd: root, fresh: true })
    expect(await shared).not.toBe(await fresh)
    expect(await runs(counter)).toBe(2)
  })

  it('bounds concurrent gates with the configured slot count', async () => {
    process.env['PSTACK_GATE_CONCURRENCY'] = '1'
    const { counter, root } = await repository()
    const command = (name: string) =>
      `echo start-${name} >> '${counter}'; sleep 0.3; echo end-${name} >> '${counter}'`
    await Promise.all([
      runGate({ command: command('a'), cwd: root }),
      runGate({ command: command('b'), cwd: root }),
    ])
    const order = (await readFile(counter, 'utf8')).trim().split('\n')
    expect(order.map((line) => line.split('-')[0])).toEqual(['start', 'end', 'start', 'end'])
  })

  it('stops the whole process group at the gate timeout', async () => {
    process.env['PSTACK_GATE_TIMEOUT_SECONDS'] = '0.5'
    const { counter, root } = await repository()
    const started = Date.now()
    const outcome = await runGate({
      command: `(sleep 2; echo late >> '${counter}') & sleep 5`,
      cwd: root,
    })
    expect(outcome.status).toBe('timed-out')
    expect(Date.now() - started).toBeLessThan(4000)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 2500))
    expect(await runs(counter)).toBe(0)
  })

  it('stops the gate when the caller aborts', async () => {
    const { root } = await repository()
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 200)
    const started = Date.now()
    await expect(
      runGate({ command: 'sleep 5', cwd: root, signal: controller.signal }),
    ).rejects.toThrow('pstack_gate was aborted.')
    expect(Date.now() - started).toBeLessThan(4000)
  })

  it('runs again when the recorded log no longer matches its digest', async () => {
    const { counter, root } = await repository()
    const command = `echo run >> '${counter}'`
    const first = await runGate({ command, cwd: root })
    await writeFile(first.log, 'tampered\n')
    expect((await runGate({ command, cwd: root })).cached).toBe(false)
    expect(await runs(counter)).toBe(2)
  })
})
