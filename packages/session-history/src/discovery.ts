import type { Stats } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { join } from 'node:path'

import { parseSessionEntries, type SessionInfo } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

import { fileVersion, sessionBatches } from './session-file.ts'
import { HistoryWork, historyLimits, WorkLimitError } from './work.ts'

const HeaderSchema = Type.Object({
  type: Type.Literal('session'),
  id: Type.String({ minLength: 1 }),
  cwd: Type.String(),
  timestamp: Type.String(),
  parentSession: Type.Optional(Type.String()),
})
const StringSchema = Type.String()
const NumberSchema = Type.Number()

function detached(value: string): string {
  return Buffer.from(value, 'utf16le').toString('utf16le')
}

interface CachedInfo {
  version: string
  info: SessionInfo
  bytes: number
}

export class SessionDiscovery {
  private readonly cache = new Map<string, CachedInfo>()
  private bytes = 0

  clear(): void {
    this.cache.clear()
    this.bytes = 0
  }

  diagnostics() {
    return { entries: this.cache.size, estimatedBytes: this.bytes, maximumBytes: 2 * 1024 * 1024 }
  }

  async files(directory: string, work: HistoryWork): Promise<string[]> {
    const files: string[] = []
    let directoryHandle
    try {
      directoryHandle = await opendir(directory)
    } catch {
      this.clear()
      return files
    }
    for await (const entry of directoryHandle) {
      work.check()
      if (!entry.name.endsWith('.jsonl')) continue
      if (files.length >= historyLimits.discoverySessions) throw new WorkLimitError()
      files.push(join(directory, entry.name))
    }
    const present = new Set(files)
    for (const [path, cached] of this.cache) {
      if (!present.has(path)) {
        this.cache.delete(path)
        this.bytes -= cached.bytes
      }
    }
    return files.sort()
  }

  async info(
    path: string,
    stats: Stats,
    work: HistoryWork,
    onMalformed?: (session: { id: string; cwd: string }) => void,
  ): Promise<SessionInfo | null> {
    const version = fileVersion(stats)
    const cached = this.cache.get(path)
    if (cached?.version === version) return cached.info
    if (cached !== undefined) {
      this.cache.delete(path)
      this.bytes -= cached.bytes
    }
    let header
    let name: string | undefined
    let firstMessage = ''
    let messageCount = 0
    let activity = 0
    for await (const batch of sessionBatches(path, work, version)) {
      for (const line of batch) {
        if (line.trim().length === 0) continue
        const entry = parseSessionEntries(line)[0]
        if (entry?.type === undefined) {
          if (header !== undefined) onMalformed?.({ id: header.id, cwd: header.cwd })
          return null
        }
        if (header === undefined) {
          if (!Value.Check(HeaderSchema, entry)) return null
          header = entry
          continue
        }
        if (entry.type === 'session_info')
          name = Value.Check(StringSchema, entry.name)
            ? detached(entry.name.trim()) || undefined
            : undefined
        if (entry.type !== 'message') continue
        messageCount += 1
        const message = entry.message
        if (message?.role !== 'user' && message?.role !== 'assistant') continue
        const date = Value.Check(NumberSchema, message.timestamp)
          ? message.timestamp
          : Date.parse(entry.timestamp)
        if (Number.isFinite(date)) activity = Math.max(activity, date)
        if (firstMessage.length > 0 || message.role !== 'user') continue
        firstMessage = detached(
          Value.Check(StringSchema, message.content)
            ? message.content.slice(0, 241)
            : message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join(' ')
                .slice(0, 241),
        )
      }
    }
    if (header === undefined || !Number.isFinite(Date.parse(header.timestamp))) return null
    const info: SessionInfo = {
      path,
      id: header.id,
      cwd: header.cwd,
      created: new Date(header.timestamp),
      modified: activity > 0 ? new Date(activity) : new Date(header.timestamp),
      messageCount,
      firstMessage: firstMessage || '(no messages)',
      allMessagesText: '',
    }
    if (name !== undefined) info.name = name
    if (header.parentSession !== undefined) info.parentSessionPath = header.parentSession
    const bytes =
      512 +
      2 *
        (path.length +
          info.cwd.length +
          info.id.length +
          (name?.length ?? 0) +
          info.firstMessage.length +
          (info.parentSessionPath?.length ?? 0))
    if (bytes <= 2 * 1024 * 1024) {
      this.cache.set(path, { version, info, bytes })
      this.bytes += bytes
      while (this.bytes > 2 * 1024 * 1024) {
        const oldest = this.cache.entries().next().value
        if (oldest === undefined) break
        this.cache.delete(oldest[0])
        this.bytes -= oldest[1].bytes
      }
    }
    return info
  }
}
