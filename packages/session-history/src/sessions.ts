import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  getAgentDir,
  type SessionEntry,
  type SessionInfo,
  type SessionManager,
} from '@earendil-works/pi-coding-agent'

import { SessionDiscovery } from './discovery.ts'
import { limitNormalizedEntries, normalizeEntries, type NormalizedEntry } from './normalize.ts'
import { decodeCursor, fingerprint, paginate } from './pagination.ts'
import { sessionReference } from './references.ts'
import { invalidRelationships } from './relationships.ts'
import type { SessionHistoryInput } from './schema.ts'
import { canonicalPath, filterProjectSessions } from './scope.ts'
import { type SearchFilters, searchSessions } from './search.ts'
import { fileVersion, SessionChangedError } from './session-file.ts'
import { readSnapshot, SnapshotError } from './snapshot.ts'
import { pairToolResults } from './tool-evidence.ts'
import { HistoryWork, historyLimits, WorkLimitError } from './work.ts'

const maximumCachedBytes = 16 * 1024 * 1024

interface SessionRecord {
  id: string
  name: string
  path: string
  cwd: string
  created: string
  modified: string
  fileVersion: string
  messageCount: number
  firstMessage: string
  firstMessageTruncated: boolean
  parentId: string | null
  isChild: boolean
}

type CurrentSessionManager = Pick<
  SessionManager,
  | 'buildContextEntries'
  | 'getBranch'
  | 'getCwd'
  | 'getEntries'
  | 'getHeader'
  | 'getSessionDir'
  | 'getSessionFile'
  | 'getSessionId'
  | 'getSessionName'
>

interface LoadedSession {
  normalizedAudit: NormalizedEntry[]
  normalizedActive: NormalizedEntry[]
  searchEntries: NormalizedEntry[]
}

function activeEntries(
  audit: readonly NormalizedEntry[],
  context: readonly SessionEntry[],
): NormalizedEntry[] {
  const byId = new Map<string, NormalizedEntry[]>()
  for (const entry of audit) {
    const blocks = byId.get(entry.id) ?? []
    blocks.push(entry)
    byId.set(entry.id, blocks)
  }
  return context.flatMap((entry) => byId.get(entry.id) ?? [])
}

interface CacheEntry {
  key: string
  bytes: number
  loaded: LoadedSession
}

export interface HistoryResponse {
  action: SessionHistoryInput['action']
  limits: {
    itemLimit: number
    itemCharacterLimit: number
    responseCharacterLimit: number
    sessionLimit: number
    work: typeof historyLimits
  }
  pagination: {
    cursor: string | null
    offset: number
    total: number
  }
  truncated: boolean
  redacted: boolean
  skippedSessions: number
  omittedSessions: number
  data: readonly object[]
}

export class HistoryError extends Error {
  constructor(
    readonly code:
      | 'ENTRY_NOT_FOUND'
      | 'INVALID_CURSOR'
      | 'INVALID_QUERY'
      | 'MALFORMED_SESSION'
      | 'OUT_OF_SCOPE'
      | 'RESULT_LIMIT_EXCEEDED'
      | 'SESSION_NOT_FOUND'
      | 'UNSUPPORTED_SESSION_VERSION',
    message: string,
  ) {
    super(message)
  }
}

async function parentIdFor(
  info: SessionInfo,
  idsByPath: ReadonlyMap<string, string>,
): Promise<string | null> {
  if (info.parentSessionPath === undefined) return null
  return idsByPath.get(await canonicalPath(info.parentSessionPath)) ?? null
}

function dateAllowed(record: SessionRecord, after?: string, before?: string): boolean {
  const created = Date.parse(record.created)
  return (
    (after === undefined || created >= Date.parse(after)) &&
    (before === undefined || created <= Date.parse(before))
  )
}

