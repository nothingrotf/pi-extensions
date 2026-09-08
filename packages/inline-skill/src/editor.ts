import { CustomEditor } from '@earendil-works/pi-coding-agent'
import { CURSOR_MARKER, stripTerminalSequences } from '@earendil-works/pi-tui'

import { aliases } from './skills.ts'

const BOTTOM_MARKER = '\x1b_inline-skill:bottom\x07'

export function decorateLine(
  rendered: string,
  ranges: Array<{ start: number; end: number }>,
  color: (text: string) => string,
): string {
  let index = 0
  const escape = String.fromCharCode(27)
  const parts = new RegExp(
    `${escape}(?:\\[[0-?]*[ -/]*[@-~]|[\\]_][^${escape}${String.fromCharCode(7)}]*(?:${escape}\\\\|${String.fromCharCode(7)}))|[^${escape}]`,
    'gu',
  )
  return rendered.replace(parts, (part) => {
    if (part.startsWith('\x1b')) return part
    const start = index
    index += part.length
    return ranges.some((range) => start >= range.start && start < range.end) ? color(part) : part
  })
}

export class SkillEditor extends CustomEditor {
  getSkillNames: () => Set<string> = () => new Set()
  colorSkill: (text: string) => string = (text) => text

  protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
    return super.renderBottomBorder(width, hiddenLineCount) + BOTTOM_MARKER
  }

  override render(width: number): string[] {
    const rendered = super.render(width)
    const bottom = rendered.findIndex((row) => row.endsWith(BOTTOM_MARKER))
    if (bottom < 0) return rendered
    rendered[bottom] = (rendered[bottom] ?? '').slice(0, -BOTTOM_MARKER.length)
    const source = this.getText()
    const names = this.getSkillNames()
    const matches = aliases(source).filter((alias) => names.has(alias.name))
    if (!matches.length) return rendered
    const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)))
    const rows = rendered.slice(1, bottom).map((raw) => ({
      raw,
      text: stripTerminalSequences(raw).slice(padding).trimEnd(),
      start: -1,
    }))
    const anchor = rows.findIndex(
      (row) => row.raw.includes(CURSOR_MARKER) || row.raw.includes('\x1b[7m'),
    )
    const current = rows[anchor]
    if (!current) return rendered
    const cursor = this.getCursor()
    const cursorOffset =
      this.getLines()
        .slice(0, cursor.line)
        .reduce((length, line) => length + line.length + 1, 0) + cursor.col
    const marker = current.raw.includes(CURSOR_MARKER) ? CURSOR_MARKER : '\x1b[7m'
    const beforeCursor = stripTerminalSequences(current.raw.slice(0, current.raw.indexOf(marker)))
    current.start = cursorOffset - (beforeCursor.length - padding)
    if (!source.startsWith(current.text, current.start)) {
      current.start = source.lastIndexOf(current.text, cursorOffset)
    }
    if (current.start < 0) return rendered
    let boundary = current.start
    for (let i = anchor - 1; i >= 0; i--) {
      const row = rows[i]
      if (!row) continue
      row.start = source.lastIndexOf(row.text, boundary - row.text.length)
      if (row.start < 0) break
      boundary = row.start
    }
    boundary = current.start + current.text.length
    for (let i = anchor + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row) continue
      row.start = source.indexOf(row.text, boundary)
      if (row.start < 0) break
      boundary = row.start + row.text.length
    }
    for (const [index, row] of rows.entries()) {
      if (row.start < 0) continue
      const ranges = matches.flatMap((alias) => {
        const start = Math.max(alias.start, row.start)
        const end = Math.min(alias.end, row.start + row.text.length)
        return start < end
          ? [{ start: padding + start - row.start, end: padding + end - row.start }]
          : []
      })
      rendered[index + 1] = decorateLine(row.raw, ranges, this.colorSkill)
    }
    return rendered
  }
}
