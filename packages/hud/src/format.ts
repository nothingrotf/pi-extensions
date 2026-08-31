import type { ExtensionContext } from '@earendil-works/pi-coding-agent'

const escapeCode = 27
const bellCode = 7

function stripTerminalControls(value: string): string {
  let output = ''
  let index = 0
  while (index < value.length) {
    const code = value.charCodeAt(index)
    if (code === escapeCode) {
      const marker = value[index + 1]
      index += 2
      if (marker === '[') {
        while (index < value.length) {
          const sequenceCode = value.charCodeAt(index)
          index += 1
          if (sequenceCode >= 64 && sequenceCode <= 126) {
            break
          }
        }
      } else if (marker === ']' || marker === 'P') {
        while (index < value.length) {
          const sequenceCode = value.charCodeAt(index)
          if (sequenceCode === bellCode) {
            index += 1
            break
          }
          if (sequenceCode === escapeCode && value[index + 1] === '\\') {
            index += 2
            break
          }
          index += 1
        }
      } else if (marker === '(' || marker === ')') {
        index += 1
      }
      continue
    }
    if ((code >= 0 && code <= 8) || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)) {
      index += 1
      continue
    }
    output += value[index] ?? ''
    index += 1
  }
  return output
}

export function sanitizeScalar(value: string | undefined): string {
  return stripTerminalControls(value ?? '')
    .replace(/[\t\r\n]+/gu, ' ')
    .replace(/ +/gu, ' ')
    .trim()
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '--'
  }
  if (value < 1_000) {
    return Math.round(value).toString()
  }
  if (value < 10_000) {
    return `${(value / 1_000).toFixed(1)}k`
  }
  if (value < 1_000_000) {
    return `${Math.round(value / 1_000)}k`
  }
  if (value < 10_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`
  }
  return `${Math.round(value / 1_000_000)}M`
}

export function prettyModel(id: string | undefined): string {
  const safeId = sanitizeScalar(id)
  if (!safeId) {
    return 'no-model'
  }
  const base = safeId.split('/').at(-1) ?? safeId
  const words = base
    .replace(/^(claude|grok|gpt|gemini|openai)-/iu, '')
    .split('-')
    .filter(Boolean)
  const merged: string[] = []
  for (const word of words) {
    const previous = merged.at(-1)
    if (/^\d+$/u.test(word) && previous !== undefined && /\d$/u.test(previous)) {
      merged[merged.length - 1] = `${previous}.${word}`
    } else {
      merged.push(word)
    }
  }
  return merged
    .map((word) =>
      /^[a-z]/u.test(word) ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word,
    )
    .join(' ')
}

export function prettyEffort(level: string | undefined): string {
  const value = sanitizeScalar(level).toLowerCase()
  if (!value || value === 'off') {
    return ''
  }
  if (value === 'xhigh') {
    return 'XHigh'
  }
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`
}

export function buildContextLabel(ctx: ExtensionContext): string {
  const usage = ctx.getContextUsage()
  const contextWindow = ctx.model?.contextWindow ?? usage?.contextWindow
  if (
    usage === undefined ||
    contextWindow === undefined ||
    !Number.isFinite(contextWindow) ||
    contextWindow <= 0
  ) {
    return '--'
  }
  const percent =
    usage.percent === null || !Number.isFinite(usage.percent)
      ? '?'
      : `${Math.max(0, Math.min(999, Math.round(usage.percent)))}%`
  return `${percent}/${formatCount(contextWindow)}`
}

export function contextPercent(ctx: ExtensionContext): number | null {
  const percent = ctx.getContextUsage()?.percent ?? null
  return percent !== null && Number.isFinite(percent) ? percent : null
}

export function formatCwd(cwd: string): string {
  if (!cwd) {
    return '--'
  }
  const home = (process.env.HOME ?? process.env.USERPROFILE ?? '').replace(/[\\/]+$/u, '')
  const networkPath = /^[\\/]{2}[^\\/]/u.test(cwd)
  let path = cwd.replace(/\\/gu, '/').replace(/\/+$/u, '')
  const normalizedHome = home.replace(/\\/gu, '/')
  if (normalizedHome && (path === normalizedHome || path.startsWith(`${normalizedHome}/`))) {
    path = `~${path.slice(normalizedHome.length)}`
  }
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) {
    return path || '/'
  }
  const homePath = parts[0] === '~'
  const drivePath = /^[A-Za-z]:\//u.test(path)
  if (networkPath) {
    if (parts.length <= 4) {
      return `//${parts.join('/')}`
    }
    return `//${parts[0]}/${parts[1]}/…/${parts.slice(-2).join('/')}`
  }
  if (parts.length <= (homePath ? 3 : 2)) {
    if (homePath || drivePath) {
      return parts.join('/')
    }
    return `/${parts.join('/')}`
  }
  const tail = parts.slice(-2).join('/')
  if (homePath) {
    return `~/…/${tail}`
  }
  return drivePath ? `${parts[0]}/…/${tail}` : `…/${tail}`
}

export function formatResetIn(date: Date): string {
  const duration = date.getTime() - Date.now()
  if (!Number.isFinite(duration) || duration <= 0) {
    return 'now'
  }
  const minutes = Math.floor(duration / 60_000)
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`
}