function response(
  action: SessionHistoryInput['action'],
  limit: number,
  page: { nextCursor: string | null; offset: number; total: number },
  data: readonly object[],
  normalized: readonly NormalizedEntry[] = [],
  skippedSessions = 0,
  omittedSessions = 0,
): HistoryResponse {
  return {
    action,
    limits: {
      itemLimit: limit,
      itemCharacterLimit: 2_000,
      responseCharacterLimit: 200_000,
      sessionLimit: historyLimits.sessions,
      work: historyLimits,
    },
    pagination: { cursor: page.nextCursor, offset: page.offset, total: page.total },
    truncated:
      page.nextCursor !== null ||
      skippedSessions > 0 ||
      omittedSessions > 0 ||
      normalized.some((entry) => entry.truncated),
    redacted: normalized.some((entry) => entry.redacted),
    skippedSessions,
    omittedSessions,
    data,
  }
}

export class SessionHistoryStore {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly discovery = new SessionDiscovery()
  private cacheBytes = 0
  private malformedSessionCount = 0
  private invalidSessionIds = new Set<string>()
  private malformedFileSessionIds = new Set<string>()

  constructor(
    private readonly current: CurrentSessionManager,
    private readonly inspectFile: (path: string) => Promise<Stats> = (path) => stat(path),
  ) {}

  cacheDiagnostics() {
    return {
      entries: this.cache.size,
      estimatedBytes: this.cacheBytes,
      maximumBytes: maximumCachedBytes,
      metadata: this.discovery.diagnostics(),
    }
  }

  clearCache(): void {
    this.discovery.clear()
    this.cache.clear()
    this.cacheBytes = 0
  }

  usesCurrent(current: CurrentSessionManager): boolean {
    return this.current === current
  }

