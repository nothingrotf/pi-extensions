import { spawnSync } from 'node:child_process'
import {
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

function install(agentDir: string | undefined): void {
  const env =
    agentDir === undefined ? process.env : { ...process.env, PI_CODING_AGENT_DIR: agentDir }
  for (const path of packagePaths()) runPi(['install', path], env)
}

function remove(agentDir: string | undefined): void {
  const env =
    agentDir === undefined ? process.env : { ...process.env, PI_CODING_AGENT_DIR: agentDir }
  for (const path of packagePaths()) runPi(['remove', path], env)
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
  settings.set('packages', packagePaths())
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
  write('  bun run pi:install [agentDir]   Add every workspace package to the Pi settings')
  write('  bun run pi:remove [agentDir]    Remove every workspace package from the Pi settings')
  write('  bun run pi:profile [dir]        Create an isolated Pi profile with the full local stack')
  process.exit(command === undefined ? 0 : 1)
}
