import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai'

import { narrationPatch, thoughtPatch, type PseudoRow } from './rail-pseudo.ts'
import { splitSegments, type RailSegment } from './rail-segments.ts'

function segmentId(kind: 'narration' | 'thought', timestamp: number, index: number): string {
  return `${kind}:${String(timestamp)}:${String(index + 1)}`
}

export function messageSegments(
  message: AssistantMessage,
  activeThinkingIndex?: number,
): RailSegment[] {
  const segments: RailSegment[] = []
  message.content.forEach((block, index) => {
    if (block.type === 'thinking') {
      segments.push({
        active: index === activeThinkingIndex,
        content: block.thinking,
        id: segmentId('thought', message.timestamp, index),
        messageTimestamp: message.timestamp,
        type: 'reasoning',
      })
      return
    }
    if (block.type === 'text') {
      segments.push({
        content: block.text,
        id: segmentId('narration', message.timestamp, index),
        messageContentIndex: index,
        messageTimestamp: message.timestamp,
        type: 'text',
      })
      return
    }
    const previous = segments.at(-1)
    if (previous?.type === 'tools') {
      segments[segments.length - 1] = {
        toolCallIds: [...previous.toolCallIds, block.id],
        type: 'tools',
      }
      return
    }
    segments.push({ toolCallIds: [block.id], type: 'tools' })
  })
  return segments
}

function fallbackId(type: 'narration' | 'thought', index: number): string {
  return `${type}:segment:${String(index + 1)}`
}

export type RailVoiceProjection = {
  hasTrailingText: boolean
  hiddenMessageTimestamps: Set<number>
  hiddenTextBlocks: Map<number, Set<number>>
  openingMessageTimestamp: number | undefined
  order: string[]
  reasoningActive: boolean
  rows: PseudoRow[]
  trailingTextMessageTimestamp: number | undefined
}

export function projectRailVoice(
  segments: readonly RailSegment[],
  partial: boolean,
  live = false,
): RailVoiceProjection {
  const zones = splitSegments(segments, { live, partial })
  const railSegments = zones?.railSegs ?? segments.filter((segment) => segment.type === 'reasoning')
  const rows: PseudoRow[] = []
  const order: string[] = []
  const hiddenTextBlocks = new Map<number, Set<number>>()
  let reasoningActive = false
  let openingMessageTimestamp: number | undefined
  const firstTools = segments.findIndex((segment) => segment.type === 'tools')
  if (firstTools >= 0) {
    for (const segment of segments.slice(0, firstTools)) {
      if (
        segment.type === 'text' &&
        segment.content.trim().length > 0 &&
        segment.messageTimestamp !== undefined
      ) {
        openingMessageTimestamp = segment.messageTimestamp
      }
    }
  }

  railSegments.forEach((segment, index) => {
    if (segment.type === 'tools') {
      order.push(...segment.toolCallIds)
      return
    }
    if (segment.type === 'reasoning') {
      const active = segment.active === true
      reasoningActive ||= active
      if (!active && segment.content.trim().length === 0) return
      const id = segment.id ?? fallbackId('thought', index)
      rows.push({ id, patch: thoughtPatch(segment.content, active) })
      order.push(id)
      return
    }
    if (segment.content.trim().length === 0) return
    const id = segment.id ?? fallbackId('narration', index)
    rows.push({ id, patch: narrationPatch(segment.content) })
    order.push(id)
    const locations =
      segment.sourceLocations ??
      (segment.messageTimestamp === undefined || segment.messageContentIndex === undefined
        ? []
        : [
            {
              contentIndex: segment.messageContentIndex,
              timestamp: segment.messageTimestamp,
            },
          ])
    for (const location of locations) {
      const indices = hiddenTextBlocks.get(location.timestamp) ?? new Set<number>()
      indices.add(location.contentIndex)
      hiddenTextBlocks.set(location.timestamp, indices)
    }
  })

  const hiddenMessageTimestamps = new Set(hiddenTextBlocks.keys())
  let lastTools = -1
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (segments[index]?.type === 'tools') {
      lastTools = index
      break
    }
  }
  let hasTrailingText = false
  let trailingTextMessageTimestamp: number | undefined
  for (const segment of segments.slice(lastTools + 1)) {
    if (segment.type !== 'text' || segment.content.trim().length === 0) continue
    hasTrailingText = true
    if (segment.messageTimestamp !== undefined) {
      trailingTextMessageTimestamp = segment.messageTimestamp
    }
  }

  return {
    hasTrailingText,
    hiddenMessageTimestamps,
    hiddenTextBlocks,
    openingMessageTimestamp,
    order,
    reasoningActive,
    rows,
    trailingTextMessageTimestamp,
  }
}

export class RailVoice {
  private activeThinkingIndex: number | undefined
  private live: RailSegment[] = []
  private settled: RailSegment[] = []

  reset(): void {
    this.activeThinkingIndex = undefined
    this.live = []
    this.settled = []
  }

  start(message: AssistantMessage): void {
    this.activeThinkingIndex = undefined
    this.live = messageSegments(message)
  }

  update(message: AssistantMessage, event: AssistantMessageEvent): void {
    switch (event.type) {
      case 'thinking_start':
      case 'thinking_delta':
        this.activeThinkingIndex = event.contentIndex
        break
      case 'done':
      case 'error':
      case 'text_start':
      case 'thinking_end':
      case 'toolcall_start':
        this.activeThinkingIndex = undefined
        break
    }
    this.live = messageSegments(message, this.activeThinkingIndex)
  }

  finish(message: AssistantMessage): void {
    this.settled.push(...messageSegments(message))
    this.activeThinkingIndex = undefined
    this.live = []
  }

  projection(): RailVoiceProjection {
    const live = this.live.length > 0
    return projectRailVoice([...this.settled, ...this.live], live, live)
  }

  segments(): readonly RailSegment[] {
    return [...this.settled, ...this.live]
  }
}
