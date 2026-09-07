import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type UrlMatch = { end: number; start: number; text: string; url: string }

export type FileCandidate = {
  col: number | undefined
  end: number
  full: string
  line: number | undefined
  path: string
  start: number
}

export type FileResolver = (candidate: FileCandidate) => string | undefined

export type ProseSegment =
  | { kind: 'text'; text: string }
  | { kind: 'url'; text: string; url: string }
  | { kind: 'file'; text: string; url: string }

const segment = '(?:[\\w.~@+-]|\\\\ )+'
const slashPath = `(?:\\.{0,2}/)?(?:${segment}/)+${segment}`
const dottedName = `${segment}\\.[A-Za-z0-9][\\w-]*`
const dotName = '\\.[A-Za-z][\\w-]*'
const location = '(?::(\\d+)(?::(\\d+))?)?'
const filePattern = new RegExp(
  `(?<![\\w/.])(?:${slashPath}|${dottedName}|${dotName})${location}`,
  'gu',
)
const urlPattern =
  /(?<![\w@./-])(?:[a-z][\w+.-]*:\/\/\S+|mailto:\S+|www\.\S+|(?:gist\.)?github\.com\/\S+|raw\.githubusercontent\.com\/\S+)/giu
const schemePattern = /^[a-z][\w+.-]*:/iu
const validUrlPattern = /^(?:[a-z][\w+.-]*:\/\/\S|mailto:[^\s@]+@[^\s@]+)/iu
const trailingPunctuation = new Set('.,;:!?\'"\u201d\u2019\u00bb')
const closers = new Map<string, string>([
  [')', '('],
  [']', '['],
  ['}', '{'],
])

function trimTrailing(text: string): string {
  let value = text
  for (;;) {
    const last = value.at(-1)
    if (last === undefined) break
    if (trailingPunctuation.has(last)) {
      value = value.slice(0, -1)
      continue
    }
    const opener = closers.get(last)
    if (opener !== undefined && value.split(last).length > value.split(opener).length) {
      value = value.slice(0, -1)
      continue
    }
    break
  }
  return value
}

export function findUrls(text: string): UrlMatch[] {
  if (!text.includes(':') && !text.includes('.')) return []
  const found: UrlMatch[] = []
  for (const match of text.matchAll(urlPattern)) {
    const trimmed = trimTrailing(match[0])
    if (trimmed.length === 0) continue
    const url = schemePattern.test(trimmed) ? trimmed : `https://${trimmed}`
    if (!validUrlPattern.test(url)) continue
    found.push({ end: match.index + trimmed.length, start: match.index, text: trimmed, url })
  }
  return found
}

function inside(ranges: readonly (readonly [number, number])[], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end)
}

export function findFileCandidates(text: string): FileCandidate[] {
  if (!text.includes('/') && !text.includes('.')) return []
  const urls = findUrls(text).map((match): readonly [number, number] => [match.start, match.end])
  const found: FileCandidate[] = []
  for (const match of text.matchAll(filePattern)) {
    const start = match.index
    if (inside(urls, start)) continue
    let full = match[0]
    const lineText = match[1]
    const colText = match[2]
    if (lineText === undefined) {
      full = full.replace(/\.+$/u, '')
      if (full.length === 0) continue
    }
    const line = lineText === undefined ? undefined : Number(lineText)
    const col = colText === undefined ? undefined : Number(colText)
    let path = full
    if (lineText !== undefined) {
      const suffix = `:${lineText}${colText === undefined ? '' : `:${colText}`}`
      path = full.slice(0, full.length - suffix.length)
    }
    if (!path.includes('/') && !/\.[A-Za-z0-9]/u.test(path)) continue
    found.push({ col, end: start + full.length, full, line, path, start })
  }
  return found
}

export function unescapePath(path: string): string {
  return path.replaceAll('\\ ', ' ')
}

export function normalizeProjectPath(path: string, cwd: string): string {
  let value = unescapePath(path).replaceAll('\\', '/').trim()
  const root = cwd.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (root.length > 0 && value.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    value = value.slice(root.length + 1)
  }
  if (value.startsWith('./')) value = value.slice(2)
  return value
}

export function absoluteProjectPath(path: string, cwd: string): string {
  if (path === '~' || path.startsWith('~/')) return resolve(homedir(), path.slice(2))
  return isAbsolute(path) ? path : resolve(cwd, path)
}

export function fileUrl(path: string, cwd: string): string {
  return pathToFileURL(absoluteProjectPath(path, cwd)).href
}

export type ProjectFileIndexOptions = {
  cwd: () => string
  exists?: (absolutePath: string) => Promise<boolean>
  onChange: () => void
  settleMs?: number
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    const info = await stat(absolutePath)
    return info.isFile() || info.isDirectory()
  } catch {
    return false
  }
}