  private async records(work: HistoryWork): Promise<SessionRecord[]> {
    const cwd = this.current.getCwd()
    const directory =
      this.current.getSessionDir() ||
      join(
        getAgentDir(),
        'sessions',
        `--${resolve(cwd)
          .replace(/^[/\\\\]/, '')
          .replace(/[/\\\\:]/g, '-')}--`,
      )
    const candidates: SessionInfo[] = []
    const malformed: { id: string; cwd: string }[] = []
    const versions = new Map<string, string>()
    this.malformedSessionCount = 0
    const paths = await this.discovery.files(directory, work)
    for (let start = 0; start < paths.length; start += historyLimits.concurrentFiles) {
      const batch = paths.slice(start, start + historyLimits.concurrentFiles)
      const inspected = await Promise.allSettled(
        batch.map(async (path) => {
          const stats = await this.inspectFile(path)
          const info = await this.discovery.info(path, stats, work, (session) => {
            if (path !== this.current.getSessionFile()) malformed.push(session)
          })
          return { info, version: fileVersion(stats) }
        }),
      )
      for (const [index, result] of inspected.entries()) {
        work.check()
        if (result.status === 'rejected') {
          if (result.reason instanceof WorkLimitError) throw result.reason
          if (batch[index] !== this.current.getSessionFile()) this.malformedSessionCount += 1
        } else if (result.value.info === null) {
          this.malformedSessionCount += 1
        } else {
          candidates.push(result.value.info)
          versions.set(result.value.info.path, result.value.version)
        }
      }
    }
    this.malformedFileSessionIds = new Set(
      (await filterProjectSessions(malformed, cwd)).map((session) => session.id),
    )
    const scoped = await filterProjectSessions(candidates, cwd)
    const idsByPath = new Map<string, string>()
    for (const info of scoped) idsByPath.set(await canonicalPath(info.path), info.id)
    const currentFile = this.current.getSessionFile()
    if (currentFile !== undefined) {
      idsByPath.set(await canonicalPath(currentFile), this.current.getSessionId())
    }
    const inspected = await Promise.all(
      scoped.map(async (info) => {
        const version = versions.get(info.path)
        if (version === undefined) return null
        const parentId = await parentIdFor(info, idsByPath)
        return {
          id: info.id,
          name: info.name ?? 'Untitled session',
          path: info.path,
          cwd: info.cwd,
          created: info.created.toISOString(),
          modified: info.modified.toISOString(),
          fileVersion: version,
          messageCount: info.messageCount,
          firstMessage: info.firstMessage.slice(0, 240),
          firstMessageTruncated: info.firstMessage.length > 240,
          parentId,
          isChild: info.parentSessionPath !== undefined,
        }
      }),
    )
    const records = inspected.filter((record) => record !== null)
    const currentEntries = this.current.getEntries()
    const currentId = this.current.getSessionId()
    const currentHeader = this.current.getHeader()
    const currentModified = currentEntries.at(-1)?.timestamp ?? currentHeader?.timestamp
    const activeBranchIds = new Set(this.current.getBranch().map((entry) => entry.id))
    const firstUser = currentEntries.find(
      (entry) => entry.type === 'message' && entry.message.role === 'user',
    )
    const firstMessage =
      firstUser === undefined
        ? undefined
        : normalizeEntries([firstUser], currentId, activeBranchIds)[0]?.content
    const currentVersion = `live:${currentEntries.length}:${currentEntries.at(-1)?.id ?? 'empty'}:${currentModified ?? 'unknown'}:${this.current.getBranch().at(-1)?.id ?? 'root'}`
    const existingCurrent = records.find((record) => record.id === currentId)
    if (existingCurrent === undefined) {
      records.push({
        id: currentId,
        name: this.current.getSessionName() ?? 'Untitled session',
        path: currentFile ?? '',
        cwd: this.current.getCwd(),
        created: currentHeader?.timestamp ?? new Date(0).toISOString(),
        modified: currentModified ?? new Date(0).toISOString(),
        fileVersion: currentVersion,
        messageCount: currentEntries.filter((entry) => entry.type === 'message').length,
        firstMessage: firstMessage?.slice(0, 240) ?? '',
        firstMessageTruncated: (firstMessage?.length ?? 0) > 240,
        parentId:
          currentHeader?.parentSession === undefined
            ? null
            : (idsByPath.get(await canonicalPath(currentHeader.parentSession)) ?? null),
        isChild: currentHeader?.parentSession !== undefined,
      })
    } else {
      existingCurrent.name = this.current.getSessionName() ?? 'Untitled session'
      existingCurrent.fileVersion = currentVersion
      existingCurrent.messageCount = currentEntries.filter(
        (entry) => entry.type === 'message',
      ).length
      existingCurrent.firstMessage = firstMessage?.slice(0, 240) ?? ''
      existingCurrent.firstMessageTruncated = (firstMessage?.length ?? 0) > 240
      existingCurrent.modified = currentModified ?? existingCurrent.modified
    }
    const availableIds = new Set(records.map((record) => record.id))
    for (const record of records) {
      if (record.parentId !== null && !availableIds.has(record.parentId)) record.parentId = null
    }
    this.invalidSessionIds = invalidRelationships(records)
    const valid = records.filter((record) => !this.invalidSessionIds.has(record.id))
    this.malformedSessionCount += records.length - valid.length
    const availablePaths = new Set(valid.map((record) => record.path))
    for (const [path, cached] of this.cache) {
      if (!availablePaths.has(path)) {
        this.cache.delete(path)
        this.cacheBytes -= cached.bytes
      }
    }
    return valid
  }

  private visibleRecord(records: readonly SessionRecord[], sessionId: string): SessionRecord {
    if (this.malformedFileSessionIds.has(sessionId)) {
      throw new HistoryError('MALFORMED_SESSION', 'The session file is malformed.')
    }
    if (this.invalidSessionIds.has(sessionId)) {
      throw new HistoryError('MALFORMED_SESSION', 'The session has invalid or ambiguous ancestry.')
    }
    const record = records.find((candidate) => candidate.id === sessionId)
    if (record === undefined) {
      throw new HistoryError('OUT_OF_SCOPE', 'The session is not visible in the current project.')
    }
    return record
  }

