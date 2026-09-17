/** Files below this size are always returned in full. */
export const FULL_READ_BYTES = 20_000
/** Lines returned from the head of a large file when the model requested no window. */
export const HEAD_LINES = 200
/** Maximum outline entries reported for one file. */
export const OUTLINE_ENTRIES = 60

const declaration =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|namespace|const|let|var|def|fn|impl|trait|struct|module|package|func)\s+([A-Za-z_$][\w$]*)/
const heading = /^(#{1,3})\s+(.+)$/
const method =
  /^\s{2,}(?:(?:public|private|protected|static|readonly|async)\s+)*([A-Za-z_$][\w$]*)\s*\(/

export interface OutlineEntry {
  line: number
  text: string
}

export interface FileOutline {
  entries: readonly OutlineEntry[]
  lines: number
  truncatedEntries: boolean
}

/**
 * Collect the declaration and heading lines of a file so a bounded read still exposes the map of
 * the file. The scan is textual and language agnostic, so it never blocks on a parser.
 */
export function fileOutline(content: string): FileOutline {
  const lines = content.split('\n')
  const entries: OutlineEntry[] = []
  const seen = new Set<string>()
  let truncatedEntries = false
  for (const [index, text] of lines.entries()) {
    if (text.length === 0 || text.length > 400) continue
    const matched = heading.exec(text) ?? declaration.exec(text) ?? method.exec(text)
    if (matched === null) continue
    const trimmed = text.trim().slice(0, 120)
    if (seen.has(trimmed)) continue
    if (entries.length >= OUTLINE_ENTRIES) {
      truncatedEntries = true
      break
    }
    seen.add(trimmed)
    entries.push({ line: index + 1, text: trimmed })
  }
  return { entries, lines: lines.length, truncatedEntries }
}

/** Render the notice appended to a bounded read result. */
export function outlineNotice(
  path: string,
  outline: FileOutline,
  returnedLines: number,
  bytes: number,
): string {
  const map =
    outline.entries.length === 0
      ? 'No declarations were detected.'
      : outline.entries.map((entry) => `${entry.line}: ${entry.text}`).join('\n')
  return [
    '',
    `[bounded read] ${path} has ${outline.lines} lines and ${bytes} bytes. Lines 1 through ${returnedLines} are shown.`,
    'Pass offset and limit to read another window, or the full line count to read everything.',
    `File map${outline.truncatedEntries ? ` (first ${OUTLINE_ENTRIES} declarations)` : ''}:`,
    map,
  ].join('\n')
}
