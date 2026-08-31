import { spawn } from 'node:child_process'

import type { Watch } from './machine.ts'

const maximumBufferedLineLength = 65_536

export type LoopWatcher = {
  isRunning(): boolean
  stop(): void
}

type WatcherCallbacks = {
  wake(): void
  exit(): void
}

export function validateWatch(watch: Watch): string | null {
  if (watch.command.trim().length === 0) {
    return 'A watcher command cannot be blank.'
  }
  if (watch.pattern !== null) {
    try {
      new RegExp(watch.pattern)
    } catch {
      return 'The watcher pattern is not a valid regular expression.'
    }
  }
  return null
}

export function startWatcher(watch: Watch, cwd: string, callbacks: WatcherCallbacks): LoopWatcher {
  const pattern = watch.pattern === null ? null : new RegExp(watch.pattern)
  const child = spawn(watch.command, {
    cwd,
    detached: process.platform !== 'win32',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let active = true
  let woke = false
  let buffer = ''

  const wake = () => {
    if (!active || woke) {
      return
    }
    woke = true
    callbacks.wake()
  }

  const consume = (chunk: Buffer) => {
    if (pattern === null || woke) {
      return
    }
    const lines = `${buffer}${chunk.toString('utf8')}`.split(/\r?\n/)
    buffer = (lines.pop() ?? '').slice(-maximumBufferedLineLength)
    for (const line of lines) {
      if (pattern.test(line)) {
        wake()
        return
      }
    }
  }

  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  child.once('close', (code) => {
    if (pattern !== null && buffer.length > 0 && pattern.test(buffer)) {
      wake()
    }
    if (pattern === null && code === 0) {
      wake()
    }
    active = false
    callbacks.exit()
  })
  child.once('error', () => {
    active = false
    callbacks.exit()
  })

  return {
    isRunning: () => active,
    stop() {
      if (!active) {
        return
      }
      active = false
      const pid = child.pid
      if (pid !== undefined && process.platform !== 'win32') {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      } else {
        child.kill('SIGTERM')
      }
    },
  }
}
