import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export interface Skill {
  name: string
  description: string
  path: string
}

export interface Alias {
  name: string
  start: number
  end: number
}

export function getSkills(pi: Pick<ExtensionAPI, 'getCommands'>): Skill[] {
  const skills = new Map<string, Skill>()
  for (const command of pi.getCommands()) {
    if (command.source !== 'skill') continue
    const name = command.name.replace(/^skill:/, '')
    if (!name || skills.has(name)) continue
    skills.set(name, {
      name,
      description: command.description ?? '',
      path: command.sourceInfo.path,
    })
  }
  return [...skills.values()]
}

export function isLiteralInput(text: string): boolean {
  return /^[\s]*[!/]/.test(text)
}

export function codeRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const pattern = /(^[ \t]*(`{3,}|~{3,})[^\n]*\n)|(`+)/gm
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const fence = match[2]
    const ticks = match[3]
    const start = match.index
    const contentStart = pattern.lastIndex
    let end = text.length
    if (fence) {
      const closing = new RegExp(`^[ \\t]*${fence[0]}{${fence.length},}[ \\t]*(?:\\n|$)`, 'gm')
      closing.lastIndex = contentStart
      const close = closing.exec(text)
      if (close) end = closing.lastIndex
    } else if (ticks) {
      const closing = /`+/g
      closing.lastIndex = contentStart
      for (let close = closing.exec(text); close; close = closing.exec(text)) {
        if (close[0].length === ticks.length) {
          end = closing.lastIndex
          break
        }
      }
    }
    ranges.push({ start, end })
    pattern.lastIndex = end
  }
  return ranges
}

export function aliases(text: string): Alias[] {
  if (isLiteralInput(text)) return []
  const excluded = codeRanges(text)
  const found: Alias[] = []
  for (const match of text.matchAll(/(?:^|[\s([{,;:])\$([A-Za-z0-9_-]+)(?![A-Za-z0-9_$\-/])/g)) {
    const name = match[1]
    if (!name) continue
    const end = match.index + match[0].length
    const start = end - name.length - 1
    if (excluded.some((range) => start >= range.start && start < range.end)) continue
    found.push({ name, start, end })
  }
  return found
}

export function completionPrefix(lines: string[], line: number, col: number): string | undefined {
  const text = lines.join('\n')
  if (isLiteralInput(text)) return undefined
  const before = (lines[line] ?? '').slice(0, col)
  const prefix = before.match(/(?:^|[\s([{,;:])(\$[A-Za-z0-9_-]*)$/)?.[1]
  if (!prefix) return undefined
  const offset =
    lines.slice(0, line).reduce((length, value) => length + value.length + 1, 0) +
    col -
    prefix.length
  if (codeRanges(text).some((range) => offset >= range.start && offset < range.end))
    return undefined
  return prefix
}
