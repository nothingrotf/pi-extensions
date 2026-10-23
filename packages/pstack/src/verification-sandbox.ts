import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export const SANDBOX_POLICY = 'verification-sandbox-v1'

export type SandboxBackend =
  | { kind: 'macos-seatbelt'; executable: string }
  | { kind: 'linux-bubblewrap'; executable: string; architecture: 'x64' | 'arm64' }
  | { kind: 'unavailable'; reason: string }

export interface SandboxLaunch {
  executable: string
  args: string[]
  cwd: string
  scratch: string
  env: NodeJS.ProcessEnv
  dispose(): Promise<void>
}

function sandboxEnvironment(scratch: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of [
    'PATH',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'TZ',
    'CI',
    'NODE_ENV',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env['TMPDIR'] = scratch
  env['TMP'] = scratch
  env['TEMP'] = scratch
  env['XDG_CACHE_HOME'] = join(scratch, 'cache')
  env['BUN_INSTALL_CACHE_DIR'] = join(scratch, 'bun')
  env['npm_config_cache'] = join(scratch, 'npm')
  return env
}

async function findBubblewrap(): Promise<string | undefined> {
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (directory.length === 0) continue
    const path = join(directory, 'bwrap')
    try {
      await access(path, constants.X_OK)
      return await realpath(path)
    } catch {}
  }
  return undefined
}

export async function detectVerificationSandbox(): Promise<SandboxBackend> {
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'linux')
    return { kind: 'unavailable', reason: `Unsupported operating system: ${platform}.` }
  const architecture = process.arch
  if (platform === 'linux' && architecture !== 'x64' && architecture !== 'arm64')
    return { kind: 'unavailable', reason: `Unsupported Linux architecture: ${architecture}.` }
  const executable = platform === 'darwin' ? '/usr/bin/sandbox-exec' : await findBubblewrap()
  if (executable === undefined)
    return { kind: 'unavailable', reason: 'Bubblewrap (bwrap) is not installed.' }
  const args =
    platform === 'darwin'
      ? ['-p', '(version 1)(allow default)(deny network*)(deny file-write*)', '/usr/bin/true']
      : [
          '--die-with-parent',
          '--unshare-all',
          '--ro-bind',
          '/',
          '/',
          '--dev',
          '/dev',
          '--proc',
          '/proc',
          '/bin/true',
        ]
  try {
    await execute(executable, args, {
      timeout: 5000,
      maxBuffer: 4096,
      env: sandboxEnvironment(tmpdir()),
    })
    if (platform === 'darwin') return { kind: 'macos-seatbelt', executable }
    if (architecture === 'x64' || architecture === 'arm64')
      return { kind: 'linux-bubblewrap', executable, architecture }
    return { kind: 'unavailable', reason: 'Unsupported Linux architecture.' }
  } catch {
    return {
      kind: 'unavailable',
      reason: `${platform === 'darwin' ? 'Seatbelt' : 'Bubblewrap'} could not enforce the sandbox on this host.`,
    }
  }
}

export function linuxNetworkFilter(architecture: 'x64' | 'arm64'): Buffer {
  const denied = 0x00050001
  const audit = architecture === 'x64' ? 0xc000003e : 0xc00000b7
  const syscalls =
    architecture === 'x64' ? [41, 42, 44, 46, 307, 425] : [198, 203, 206, 211, 269, 425]
  const instructions = [
    { code: 0x20, jt: 0, jf: 0, k: 4 },
    { code: 0x15, jt: 1, jf: 0, k: audit },
    { code: 0x06, jt: 0, jf: 0, k: denied },
    { code: 0x20, jt: 0, jf: 0, k: 0 },
    { code: 0x35, jt: 0, jf: 1, k: 0x40000000 },
    { code: 0x06, jt: 0, jf: 0, k: denied },
    ...syscalls.flatMap((k) => [
      { code: 0x15, jt: 0, jf: 1, k },
      { code: 0x06, jt: 0, jf: 0, k: denied },
    ]),
    { code: 0x06, jt: 0, jf: 0, k: 0x7fff0000 },
  ]
  const output = Buffer.alloc(instructions.length * 8)
  instructions.forEach((instruction, index) => {
    const offset = index * 8
    output.writeUInt16LE(instruction.code, offset)
    output.writeUInt8(instruction.jt, offset + 2)
    output.writeUInt8(instruction.jf, offset + 3)
    output.writeUInt32LE(instruction.k, offset + 4)
  })
  return output
}

async function metadataPaths(workspace: string): Promise<string[]> {
  const paths = new Set([join(workspace, '.git')])
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.name === '.git') paths.add(path)
      else if (entry.isDirectory() && entry.name !== 'node_modules') await walk(path)
    }
  }
  await walk(workspace)
  return [...paths]
}

function quoteArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function seatbeltProfile(workspace: string, scratch: string, metadata: readonly string[]): string {
  const quote = (path: string) => JSON.stringify(path)
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    `(allow file-write* (subpath ${quote(workspace)}) (subpath ${quote(scratch)}) (literal "/dev/null") (literal "/dev/zero") (literal "/dev/stdout") (literal "/dev/stderr"))`,
    ...metadata.map((path) => `(deny file-write* (subpath ${quote(path)}))`),
  ].join('\n')
}

export async function prepareSandboxLaunch(command: string, cwd: string): Promise<SandboxLaunch> {
  const backend = await detectVerificationSandbox()
  if (backend.kind === 'unavailable')
    throw new Error(
      `Verification sandbox unavailable: ${backend.reason} No command ran. Select an unsandboxed profile explicitly only when authorized.`,
    )
  const workspace = await realpath(cwd)
  if (dirname(workspace) === workspace)
    throw new Error('Verification sandbox refuses a filesystem root as its writable workspace.')
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'pstack-verification-')))
  const env = sandboxEnvironment(scratch)
  try {
    const metadata = await metadataPaths(workspace)
    let executable = backend.executable
    let args: string[]
    if (backend.kind === 'macos-seatbelt') {
      args = [
        '-p',
        seatbeltProfile(workspace, scratch, metadata),
        '/bin/bash',
        '--noprofile',
        '--norc',
        '-c',
        command,
      ]
    } else {
      args = [
        '--die-with-parent',
        '--unshare-all',
        '--new-session',
        '--cap-drop',
        'ALL',
        '--ro-bind',
        '/',
        '/',
        '--bind',
        workspace,
        workspace,
        '--bind',
        scratch,
        scratch,
        '--dev',
        '/dev',
        '--proc',
        '/proc',
        '--chdir',
        workspace,
      ]
      for (const path of metadata) {
        try {
          await access(path)
          args.push('--ro-bind', path, path)
        } catch {}
      }
      const filter = join(scratch, 'network.bpf')
      await writeFile(filter, linuxNetworkFilter(backend.architecture))
      args.push('--seccomp', '3', '/bin/bash', '--noprofile', '--norc', '-c', command)
      const quoted = [backend.executable, ...args].map(quoteArgument).join(' ')
      executable = '/bin/bash'
      args = ['--noprofile', '--norc', '-c', `exec 3<${quoteArgument(filter)}; exec ${quoted}`]
    }
    return {
      executable,
      args,
      cwd: workspace,
      scratch,
      env,
      dispose: () => rm(scratch, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(scratch, { recursive: true, force: true })
    throw error
  }
}
