import { type Component, wrapTextWithAnsi } from '@earendil-works/pi-tui'

import { defaultHudPalette, type HudPalette } from './colors.ts'
import { type FileResolver, segmentProse } from './prose-links.ts'
import { type ProseChunk, proseStyles, serializeChunks } from './prose-style.ts'

export type ProsePlainOptions = {
  cwd: () => string
  palette?: () => HudPalette
  resolve: FileResolver
  revision: () => number
}

export function renderProsePlain(
  text: string,
  width: number,
  resolve: FileResolver,
  cwd: string,
  palette: HudPalette = defaultHudPalette,
): string[] {
  const styles = proseStyles(palette)
  const lines: string[] = []
  for (const line of text.replaceAll('\t', '   ').split('\n')) {
    if (line.trim().length === 0) {
      lines.push('')
      continue
    }
    const chunks: ProseChunk[] = segmentProse(line, resolve, cwd).map((segment) =>
      segment.kind === 'text'
        ? { style: styles.text, text: segment.text }
        : { link: segment.url, style: styles.anchor, text: segment.text },
    )
    lines.push(...wrapTextWithAnsi(serializeChunks(chunks), Math.max(1, width)))
  }
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  while (lines.length > 0 && lines[0] === '') lines.shift()
  return lines
}

export class ProsePlain implements Component {
  private cacheKey: string | undefined
  private cachePalette: HudPalette | undefined
  private cacheLines: string[] = []

  constructor(
    private readonly text: string,
    private readonly options: ProsePlainOptions,
  ) {}

  invalidate(): void {
    this.cacheKey = undefined
  }

  render(width: number): string[] {
    const palette = this.options.palette?.() ?? defaultHudPalette
    const key = `${width}\u0000${this.options.revision()}\u0000${this.text}`
    if (this.cacheKey === key && this.cachePalette === palette) return this.cacheLines
    const lines = renderProsePlain(
      this.text,
      width,
      this.options.resolve,
      this.options.cwd(),
      palette,
    )
    this.cacheKey = key
    this.cachePalette = palette
    this.cacheLines = lines
    return lines
  }
}
