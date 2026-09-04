export type RailTextLocation = {
  contentIndex: number
  timestamp: number
}

export type RailSegment =
  | {
      active?: boolean
      content: string
      id?: string
      messageTimestamp?: number
      type: 'reasoning'
    }
  | {
      content: string
      id?: string
      messageContentIndex?: number
      messageTimestamp?: number
      sourceLocations?: readonly RailTextLocation[]
      type: 'text'
    }
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
      const sourceLocations = [
        ...(previous.sourceLocations ??
          (previous.messageTimestamp === undefined || previous.messageContentIndex === undefined
            ? []
            : [
                {
                  contentIndex: previous.messageContentIndex,
                  timestamp: previous.messageTimestamp,
                },
              ])),
        ...(segment.sourceLocations ??
          (segment.messageTimestamp === undefined || segment.messageContentIndex === undefined
            ? []
            : [
                {
                  contentIndex: segment.messageContentIndex,
                  timestamp: segment.messageTimestamp,
                },
              ])),
      ]
      const merged: Extract<RailSegment, { type: 'text' }> = {
        ...previous,
        content: previous.content + segment.content,
      }
      if (sourceLocations.length > 0) merged.sourceLocations = sourceLocations
      out[out.length - 1] = merged
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