  private mainSessionId(records: readonly SessionRecord[], record: SessionRecord): string | null {
    if (!record.isChild || record.parentId === null) return null
    const byId = new Map(records.map((candidate) => [candidate.id, candidate]))
    let mainId = record.parentId
    let parentId = byId.get(mainId)?.parentId ?? null
    while (parentId !== null) {
      mainId = parentId
      parentId = byId.get(mainId)?.parentId ?? null
    }
    return mainId
  }

  private descendants(records: readonly SessionRecord[], sessionId: string): SessionRecord[] {
    const result: SessionRecord[] = []
    const pending = [sessionId]
    while (pending.length > 0) {
      const parent = pending.shift()
      if (parent === undefined) break
      for (const record of records) {
        if (record.parentId === parent && !result.some((item) => item.id === record.id)) {
          result.push(record)
          pending.push(record.id)
        }
      }
    }
    return result
  }

  private async normalize(
    entries: readonly SessionEntry[],
    id: string,
    activeIds: ReadonlySet<string>,
    work: HistoryWork,
  ): Promise<NormalizedEntry[]> {
    const result: NormalizedEntry[] = []
    for (let start = 0; start < entries.length; start += 128) {
      await work.yield()
      const batch = entries.slice(start, start + 128)
      for (const entry of batch) {
        work.normalize(
          entry.type === 'message' && entry.message.role === 'assistant'
            ? entry.message.content.length
            : 1,
        )
      }
      for (const entry of normalizeEntries(batch, id, activeIds, true)) result.push(entry)
    }
    return result
  }

  private async load(record: SessionRecord, work: HistoryWork): Promise<LoadedSession> {
    work.check()
    if (record.id === this.current.getSessionId()) {
      const entries = this.current.getEntries()
      const activeBranchIds = new Set(this.current.getBranch().map((entry) => entry.id))
      const searchEntries = await this.normalize(entries, record.id, activeBranchIds, work)
      const normalizedAudit = limitNormalizedEntries(searchEntries)
      return {
        normalizedAudit,
        normalizedActive: activeEntries(normalizedAudit, this.current.buildContextEntries()),
        searchEntries,
      }
    }
    let fileStat
    try {
      fileStat = await this.inspectFile(record.path)
    } catch {
      throw new HistoryError('SESSION_NOT_FOUND', 'The session no longer exists.')
    }
    const key = fileVersion(fileStat)
    if (key !== record.fileVersion) throw new SessionChangedError()
    const cached = this.cache.get(record.path)
    if (cached?.key === key) {
      work.normalize(cached.loaded.searchEntries.length + cached.loaded.normalizedActive.length)
      await work.yield()
      this.cache.delete(record.path)
      this.cache.set(record.path, cached)
      return cached.loaded
    }
    let snapshot
    try {
      snapshot = await readSnapshot(record.path, record.id, work, record.fileVersion)
    } catch (error) {
      work.check()
      if (error instanceof WorkLimitError || error instanceof SessionChangedError) throw error
      if (error instanceof SnapshotError) throw new HistoryError(error.code, error.message)
      throw new HistoryError('MALFORMED_SESSION', 'The session file is malformed.')
    }
    if (snapshot.cwd !== record.cwd) throw new SessionChangedError()
    const activeBranchIds = snapshot.activeIds
    const searchEntries = await this.normalize(snapshot.entries, record.id, activeBranchIds, work)
    const normalizedAudit = limitNormalizedEntries(searchEntries)
    const loaded = {
      normalizedAudit,
      normalizedActive: activeEntries(normalizedAudit, snapshot.context),
      searchEntries,
    }
    if (cached !== undefined) {
      this.cache.delete(record.path)
      this.cacheBytes -= cached.bytes
    }
    const bytes = [loaded.searchEntries, loaded.normalizedAudit, loaded.normalizedActive].reduce(
      (total, entries) =>
        total +
        entries.reduce(
          (sum, entry) =>
            sum +
            256 +
            2 *
              (entry.content.length +
                entry.id.length +
                entry.reference.length +
                entry.date.length +
                (entry.parentId?.length ?? 0) +
                (entry.toolCallId?.length ?? 0) +
                (entry.toolName?.length ?? 0)),
          0,
        ),
      0,
    )
    if (Math.max(fileStat.size, bytes) > maximumCachedBytes) return loaded
    this.cache.set(record.path, { key, bytes, loaded })
    this.cacheBytes += bytes
    while (this.cacheBytes > maximumCachedBytes) {
      const oldest = this.cache.entries().next().value
      if (oldest === undefined) break
      this.cache.delete(oldest[0])
      this.cacheBytes -= oldest[1].bytes
    }
    return loaded
  }

