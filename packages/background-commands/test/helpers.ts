import { watch } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach } from 'vite-plus/test'

import {
  createBackgroundCommands,
  type BackgroundCommands,
  type CommandHandle,
} from '../src/headless.ts'
import {
  isTerminal,
  type CommandCompletion,
  type CommandSnapshot,
  type StartCommand,
} from '../src/schema.ts'
import type { CommandContext } from '../src/shell.ts'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

export async function commandFixture(
  context?: CommandContext,
): Promise<{ directory: string; service: BackgroundCommands; completions: CommandCompletion[] }> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-background-test-'))
  const service = createBackgroundCommands({
    sessionId: 'background-test',
    getContext: () => context ?? { cwd: directory },
  })
  const completions: CommandCompletion[] = []
  service.bindCompletion({
    deliver: (completion) => {
      completions.push(completion)
    },
  })
  cleanups.push(async () => {
    await service.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  return { directory, service, completions }
}

export function start(service: BackgroundCommands, input: StartCommand): CommandHandle {
  const result = service.start(input)
  if (!result.ok) throw result.error
  return result.value
}

export function waitForCommand(
  service: BackgroundCommands,
  handle: CommandHandle,
): Promise<CommandSnapshot> {
  if (isTerminal(handle.snapshot())) return Promise.resolve(handle.snapshot())
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Command ${handle.id} did not settle`))
    }, 5000)
    const unsubscribe = service.onChange(() => {
      const snapshot = handle.snapshot()
      if (!isTerminal(snapshot)) return
      clearTimeout(timer)
      unsubscribe()
      resolve(snapshot)
    })
  })
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function nodeCommand(script: string): string {
  return `${shellQuote(process.execPath)} -e ${shellQuote(script)}`
}

export function readyFile(directory: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const watcher = watch(directory, async (_event, name) => {
      if (name !== file) return
      clearTimeout(timer)
      watcher.close()
      try {
        resolve(await readFile(join(directory, file), 'utf8'))
      } catch (error) {
        reject(error)
      }
    })
    const timer = setTimeout(() => {
      watcher.close()
      reject(new Error(`No readiness file ${file}`))
    }, 5000)
  })
}
