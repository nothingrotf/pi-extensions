import type { Stats } from 'node:fs'
import { lstat, open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

import { HistoryWork, historyLimits, WorkLimitError } from './work.ts'

export function fileVersion(value: Stats): string {
  return `${value.dev}:${value.ino}:${value.size}:${value.mtimeMs}:${value.ctimeMs}`
}

export class SessionChangedError extends Error {
  readonly code = 'SESSION_CHANGED'
  constructor() {
    super('The session changed during the request. Retry to read a consistent snapshot.')
  }
}

export async function sessionHeaderLine(
  path: string,
  work: HistoryWork,
  expectedVersion: string,
): Promise<string> {
  work.check()
  const handle = await open(path, 'r')
  try {
    const initial = await handle.stat()
    if (!initial.isFile() || fileVersion(initial) !== expectedVersion)
      throw new SessionChangedError()
    const buffer = Buffer.alloc(historyLimits.headerBytes)
    let length = 0
    let start = 0
    let end: number | undefined
    while (length < buffer.length && end === undefined) {
      work.check()
      const { bytesRead } = await handle.read(
        buffer,
        length,
        Math.min(1024, buffer.length - length),
        null,
      )
      work.read(bytesRead)
      if (bytesRead === 0) {
        end = length
        break
      }
      length += bytesRead
      let newline = buffer.indexOf(10, start)
      while (newline >= 0 && newline < length) {
        if (buffer.toString('utf8', start, newline).trim().length > 0) {
          end = newline
          break
        }
        start = newline + 1
        newline = buffer.indexOf(10, start)
      }
    }
    if (end === undefined) throw new WorkLimitError()
    const ending = await lstat(path).catch(() => {
      throw new SessionChangedError()
    })
    if (!ending.isFile() || fileVersion(ending) !== expectedVersion) throw new SessionChangedError()
    work.check()
    return buffer.toString('utf8', start, end)
  } finally {
    await handle.close()
  }
}

export async function* sessionBatches(path: string, work: HistoryWork, expectedVersion?: string) {
  work.check()
  const handle = await open(path, 'r')
  try {
    const initial = await handle.stat()
    const version = fileVersion(initial)
    if (expectedVersion !== undefined && version !== expectedVersion)
      throw new SessionChangedError()
    if (initial.size > historyLimits.fileBytes) throw new WorkLimitError()
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const decoder = new StringDecoder('utf8')
    let pieces: string[] = []
    let lineLength = 0
    let total = 0
    while (true) {
      work.check()
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      work.read(bytesRead)
      if (total > historyLimits.fileBytes) throw new WorkLimitError()
      const text = decoder.write(buffer.subarray(0, bytesRead))
      const lines: string[] = []
      let start = 0
      while (start < text.length) {
        const newline = text.indexOf('\n', start)
        const end = newline < 0 ? text.length : newline
        pieces.push(text.slice(start, end))
        lineLength += end - start
        if (lineLength > historyLimits.fileBytes) throw new WorkLimitError()
        if (newline < 0) break
        work.check()
        lines.push(pieces.join(''))
        pieces = []
        lineLength = 0
        start = newline + 1
      }
      if (lines.length > 0) yield lines
    }
    pieces.push(decoder.end())
    work.check()
    if (lineLength > 0) yield [pieces.join('')]
    const ending = await stat(path).catch(() => {
      throw new SessionChangedError()
    })
    if (version !== fileVersion(ending)) throw new SessionChangedError()
  } finally {
    await handle.close()
  }
}

export async function* sessionLines(path: string, work: HistoryWork, expectedVersion?: string) {
  for await (const batch of sessionBatches(path, work, expectedVersion)) {
    for (const line of batch) {
      work.check()
      yield line
    }
  }
}