  private historyFingerprint(records: readonly SessionRecord[], action: string): string {
    return fingerprint(
      `${action}:${records
        .map((record) => `${record.id}:${record.fileVersion}`)
        .sort()
        .join('|')}`,
    )
  }

  async execute(input: SessionHistoryInput, signal?: AbortSignal): Promise<HistoryResponse> {
    signal?.throwIfAborted()
    const work = new HistoryWork(signal)
    const records = await this.records(work)
    work.check()
    if (input.action === 'list') return this.list(records, input)
    if (input.action === 'search') return this.search(records, input, work)
    if (input.action === 'read') return this.read(records, input, work)
    if (input.action === 'timeline') return this.timeline(records, input, work)
    return this.toolActivity(records, input, work)
  }

  private list(
    records: readonly SessionRecord[],
    input: Extract<SessionHistoryInput, { action: 'list' }>,
  ): HistoryResponse {
    const limit = input.limit ?? 20
    const currentId = this.current.getSessionId()
    const selected = records
      .filter((record) => input.include_current === true || record.id !== currentId)
      .filter((record) => input.include_children === true || !record.isChild)
      .filter((record) => dateAllowed(record, input.created_after, input.created_before))
      .sort(
        (left, right) =>
          Date.parse(right.modified) - Date.parse(left.modified) || left.id.localeCompare(right.id),
      )
    const currentFingerprint = this.historyFingerprint(selected, 'list')
    let offset: number
    try {
      offset = decodeCursor(input.cursor, 'list', currentFingerprint)
    } catch {
      throw new HistoryError('INVALID_CURSOR', 'The cursor is invalid or stale.')
    }
    const page = paginate(selected, limit, offset, 'list', currentFingerprint)
    const items = page.items.map((record) => ({
      sessionId: record.id,
      name: record.name.slice(0, 240),
      nameTruncated: record.name.length > 240,
      logicalPath: `sessions/${record.id}`,
      cwd: record.cwd,
      created: record.created,
      modified: record.modified,
      messageCount: record.messageCount,
      firstMessage: record.firstMessage,
      firstMessageTruncated: record.firstMessageTruncated,
      isCurrent: record.id === currentId,
      isChild: record.isChild,
      parentSessionId: record.parentId,
      mainSessionId: this.mainSessionId(records, record),
      reference: sessionReference(record.id),
    }))
    const result = response('list', limit, page, items, [], this.malformedSessionCount)
    result.truncated ||= items.some((item) => item.firstMessageTruncated || item.nameTruncated)
    return result
  }

