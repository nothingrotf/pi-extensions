import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { Type } from 'typebox'
import { Value } from 'typebox/value'

const repoRoot = resolve(import.meta.dirname, '..')
const packagesDir = join(repoRoot, 'packages')
const globalAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
const defaultProfileDir = join(repoRoot, '.pi-local', 'agent')
const sharedFiles = ['auth.json', 'models.json', 'themes', 'trust.json']

function write(line: string): void {
  process.stdout.write(`${line}\n`)
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function packagePaths(): string[] {
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesDir, entry.name))
    .filter((path) => existsSync(join(path, 'package.json')))
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
}

function rank(path: string): number {
  return path.endsWith('/pstack') ? 1 : 0
}

function runPi(args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync('pi', args, { env, stdio: 'inherit' })
  if (result.status !== 0) fail(`pi ${args.join(' ')} failed.`)
}

const PackageSourcesSchema = Type.Array(
  Type.Union([
    Type.String(),
    Type.Object({ source: Type.String() }, { additionalProperties: true }),
  ]),
)
const StringSchema = Type.String()

function localPackages(agentDir: string, scope: 'legacy' | 'all'): string[] {
  const path = join(agentDir, 'settings.json')
  if (!existsSync(path)) return []
  const settings = parseSettings(readFileSync(path, 'utf8'))
  const packages = settings.get('packages') ?? []
  if (!Value.Check(PackageSourcesSchema, packages)) fail('The settings packages list is invalid.')
  const managed = new Set(packagePaths())
  if (scope === 'all') managed.add(repoRoot)
  const found = packages.map((entry) => {
    const source = Value.Check(StringSchema, entry) ? entry : entry.source
    const expanded = source.startsWith('~/') ? join(homedir(), source.slice(2)) : source
    return resolve(agentDir, expanded)
  })
  return [...new Set(found.filter((source) => managed.has(source)))]
}

function backupSettings(agentDir: string): void {
  const path = join(agentDir, 'settings.json')
  if (!existsSync(path)) return
  const backup = `${path}.pi-extensions-${randomUUID()}.bak`
  copyFileSync(path, backup)
  write(`Settings backup: ${backup}`)
}

function install(agentDir: string | undefined): void {
  const directory = resolve(agentDir ?? globalAgentDir)
  const legacy = localPackages(directory, 'legacy')
  const env = { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: '1' }
  backupSettings(directory)
  runPi(['install', repoRoot], env)
  for (const path of legacy) runPi(['remove', path], env)
  write('All local extensions now load through one repository entry. Run /reload in Pi.')
}

function remove(agentDir: string | undefined): void {
  const directory = resolve(agentDir ?? globalAgentDir)
  const installed = localPackages(directory, 'all')
  if (installed.length === 0) {
    write('No local extension packages are configured.')
    return
  }
  const env = { ...process.env, PI_CODING_AGENT_DIR: directory, PI_OFFLINE: '1' }
  backupSettings(directory)
  for (const path of installed) runPi(['remove', path], env)
}

const SettingsSchema = Type.Object({}, { additionalProperties: Type.Unknown() })

function parseSettings(text: string): Map<string, unknown> {
  const parsed: unknown = JSON.parse(text)
  if (!Value.Check(SettingsSchema, parsed)) fail('The global settings.json is not an object.')
  return new Map(Object.entries(parsed))
}

function profile(profileDir: string): void {
  mkdirSync(profileDir, { recursive: true })
  for (const name of sharedFiles) {
    const source = join(globalAgentDir, name)
    const target = join(profileDir, name)
    if (existsSync(source) && !existsSync(target)) symlinkSync(source, target)
  }
  const globalSettingsPath = join(globalAgentDir, 'settings.json')
  const settings = existsSync(globalSettingsPath)
    ? parseSettings(readFileSync(globalSettingsPath, 'utf8'))
    : new Map<string, unknown>()
  settings.set('packages', [repoRoot])
  settings.set('subagents', { disableBuiltins: true })
  writeFileSync(
    join(profileDir, 'settings.json'),
    `${JSON.stringify(Object.fromEntries(settings), null, 2)}\n`,
  )
  write(`Profile ready at ${profileDir}`)
  write('Launch Pi with the full local stack:')
  write('')
  write(`  PI_CODING_AGENT_DIR=${profileDir} pi`)
}

const [command, argument] = process.argv.slice(2)
if (command === 'install') install(argument)
else if (command === 'remove') remove(argument)
else if (command === 'profile') profile(resolve(argument ?? defaultProfileDir))
else {
  write('Usage:')
  write(
    '  bun run pi:install [agentDir]   Install the repository bundle and migrate individual entries',
  )
  write('  bun run pi:remove [agentDir]    Remove the bundle and legacy local entries')
  write('  bun run pi:profile [dir]        Create an isolated Pi profile with the full local stack')
  process.exit(command === undefined ? 0 : 1)
}
