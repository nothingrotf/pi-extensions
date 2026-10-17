import { access, realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { Value } from 'typebox/value'
import { describe, expect, it, vi } from 'vite-plus/test'

import { createBackgroundCommands } from '../src/headless.ts'
import { parseCommandRequest, SnapshotSchema } from '../src/schema.ts'
import type { CommandContext } from '../src/shell.ts'
import { commandFixture, nodeCommand, readyFile, start, waitForCommand } from './helpers.ts'

describe('session-owned background commands', () => {
  it('acknowledges launch before settlement and captures stdout, stderr, and completion', async () => {
    const { service, completions } = await commandFixture()
    const command = start(service, {
      command: nodeCommand('process.stdout.write("out\\n"); process.stderr.write("err\\n")'),
    })
    expect(command.snapshot().status).toBe('running')
    const snapshot = await waitForCommand(service, command)
    expect(snapshot).toMatchObject({ status: 'completed', exitCode: 0 })
    expect(Value.Check(SnapshotSchema, snapshot)).toBe(true)
    expect(command.output()?.text).toContain('out\n')
    expect(command.output()?.text).toContain('err\n')
    expect(completions).toHaveLength(1)
    expect(completions[0]?.snapshot.id).toBe(command.id)
    expect(service.find(command.id)).toBe(command)
  })

  it('retains failures, launch errors, and timed-out commands as errors', async () => {
    const { service } = await commandFixture()
    const failed = start(service, {
      command: nodeCommand('process.stderr.write("diagnostic"); process.exit(7)'),
    })
    expect(await waitForCommand(service, failed)).toMatchObject({
      status: 'error',
      exitCode: 7,
      errorMessage: 'The command exited with code 7.',
    })
    expect(failed.output()?.text).toBe('diagnostic')
    const timeout = start(service, {
      command: nodeCommand('setInterval(() => {}, 1000)'),
      timeout: 0.05,
    })
    expect(await waitForCommand(service, timeout)).toMatchObject({
      status: 'error',
      exitCode: null,
    })
    const broken = await commandFixture({ cwd: '/nonexistent-background-test-directory' })
    const launch = start(broken.service, { command: 'true' })
    expect(await waitForCommand(broken.service, launch)).toMatchObject({
      status: 'error',
      exitCode: null,
    })
  })

  it('stops only the selected process tree and makes repeated stop harmless', async () => {
    const { directory, service } = await commandFixture()
    const marker = readyFile(directory, 'ready')
    const command = start(service, {
      command: nodeCommand(
        `require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'ready'))}, String(process.pid)); setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(join(directory, 'escaped'))}, 'bad'), 800); setInterval(() => {}, 1000)`,
      ),
    })
    const pid = Number(await marker)
    const other = start(service, { command: nodeCommand('process.stdout.write("other survived")') })
    expect(command.stop().status).toBe('stopping')
    expect(await waitForCommand(service, command)).toMatchObject({ status: 'stopped' })
    expect(command.stop().status).toBe('stopped')
    expect(() => process.kill(pid, 0)).toThrow(/ESRCH/)
    expect(await waitForCommand(service, other)).toMatchObject({ status: 'completed' })
    expect(other.output()?.text).toBe('other survived')
    await expect(access(join(directory, 'escaped'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects excess admission and stops all active commands on disposal', async () => {
    const { service, completions } = await commandFixture()
    const commands = Array.from({ length: 8 }, () =>
      start(service, { command: nodeCommand('setInterval(() => {}, 1000)') }),
    )
    const rejected = service.start({ command: 'true' })
    expect(rejected).toMatchObject({ ok: false, error: { code: 'capacity' } })
    const disposal = service.dispose()
    expect(service.dispose()).toBe(disposal)
    expect(service.start({ command: 'true' })).toMatchObject({
      ok: false,
      error: { code: 'closed' },
    })
    await disposal
    expect(commands.map((command) => command.snapshot().status)).toEqual(Array(8).fill('stopped'))
    expect(completions).toEqual([])
  })

  it('retains only twenty terminal records and releases evicted handles', async () => {
    const { service } = await commandFixture()
    const first = start(service, { command: 'printf first' })
    await waitForCommand(service, first)
    for (let index = 0; index < 20; index += 1) {
      const command = start(service, { command: 'true' })
      await waitForCommand(service, command)
    }
    expect(service.list()).toHaveLength(20)
    expect(service.find(first.id)).toBeUndefined()
    expect(first.output()).toBeUndefined()
    const snapshot = service.list()[0]
    if (snapshot !== undefined) Object.assign(snapshot, { name: 'changed' })
    expect(service.list()[0]?.name).not.toBe('changed')
  })

  it('replays retained completions after delivery gaps and synchronous send failures exactly once', async () => {
    const { service } = await commandFixture()
    let blocked = true
    const delivered: string[] = []
    service.bindCompletion({
      canDeliver: () => !blocked,
      deliver: ({ snapshot }) => {
        delivered.push(snapshot.id)
        service.flushCompletions()
      },
    })
    const command = start(service, { command: 'true' })
    await waitForCommand(service, command)
    expect(delivered).toEqual([])
    blocked = false
    const unbind = service.bindCompletion({
      deliver: () => {
        throw new Error('delivery failed')
      },
    })
    expect(delivered).toEqual([])
    unbind()
    const oldUnbind = service.bindCompletion({
      deliver: ({ snapshot }) => {
        delivered.push(snapshot.id)
        service.flushCompletions()
      },
    })
    service.bindCompletion({
      deliver: ({ snapshot }) => {
        delivered.push(snapshot.id)
      },
    })
    oldUnbind()
    service.flushCompletions()
    expect(delivered).toEqual([command.id])
  })

  it('does not deliver through a binding revoked during its own permission check', async () => {
    const { service } = await commandFixture()
    let blocked = true
    const delivered: string[] = []
    let unbind = () => {}
    unbind = service.bindCompletion({
      canDeliver: () => {
        if (blocked) return false
        unbind()
        return true
      },
      deliver: ({ snapshot }) => {
        delivered.push(snapshot.id)
      },
    })
    const command = start(service, { command: 'true' })
    await waitForCommand(service, command)
    blocked = false
    service.flushCompletions()
    expect(delivered).toEqual([])
    service.bindCompletion({
      deliver: ({ snapshot }) => {
        delivered.push(snapshot.id)
      },
    })
    expect(delivered).toEqual([command.id])
  })

  it('keeps cleanup and notification delivery safe when observers throw', async () => {
    const { service, completions } = await commandFixture()
    service.onChange(() => {
      throw new Error('observer failed')
    })
    const command = start(service, { command: 'printf healthy' })
    expect(await waitForCommand(service, command)).toMatchObject({ status: 'completed' })
    expect(completions).toHaveLength(1)
  })

  it('uses current launch context, command prefix, cwd, and Pi environment', async () => {
    const { directory } = await commandFixture()
    const { service } = await commandFixture({
      cwd: directory,
      sessionFile: join(directory, 'session.jsonl'),
      model: { provider: 'fixture', id: 'model' },
      thinkingLevel: 'high',
      commandPrefix: 'export BACKGROUND_PREFIX=prefix',
    })
    const command = start(service, {
      command: nodeCommand(
        'process.stdout.write(JSON.stringify({cwd:process.cwd(),id:process.env.PI_SESSION_ID,file:process.env.PI_SESSION_FILE,provider:process.env.PI_PROVIDER,model:process.env.PI_MODEL,reasoning:process.env.PI_REASONING_LEVEL,prefix:process.env.BACKGROUND_PREFIX}))',
      ),
    })
    await waitForCommand(service, command)
    expect(JSON.parse(command.output()?.text ?? '{}')).toEqual({
      cwd: await realpath(directory),
      id: 'background-test',
      file: join(directory, 'session.jsonl'),
      provider: 'fixture',
      model: 'model',
      reasoning: 'high',
      prefix: 'prefix',
    })
  })

  it('refreshes launch context and removes inherited Pi metadata when exposure is disabled', async () => {
    const { directory } = await commandFixture()
    vi.stubEnv('PI_SESSION_ID', 'stale-session')
    vi.stubEnv('PI_PROVIDER', 'stale-provider')
    vi.stubEnv('PI_MODEL', 'stale-model')
    vi.stubEnv('PI_REASONING_LEVEL', 'stale-reasoning')
    vi.stubEnv('PI_SESSION_FILE', 'stale-file')
    let context: CommandContext = {
      cwd: directory,
      model: { provider: 'current-provider', id: 'current-model' },
    }
    const service = createBackgroundCommands({
      sessionId: 'current-session',
      getContext: () => context,
    })
    const script = nodeCommand(
      'process.stdout.write(JSON.stringify({id:process.env.PI_SESSION_ID,provider:process.env.PI_PROVIDER,model:process.env.PI_MODEL,reasoning:process.env.PI_REASONING_LEVEL,file:process.env.PI_SESSION_FILE}))',
    )
    try {
      const first = start(service, { command: script })
      await waitForCommand(service, first)
      expect(first.output()?.text).toBe(
        '{"id":"current-session","provider":"current-provider","model":"current-model"}',
      )
      context = { cwd: directory, exposeSessionEnvironment: false }
      const second = start(service, { command: script })
      await waitForCommand(service, second)
      expect(second.output()?.text).toBe('{}')
    } finally {
      await service.dispose()
      vi.unstubAllEnvs()
    }
  })

  it('rejects malformed actions and invalid command limits before launch', async () => {
    const { service } = await commandFixture()
    for (const input of [
      { command: ' ' },
      { command: 'é'.repeat(40000) },
      { command: 'true', timeout: NaN },
      { command: 'true', timeout: Infinity },
      { command: 'true', timeout: -1 },
      { command: 'true', name: 'x'.repeat(201) },
    ]) {
      expect(service.start(input)).toMatchObject({ ok: false, error: { code: 'invalid-input' } })
    }
    for (const input of [
      { action: 'start', command: 'true', cwd: '/' },
      { action: 'output', id: 'id', command: 'true' },
      { action: 'list', id: 'id' },
      { action: 'stop' },
      { action: 'unknown' },
    ]) {
      expect(parseCommandRequest(input)).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' },
      })
    }
    expect(service.list()).toEqual([])
  })
})