  private async search(
    records: readonly SessionRecord[],
    input: Extract<SessionHistoryInput, { action: 'search' }>,
    work: HistoryWork,
  ): Promise<HistoryResponse> {
    if (input.query.trim().length > 512 || input.query.trim().split(/\s+/u).length > 64) {
      throw new HistoryError(
        'INVALID_QUERY',
        'A search query supports at most 512 characters and 64 terms.',
      )
    }
    if (input.query.trim().length < 2)
      throw new HistoryError(
        'INVALID_QUERY',
        'A search query needs at least two visible characters.',
      )
    const currentId = this.current.getSessionId()
    let selected = records
      .filter((record) => input.include_current === true || record.id !== currentId)
      .filter((record) => input.include_children === true || !record.isChild)
      .filter((record) => dateAllowed(record, input.created_after, input.created_before))
    if (input.session_ids !== undefined) {
      for (const id of input.session_ids) this.visibleRecord(records, id)
      const requested = new Set(input.session_ids)
      selected = selected.filter((record) => requested.has(record.id))
    }
    const candidates = [...selected].sort(
      (left, right) =>
        Date.parse(right.modified) - Date.parse(left.modified) || left.id.localeCompare(right.id),
    )
    const omittedSessions = Math.max(0, candidates.length - historyLimits.sessions)
    const searchable = []
    let skippedSessions = this.malformedSessionCount
    const selectedCandidates = candidates.slice(0, historyLimits.sessions)
    for (let start = 0; start < selectedCandidates.length; start += historyLimits.concurrentFiles) {
      const loaded = await Promise.allSettled(
        selectedCandidates
          .slice(start, start + historyLimits.concurrentFiles)
          .map(async (record) => ({
            id: record.id,
            name: record.name,
            modified: record.modified,
            entries: (await this.load(record, work)).searchEntries,
          })),
      )
      for (const result of loaded) {
        work.check()
        if (result.status === 'fulfilled') searchable.push(result.value)
        else {
          if (result.reason instanceof WorkLimitError) throw result.reason
          skippedSessions += 1
        }
      }
    }
    const filters: SearchFilters = {}
    if (input.roles !== undefined) filters.roles = input.roles
    if (input.entry_types !== undefined) filters.entryTypes = input.entry_types
    const results = searchSessions(searchable, input.query, filters).map((result) => {
      const record = selected.find((candidate) => candidate.id === result.sessionId)
      return {
        ...result,
        parentSessionId: record?.parentId ?? null,
        mainSessionId: record === undefined ? null : this.mainSessionId(records, record),
      }
    })
    const limit = input.limit ?? 20
    const currentFingerprint = this.historyFingerprint(
      selected,
      `search:${JSON.stringify({ query: input.query, roles: input.roles ?? [], entryTypes: input.entry_types ?? [] })}`,
    )
    let offset: number
    try {
      offset = decodeCursor(input.cursor, 'search', currentFingerprint)
    } catch {
      throw new HistoryError('INVALID_CURSOR', 'The cursor is invalid or stale.')
    }
    const page = paginate(results, limit, offset, 'search', currentFingerprint)
    const pageReferences = new Set(page.items.map((item) => item.reference))
    const pageEntries = searchable.flatMap((session) =>
      session.entries.filter((entry) => pageReferences.has(entry.reference)),
    )
    const result = response(
      'search',
      limit,
      page,
      page.items,
      pageEntries,
      skippedSessions,
      omittedSessions,
    )
    result.truncated ||= omittedSessions > 0 || page.items.some((item) => item.snippetTruncated)
    return result
  }

  private async read(
    records: readonly SessionRecord[],
    input: Extract<SessionHistoryInput, { action: 'read' }>,
    work: HistoryWork,
  ): Promise<HistoryResponse> {
    const record = this.visibleRecord(records, input.session_id)
    const loaded = await this.load(record, work)
    const entries = input.view === 'audit' ? loaded.normalizedAudit : loaded.normalizedActive
    const limit = input.limit ?? 20
    let start = 0
    let end = entries.length
    if (input.entry_id !== undefined) {
      const index = entries.findIndex((entry) => entry.id === input.entry_id)
      if (index < 0)
        throw new HistoryError('ENTRY_NOT_FOUND', 'The entry was not found in the selected view.')
      if (input.direction === 'before') {
        start = Math.max(0, index - limit)
        end = index
      } else if (input.direction === 'after')
        start = entries.findLastIndex((entry) => entry.id === input.entry_id) + 1
      else start = Math.max(0, index - Math.floor(limit / 2))
    }
    const currentFingerprint = this.historyFingerprint(
      [record],
      `read:${JSON.stringify({ view: input.view ?? 'active', entryId: input.entry_id ?? null, direction: input.direction ?? 'around', payloads: input.include_tool_payloads ?? false })}`,
    )
    if (input.cursor !== undefined) {
      try {
        start = decodeCursor(input.cursor, 'read', currentFingerprint)
      } catch {
        throw new HistoryError('INVALID_CURSOR', 'The cursor is invalid or stale.')
      }
    }
    const page = paginate(entries.slice(0, end), limit, start, 'read', currentFingerprint)
    const selected = page.items.map((entry) => {
      if (
        input.include_tool_payloads === true ||
        (entry.source !== 'tool_call' && entry.source !== 'tool_result')
      ) {
        return entry
      }
      return {
        ...entry,
        content:
          entry.source === 'tool_call'
            ? '[tool input payload omitted]'
            : '[tool result payload omitted]',
        truncated: true,
      }
    })
    const result = response(
      'read',
      limit,
      { ...page, total: entries.length },
      selected,
      selected,
      this.malformedSessionCount,
    )
    result.truncated ||= start > 0 || start + selected.length < entries.length
    return result
  }

