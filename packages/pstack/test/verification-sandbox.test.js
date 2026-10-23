import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { gateIdentity, runGate } from '../src/delivery-gates.ts'
import { detectVerificationSandbox, prepareSandboxLaunch } from '../src/verification-sandbox.ts'
import { harness, initializeRepository } from './sdk-harness.js'

const exec = promisify(execFile)
const backend = await detectVerificationSandbox()
const available = backend.kind !== 'unavailable'
const directories = []
const environment = { ...process.env }

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pstack-sandbox-test-')))
  directories.push(root)
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  return { root, cwd }
}

async function run(command, cwd) {
  const launch = await prepareSandboxLaunch(command, cwd)
  try {
    return await exec(launch.executable, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      timeout: 20000,
    })
  } finally {
    await launch.dispose()
  }
}

afterEach(async () => {
  process.env = { ...environment }
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it('reports actual host availability and honors required sandbox coverage', () => {
  expect(['macos-seatbelt', 'linux-bubblewrap', 'unavailable']).toContain(backend.kind)
  if (process.env.PSTACK_SANDBOX_REQUIRED === '1')
    expect(available, JSON.stringify(backend)).toBe(true)
})

it.skipIf(available)('fails closed without an available OS backend', async () => {
  const { cwd } = await fixture()
  await expect(run('echo escaped > marker', cwd)).rejects.toThrow(
    'Verification sandbox unavailable:',
  )
  await expect(readFile(join(cwd, 'marker'))).rejects.toThrow(/ENOENT/)
})

describe.skipIf(!available)('real verification command sandbox', () => {
  it('permits private workspace and temporary writes while removing credential environment variables', async () => {
    const { cwd } = await fixture()
    process.env.SANDBOX_TEST_SECRET = 'must-not-reach-the-command'
    const launch = await prepareSandboxLaunch(
      'printf ok > local.txt; printf tmp > "$TMPDIR/marker"; printf "%s" "${SANDBOX_TEST_SECRET-unset}"',
      cwd,
    )
    const scratch = launch.scratch
    try {
      const result = await exec(launch.executable, launch.args, {
        cwd: launch.cwd,
        env: launch.env,
      })
      expect(result.stdout).toBe('unset')
      expect(await readFile(join(cwd, 'local.txt'), 'utf8')).toBe('ok')
      expect(await readFile(join(scratch, 'marker'), 'utf8')).toBe('tmp')
    } finally {
      await launch.dispose()
    }
    await expect(readFile(join(scratch, 'marker'))).rejects.toThrow(/ENOENT/)
  })

  it('blocks absolute paths, traversal, symlink escapes, and Git metadata writes', async () => {
    const { root, cwd } = await fixture()
    await writeFile(join(root, 'outside.txt'), 'original')
    await symlink(join(root, 'outside.txt'), join(cwd, 'escape'))
    await mkdir(join(cwd, '.git'))
    await writeFile(join(cwd, '.git', 'config'), 'original')
    await mkdir(join(cwd, 'nested', '.git'), { recursive: true })
    await writeFile(join(cwd, 'nested', '.git', 'config'), 'original')
    for (const target of [
      join(root, 'outside.txt'),
      '../outside.txt',
      'escape',
      '.git/config',
      'nested/.git/config',
    ]) {
      await expect(run(`printf changed > ${JSON.stringify(target)}`, cwd)).rejects.toThrow(
        /Operation not permitted|Permission denied|Read-only file system/,
      )
    }
    expect(await readFile(join(root, 'outside.txt'), 'utf8')).toBe('original')
    expect(await readFile(join(cwd, '.git', 'config'), 'utf8')).toBe('original')
  })

  it('denies loopback network connections rather than relying on command parsing', async () => {
    const { cwd } = await fixture()
    let connections = 0
    const server = createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    try {
      const address = server.address()
      if (
        !Value.Check(Type.Object({ port: Type.Integer({ minimum: 1, maximum: 65535 }) }), address)
      )
        throw new Error('Missing TCP address.')
      await writeFile(
        join(cwd, 'network.mjs'),
        `import { connect } from 'node:net'; const socket = connect(${address.port}, '127.0.0.1'); socket.setTimeout(1000); socket.on('connect', () => process.exit(3)); socket.on('error', () => process.exit(0)); socket.on('timeout', () => process.exit(0));`,
      )
      await run('node network.mjs', cwd)
      expect(connections).toBe(0)
    } finally {
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      )
    }
  })

  it('denies host pathname Unix sockets as well as TCP connections', async () => {
    const { root, cwd } = await fixture()
    const socketPath = join(root, 'host.sock')
    let connections = 0
    const server = createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    await new Promise((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolveListen)
    })
    try {
      await writeFile(
        join(cwd, 'unix.mjs'),
        `import { connect } from 'node:net'; const socket = connect(${JSON.stringify(socketPath)}); socket.setTimeout(1000); socket.on('connect', () => process.exit(3)); socket.on('error', () => process.exit(0)); socket.on('timeout', () => process.exit(0));`,
      )
      await run('node unix.mjs', cwd)
      expect(connections).toBe(0)
    } finally {
      await new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose())),
      )
    }
  })

  it('rejects new repository metadata before host snapshot callbacks can run', async () => {
    const { root, cwd } = await fixture()
    const marker = join(root, 'escaped')
    await exec('git', ['init', '-q', cwd])
    await writeFile(join(cwd, 'source.txt'), 'source\n')
    await exec('git', ['add', '.'], { cwd })
    await exec(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'base',
      ],
      { cwd },
    )
    const attack = `printf escaped > '${marker}'; cat`
    const command = `mkdir nested; git init -q nested; cd nested; printf '*.txt filter=attack\\n' > .gitattributes; git add .gitattributes; git -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm base; git config filter.attack.clean ${JSON.stringify(attack)}; printf data > input.txt`
    await expect(runGate({ command, cwd, sandbox: true })).rejects.toThrow(
      'repository boundary changed',
    )
    await expect(readFile(marker)).rejects.toThrow(/ENOENT/)
  }, 30000)

  it('executes Bun scripts and Vite+ tests and checks with writable private caches', async () => {
    const { cwd } = await fixture()
    const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    await mkdir(join(cwd, 'node_modules', '.bin'), { recursive: true })
    await symlink(
      join(repository, 'node_modules', 'vite-plus'),
      join(cwd, 'node_modules', 'vite-plus'),
    )
    await symlink(
      join(repository, 'node_modules', '.bin', 'vp'),
      join(cwd, 'node_modules', '.bin', 'vp'),
    )
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        type: 'module',
        scripts: { test: 'vp test run --maxWorkers=1', check: 'vp check' },
      }),
    )
    await writeFile(
      join(cwd, 'vite.config.ts'),
      "import { defineConfig } from 'vite-plus'\nexport default defineConfig({})\n",
    )
    await writeFile(
      join(cwd, 'check.test.ts'),
      "import { expect, test } from 'vite-plus/test'\ntest('sandbox', () => expect(2 + 2).toBe(4))\n",
    )
    expect((await run('bun run test', cwd)).stdout).toContain('1 passed')
    await run('node_modules/.bin/vp fmt --write .', cwd)
    await run('bun run check', cwd)
  }, 60000)

  it('keeps sandbox gate receipts separate and preserves logs and timeout group cleanup', async () => {
    const { root, cwd } = await fixture()
    await exec('git', ['init', '-q', cwd])
    await writeFile(join(cwd, 'source.txt'), 'source\n')
    await exec('git', ['add', '.'], { cwd })
    await exec(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-qm',
        'base',
      ],
      { cwd },
    )
    const ordinary = await gateIdentity(cwd, 'echo checked')
    const isolated = await gateIdentity(cwd, 'echo checked', true)
    expect(isolated.key).not.toBe(ordinary.key)
    expect((await runGate({ command: 'echo checked', cwd })).status).toBe('passed')
    const pass = await runGate({ command: 'echo checked', cwd, sandbox: true })
    expect(pass.cached).toBe(false)
    expect(pass.status).toBe('passed')
    expect(pass.tail).toContain('checked')
    expect((await runGate({ command: 'echo checked', cwd, sandbox: true })).cached).toBe(true)
    const denied = await runGate({
      command: `echo no > ${JSON.stringify(join(root, 'escaped'))}`,
      cwd,
      sandbox: true,
    })
    expect(denied.status).toBe('failed')
    process.env.PSTACK_GATE_TIMEOUT_SECONDS = '0.2'
    const timed = await runGate({
      command: '(sleep 1; echo late > late.txt) & sleep 5',
      cwd,
      sandbox: true,
    })
    expect(timed.status).toBe('timed-out')
    await new Promise((resolveWait) => setTimeout(resolveWait, 1200))
    await expect(readFile(join(cwd, 'late.txt'))).rejects.toThrow(/ENOENT/)
  }, 30000)

  it('enforces the profile through real Task dispatch, native bash, gates, and codemode', async () => {
    const plans = new Map()
    const h = await harness(true, plans)
    try {
      await initializeRepository(h)
      plans.set('read:sandbox', [
        {
          name: 'bash',
          arguments: {
            command: `printf 'sandbox-native'; ! printf escaped > ${JSON.stringify(join(h.dir, 'native-must-not-exist'))}`,
          },
        },
        { name: 'pstack_gate', arguments: { command: 'printf sandbox-gate' } },
        { name: 'write', arguments: { path: join(h.dir, 'must-not-exist'), content: 'blocked' } },
        {
          name: 'codemode',
          arguments: {
            code: `return await tools.write({ path: ${JSON.stringify(join(h.dir, 'script-must-not-exist'))}, content: 'blocked' })`,
          },
        },
      ])
      const result = await h.runtime.run({
        ctx: h.ctx,
        input: {
          description: 'Sandbox verifier',
          prompt: 'read:sandbox',
          role: 'runtime verification',
          capability_profile: 'pstack-sandbox',
          subagent_type: 'generalPurpose',
          readonly: false,
          delivery: { kind: 'independent' },
          tools: ['read', 'bash', 'pstack_gate', 'write', 'codemode'],
          run_in_background: false,
        },
      })
      expect(result.kind, JSON.stringify(result)).toBe('completed')
      const results = h.inventories
        .filter((entry) => entry.action === 'read:sandbox')
        .at(-1).results
      expect(results.find((entry) => entry.toolName === 'bash').isError).toBe(false)
      expect(results.find((entry) => entry.toolName === 'pstack_gate').isError).toBe(false)
      expect(results.find((entry) => entry.toolName === 'write').isError).toBe(true)
      expect(results.find((entry) => entry.toolName === 'codemode').isError).toBe(true)
      await expect(readFile(join(h.dir, 'native-must-not-exist'))).rejects.toThrow(/ENOENT/)
      await expect(readFile(join(h.dir, 'must-not-exist'))).rejects.toThrow(/ENOENT/)
      await expect(readFile(join(h.dir, 'script-must-not-exist'))).rejects.toThrow(/ENOENT/)
      expect(h.runtime.getRecord(result.details.agentId).isolation.integration).toBe('manual')
    } finally {
      await h.close()
    }
  }, 60000)
})