export class ProjectFileIndex {
  private readonly known = new Map<string, string | null>()
  private readonly pending = new Set<string>()
  private readonly exists: (absolutePath: string) => Promise<boolean>
  private readonly settleMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private currentRevision = 0

  constructor(private readonly options: ProjectFileIndexOptions) {
    this.exists = options.exists ?? pathExists
    this.settleMs = options.settleMs ?? 16
  }

  get revision(): number {
    return this.currentRevision
  }

  get cwd(): string {
    return this.options.cwd()
  }

  resolve(candidate: FileCandidate): string | undefined {
    const key = normalizeProjectPath(candidate.path, this.cwd)
    if (key.length === 0) return undefined
    const cached = this.known.get(key)
    if (cached !== undefined) return cached ?? undefined
    if (!this.disposed && !this.pending.has(key)) this.lookup(key).catch(() => undefined)
    return undefined
  }

  readonly resolver: FileResolver = (candidate) => this.resolve(candidate)

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private async lookup(key: string): Promise<void> {
    this.pending.add(key)
    let found = false
    try {
      found = await this.exists(absoluteProjectPath(key, this.cwd))
    } catch {
      found = false
    }
    this.known.set(key, found ? key : null)
    this.pending.delete(key)
    this.publish()
  }

  private publish(): void {
    if (this.disposed || this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.currentRevision += 1
      this.options.onChange()
    }, this.settleMs)
  }
}

export function segmentProse(text: string, resolve: FileResolver, cwd: string): ProseSegment[] {
  const urls = findUrls(text)
  const files = findFileCandidates(text)
  if (urls.length === 0 && files.length === 0) {
    return text.length === 0 ? [] : [{ kind: 'text', text }]
  }
  const anchors: { end: number; segment: ProseSegment; start: number }[] = []
  for (const match of urls) {
    anchors.push({
      end: match.end,
      segment: { kind: 'url', text: match.text, url: match.url },
      start: match.start,
    })
  }
  for (const candidate of files) {
    const known = resolve(candidate)
    if (known === undefined) continue
    anchors.push({
      end: candidate.end,
      segment: { kind: 'file', text: candidate.full, url: fileUrl(known, cwd) },
      start: candidate.start,
    })
  }
  anchors.sort((first, second) => first.start - second.start)
  const segments: ProseSegment[] = []
  let cursor = 0
  for (const anchor of anchors) {
    if (anchor.start < cursor) continue
    if (anchor.start > cursor)
      segments.push({ kind: 'text', text: text.slice(cursor, anchor.start) })
    segments.push(anchor.segment)
    cursor = anchor.end
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments.length === 0 ? [{ kind: 'text', text }] : segments
}

const fencePattern = /(```[\s\S]*?```|~~~[\s\S]*?~~~)/u
const codeSpanPattern = /(`[^`\n]+`)/u
const markdownLinkPattern = /!?\[[^\]\n]*\]\([^)\n]*\)/gu
const autolinkPattern = /<[a-z][\w+.-]*:[^>\s]+>/giu

function protectedRanges(text: string): (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = []
  for (const match of text.matchAll(markdownLinkPattern)) {
    ranges.push([match.index, match.index + match[0].length])
  }
  for (const match of text.matchAll(autolinkPattern)) {
    ranges.push([match.index, match.index + match[0].length])
  }
  for (const match of findUrls(text)) ranges.push([match.start, match.end])
  return ranges
}

type LinkifyOptions = { cwd: string; resolve: FileResolver; streaming?: boolean }

function linkifyText(text: string, options: LinkifyOptions): string {
  const candidates = findFileCandidates(text)
  if (candidates.length === 0) return text
  const guarded = protectedRanges(text)
  let output = ''
  let cursor = 0
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue
    if (inside(guarded, candidate.start)) continue
    if (options.streaming === true && candidate.end === text.length) continue
    const known = options.resolve(candidate)
    if (known === undefined) continue
    output += `${text.slice(cursor, candidate.start)}[${candidate.full}](${fileUrl(known, options.cwd)})`
    cursor = candidate.end
  }
  return output + text.slice(cursor)
}

export function linkifyMarkdown(markdown: string, options: LinkifyOptions): string {
  if (!markdown.includes('/') && !markdown.includes('.')) return markdown
  const blocks = markdown.split(fencePattern)
  let output = ''
  blocks.forEach((block, index) => {
    if (index % 2 === 1) {
      output += block
      return
    }
    for (const part of block.split(codeSpanPattern)) {
      if (!/^`[^`\n]+`$/u.test(part)) {
        output += linkifyText(part, options)
        continue
      }
      const inner = part.slice(1, -1).trim()
      const candidates = findFileCandidates(inner)
      const single = candidates.length === 1 ? candidates[0] : undefined
      const known =
        single !== undefined && single.full === inner ? options.resolve(single) : undefined
      output += known === undefined ? part : `[${part}](${fileUrl(known, options.cwd)})`
    }
  })
  return output
}