  private async timeline(
    records: readonly SessionRecord[],
    input: Extract<SessionHistoryInput, { action: 'timeline' }>,
    work: HistoryWork,
  ): Promise<HistoryResponse> {
    const root = this.visibleRecord(records, input.session_id)
    const selectedRecords =
      input.include_children === true ? [root, ...this.descendants(records, root.id)] : [root]
    const events: Array<
      NormalizedEntry & {
        sessionId: string
        parentSessionId: string | null
        mainSessionId: string | null
      }
    > = []
    let skippedSessions = this.malformedSessionCount
    const omittedSessions = Math.max(0, selectedRecords.length - historyLimits.sessions)
    for (const record of selectedRecords.slice(0, historyLimits.sessions)) {
      if (record.id !== root.id) {
        events.push({
          id: record.id,
          parentId: null,
          type: 'child_session',
          role: null,
          date: record.created,
          content: record.name.slice(0, 500),
          source: 'session_event',
          branchState: 'active',
          reference: sessionReference(record.id),
          truncated: record.name.length > 500,
          redacted: false,
          toolCallId: null,
          toolName: null,
          isError: null,
          sessionId: record.id,
          parentSessionId: record.parentId,
          mainSessionId: this.mainSessionId(records, record),
        })
      }
      try {
        const loaded = await this.load(record, work)
        const source = input.view === 'audit' ? loaded.normalizedAudit : loaded.normalizedActive
        events.push(
          ...source
            .filter(
              (entry) =>
                entry.source === 'user_message' ||
                entry.source === 'assistant_message' ||
                entry.source === 'bash_execution' ||
                entry.source === 'tool_call' ||
                entry.source === 'compaction_summary' ||
                entry.source === 'branch_summary' ||
                (entry.source === 'tool_result' && entry.isError === true) ||
                (entry.source === 'session_event' &&
                  (entry.type === 'model_change' || entry.type === 'thinking_level_change')),
            )
            .map((entry) => ({
              ...entry,
              content: entry.content.slice(0, 500),
              truncated: entry.truncated || entry.content.length > 500,
              sessionId: record.id,
              parentSessionId: record.parentId,
              mainSessionId: this.mainSessionId(records, record),
            })),
        )
      } catch (error) {
        work.check()
        if (record.id === root.id || error instanceof WorkLimitError) throw error
        skippedSessions += 1
      }
    }
    events.sort(
      (left, right) =>
        Date.parse(left.date) - Date.parse(right.date) ||
        left.sessionId.localeCompare(right.sessionId) ||
        left.id.localeCompare(right.id),
    )
    const limit = input.limit ?? 50
    const currentFingerprint = this.historyFingerprint(
      selectedRecords,
      `timeline:${input.view ?? 'active'}`,
    )
    let offset: number
    try {
      offset = decodeCursor(input.cursor, 'timeline', currentFingerprint)
    } catch {
      throw new HistoryError('INVALID_CURSOR', 'The cursor is invalid or stale.')
    }
    const page = paginate(events, limit, offset, 'timeline', currentFingerprint)
    return response(
      'timeline',
      limit,
      page,
      page.items,
      page.items,
      skippedSessions,
      omittedSessions,
    )
  }

