import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { Type } from 'typebox'
import type { Static } from 'typebox'
import { Value } from 'typebox/value'

import { formatResetIn } from './format.ts'

const execFileAsync = promisify(execFile)
const requestTimeoutMs = 5_000
const keychainTimeoutMs = 1_500

const AuthSchema = Type.Object(
  {
    anthropic: Type.Optional(Type.Object({ access: Type.Optional(Type.String()) })),
    'openai-codex': Type.Optional(
      Type.Object({
        access: Type.Optional(Type.String()),
        accountId: Type.Optional(Type.String()),
      }),
    ),
  },
  { additionalProperties: true },
)

const KeychainSchema = Type.Object(
  {
    claudeAiOauth: Type.Optional(Type.Object({ accessToken: Type.Optional(Type.String()) })),
  },
  { additionalProperties: true },
)

const ClaudeWindowSchema = Type.Object(
  {
    utilization: Type.Optional(Type.Number()),
    resets_at: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
)

const ClaudeUsageSchema = Type.Object(
  {
    five_hour: Type.Optional(ClaudeWindowSchema),
    seven_day: Type.Optional(ClaudeWindowSchema),
  },
  { additionalProperties: true },
)

const CodexWindowSchema = Type.Object(
  {
    used_percent: Type.Optional(Type.Number()),
    limit_window_seconds: Type.Optional(Type.Number()),
    reset_at: Type.Optional(Type.Number()),
  },
  { additionalProperties: true },
)

const CodexUsageSchema = Type.Object(
  {
    rate_limit: Type.Optional(
      Type.Object(
        {
          primary_window: Type.Optional(Type.Union([CodexWindowSchema, Type.Null()])),
          secondary_window: Type.Optional(Type.Union([CodexWindowSchema, Type.Null()])),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
)

type AuthData = Static<typeof AuthSchema>
type ClaudeUsageData = Static<typeof ClaudeUsageSchema>
type CodexUsageData = Static<typeof CodexUsageSchema>
type CodexWindowData = Static<typeof CodexWindowSchema>

export type UsageWindow = {
  label: string
  usedPercent: number
  resetsIn: string | undefined
}

export type UsageSnapshot = {
  provider: string
  windows: UsageWindow[]
  error?: string
  fetchedAt: number
}

export function normalizePercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

function resetLabel(value: string | number | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? formatResetIn(date) : undefined
}

export function parseClaudeWindows(data: ClaudeUsageData): UsageWindow[] {
  const windows: UsageWindow[] = []
  const fiveHour = data.five_hour
  if (fiveHour?.utilization !== undefined) {
    windows.push({
      label: '5h',
      usedPercent: normalizePercent(fiveHour.utilization),
      resetsIn: resetLabel(fiveHour.resets_at),
    })
  }
  const sevenDay = data.seven_day
  if (sevenDay?.utilization !== undefined) {
    windows.push({
      label: 'wk',
      usedPercent: normalizePercent(sevenDay.utilization),
      resetsIn: resetLabel(sevenDay.resets_at),
    })
  }
  return windows
}

function codexWindow(
  label: string,
  window: CodexWindowData | null | undefined,
): UsageWindow | null {
  if (window?.used_percent === undefined) {
    return null
  }
  const duration = window.limit_window_seconds
  const resolvedLabel =
    duration === 604_800
      ? 'wk'
      : duration !== undefined &&
          Number.isFinite(duration) &&
          duration > 0 &&
          duration % 3_600 === 0
        ? `${duration / 3_600}h`
        : label
  return {
    label: resolvedLabel,
    usedPercent: normalizePercent(window.used_percent),
    resetsIn: window.reset_at === undefined ? undefined : resetLabel(window.reset_at * 1_000),
  }
}

export function parseCodexWindows(data: CodexUsageData): UsageWindow[] {
  const limits = data.rate_limit
  const primary = codexWindow('5h', limits?.primary_window)
  const secondary = codexWindow('wk', limits?.secondary_window)
  return [primary, secondary].filter((window): window is UsageWindow => window !== null)
}

export async function withTimeout<ValueType>(
  parent: AbortSignal | undefined,
  duration: number,
  work: (signal: AbortSignal) => Promise<ValueType>,
): Promise<ValueType> {
  const controller = new AbortController()
  const relay = () => controller.abort(parent?.reason)
  if (parent?.aborted) {
    relay()
  } else {
    parent?.addEventListener('abort', relay, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('operation timed out')), duration)
  try {
    return await work(controller.signal)
  } finally {
    clearTimeout(timer)
    parent?.removeEventListener('abort', relay)
  }
}

export function agentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR
  return !configured
    ? join(homedir(), '.pi', 'agent')
    : configured === '~'
      ? homedir()
      : configured.startsWith('~/') || configured.startsWith('~\\')
        ? join(homedir(), configured.slice(2))
        : configured
}

export function authFilePath(): string {
  return join(agentDir(), 'auth.json')
}

async function loadAuth(signal: AbortSignal | undefined): Promise<AuthData | undefined> {
  try {
    const content = await readFile(authFilePath(), {
      encoding: 'utf8',
      signal,
    })
    return Value.Decode(AuthSchema, JSON.parse(content))
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return undefined
  }
}

async function claudeToken(signal: AbortSignal | undefined): Promise<string | undefined> {
  const direct = (await loadAuth(signal))?.anthropic?.access
  if (direct) {
    return direct
  }
  try {
    const content = await withTimeout(signal, keychainTimeoutMs, async (keychainSignal) => {
      const result = await execFileAsync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        {
          encoding: 'utf8',
          maxBuffer: 65_536,
          signal: keychainSignal,
        },
      )
      return String(result.stdout).trim()
    })
    return Value.Decode(KeychainSchema, JSON.parse(content)).claudeAiOauth?.accessToken
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return undefined
  }
}

async function fetchJson(
  url: string,
  headers: Headers,
  schema: typeof ClaudeUsageSchema,
  signal: AbortSignal | undefined,
): Promise<ClaudeUsageData>
async function fetchJson(
  url: string,
  headers: Headers,
  schema: typeof CodexUsageSchema,
  signal: AbortSignal | undefined,
): Promise<CodexUsageData>
async function fetchJson(
  url: string,
  headers: Headers,
  schema: typeof ClaudeUsageSchema | typeof CodexUsageSchema,
  signal: AbortSignal | undefined,
): Promise<ClaudeUsageData | CodexUsageData> {
  return withTimeout(signal, requestTimeoutMs, async (requestSignal) => {
    const response = await fetch(url, { headers, signal: requestSignal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return Value.Decode(schema, await response.json())
  })
}

async function fetchClaudeUsage(signal: AbortSignal | undefined): Promise<UsageSnapshot> {
  const provider = 'Claude'
  try {
    const token = await claudeToken(signal)
    if (!token) {
      return { provider, windows: [], error: 'no-auth', fetchedAt: Date.now() }
    }
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    })
    const data = await fetchJson(
      'https://api.anthropic.com/api/oauth/usage',
      headers,
      ClaudeUsageSchema,
      signal,
    )
    return { provider, windows: parseClaudeWindows(data), fetchedAt: Date.now() }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return { provider, windows: [], error: String(error), fetchedAt: Date.now() }
  }
}

async function fetchCodexUsage(signal: AbortSignal | undefined): Promise<UsageSnapshot> {
  const provider = 'Codex'
  try {
    const credentials = (await loadAuth(signal))?.['openai-codex']
    if (!credentials?.access) {
      return { provider, windows: [], error: 'no-auth', fetchedAt: Date.now() }
    }
    const headers = new Headers({
      Authorization: `Bearer ${credentials.access}`,
      Accept: 'application/json',
      'User-Agent': 'pi-agent',
    })
    if (credentials.accountId) {
      headers.set('ChatGPT-Account-Id', credentials.accountId)
    }
    const data = await fetchJson(
      'https://chatgpt.com/backend-api/wham/usage',
      headers,
      CodexUsageSchema,
      signal,
    )
    return { provider, windows: parseCodexWindows(data), fetchedAt: Date.now() }
  } catch (error) {
    if (signal?.aborted) {
      throw error
    }
    return { provider, windows: [], error: String(error), fetchedAt: Date.now() }
  }
}

export function fetchUsageForProvider(
  provider: string | undefined,
  signal: AbortSignal | undefined,
): Promise<UsageSnapshot> | null {
  if (provider === 'anthropic') {
    return fetchClaudeUsage(signal)
  }
  if (provider === 'openai-codex') {
    return fetchCodexUsage(signal)
  }
  return null
}
