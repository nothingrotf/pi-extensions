export type RailSegment =
  | { content: string; type: 'reasoning' }
  | { content: string; type: 'text' }
  | { toolCallIds: readonly string[]; type: 'tools' }

export type RailZones = {
  finalSegs: readonly RailSegment[]
  opening: string
  railSegs: readonly RailSegment[]
}

export type SplitOptions = {
  live?: boolean
  partial?: boolean
}

function coalesce(segments: readonly RailSegment[]): RailSegment[] {
  const out: RailSegment[] = []
  for (const segment of segments) {
    const previous = out.at(-1)
    if (segment.type === 'text' && previous?.type === 'text') {
      out[out.length - 1] = { content: previous.content + segment.content, type: 'text' }
      continue
    }
    out.push(segment)
  }
  return out
}

export function splitSegments(
  segments: readonly RailSegment[],
  options: SplitOptions = {},
): RailZones | undefined {
  if (segments.length === 0) return undefined
  const merged = coalesce(segments)

  const firstTools = merged.findIndex((segment) => segment.type === 'tools')
  if (firstTools < 0) return undefined

  let lastTools = -1
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    if (merged[index]?.type === 'tools') {
      lastTools = index
      break
    }
  }

  const settled = options.partial !== true || options.live === true
  const boundary = lastTools < merged.length - 1 && settled ? lastTools + 1 : merged.length

  const openingIndices = new Set<number>()
  const openingParts: string[] = []
  for (let index = 0; index < firstTools; index += 1) {
    const segment = merged[index]
    if (segment?.type === 'text' && segment.content.trim().length > 0) {
      openingIndices.add(index)
      openingParts.push(segment.content)
    }
  }

  const railSegs: RailSegment[] = []
  for (let index = 0; index < merged.length; index += 1) {
    const segment = merged[index]
    if (segment === undefined || openingIndices.has(index)) continue
    if (index >= boundary && segment.type === 'text') continue
    railSegs.push(segment)
  }

  const finalSegs = merged.slice(boundary).filter((segment) => segment.type === 'text')

  return { finalSegs, opening: openingParts.join('\n\n'), railSegs }
}