  private async toolActivity(
    records: readonly SessionRecord[],
    input: Extract<SessionHistoryInput, { action: 'tool_activity' }>,
    work: HistoryWork,
  ): Promise<HistoryResponse> {
    const root = this.visibleRecord(records, input.session_id)
    const selectedRecords =
      input.include_children === true ? [root, ...this.descendants(records, root.id)] : [root]
    const activities = []
    const activityEntries: NormalizedEntry[] = []
    let skippedSessions = this.malformedSessionCount
    const omittedSessions = Math.max(0, selectedRecords.length - historyLimits.sessions)
    for (const record of selectedRecords.slice(0, historyLimits.sessions)) {
      try {
        const loaded = await this.load(record, work)
        const calls = loaded.normalizedAudit.filter((entry) => entry.source === 'tool_call')
        const paired = pairToolResults(loaded.normalizedAudit)
        for (const call of calls) {
          if (input.tool_names !== undefined && !input.tool_names.includes(call.toolName ?? ''))
            continue
          const evidence = paired.get(call)
          const results = evidence?.results ?? []
          const result =
            evidence?.ambiguous !== true && results.length === 1 ? results[0] : undefined
          const status =
            evidence?.ambiguous === true || results.length > 1
              ? 'unknown'
              : result === undefined
                ? 'missing_result'
                : result.isError === true
                  ? 'failed'
                  : result.isError === false
                    ? 'completed'
                    : 'unknown'
          if (input.errors_only === true && status !== 'failed') continue
          activities.push({
            sessionId: record.id,
            parentSessionId: record.parentId,
            mainSessionId: this.mainSessionId(records, record),
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            startedAt: call.date,
            completedAt: result?.date ?? null,
            status,
            input: call.content.slice(0, 500),
            inputTruncated: call.truncated || call.content.length > 500,
            result: result?.content.slice(0, 500) ?? null,
            resultTruncated:
              result === undefined ? false : result.truncated || result.content.length > 500,
            redacted: call.redacted || result?.redacted === true,
            callReference: call.reference,
            resultReference: result?.reference ?? null,
          })
          activityEntries.push(call)
          if (result !== undefined) activityEntries.push(result)
        }
      } catch (error) {
        work.check()
        if (record.id === root.id || error instanceof WorkLimitError) throw error
        skippedSessions += 1
      }
    }
    activities.sort(
      (left, right) =>
        Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
        left.sessionId.localeCompare(right.sessionId) ||
        (left.toolCallId ?? '').localeCompare(right.toolCallId ?? ''),
    )
    const limit = input.limit ?? 50
    const currentFingerprint = this.historyFingerprint(
      selectedRecords,
      `tool_activity:${JSON.stringify({ toolNames: input.tool_names ?? [], errorsOnly: input.errors_only ?? false })}`,
    )
    let offset: number
    try {
      offset = decodeCursor(input.cursor, 'tool_activity', currentFingerprint)
    } catch {
      throw new HistoryError('INVALID_CURSOR', 'The cursor is invalid or stale.')
    }
    const page = paginate(activities, limit, offset, 'tool_activity', currentFingerprint)
    const pageReferences = new Set(
      page.items.flatMap((item) =>
        item.resultReference === null
          ? [item.callReference]
          : [item.callReference, item.resultReference],
      ),
    )
    const pageEntries = activityEntries.filter((entry) => pageReferences.has(entry.reference))
    const result = response(
      'tool_activity',
      limit,
      page,
      page.items,
      pageEntries,
      skippedSessions,
      omittedSessions,
    )
    result.truncated ||= page.items.some((item) => item.inputTruncated || item.resultTruncated)
    return result
  }
}
