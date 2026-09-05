import type { NormalizedEntry } from './normalize.ts'

interface ToolEvidence {
  results: NormalizedEntry[]
  ambiguous: boolean
}

export function pairToolResults(
  entries: readonly NormalizedEntry[],
): Map<NormalizedEntry, ToolEvidence> {
  const nodes = new Map(entries.map((entry) => [entry.id, entry]))
  const children = new Map<string | null, string[]>()
  for (const node of nodes.values()) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node.id)
    children.set(node.parentId, siblings)
  }
  const starts = new Map<string, number>()
  const ends = new Map<string, number>()
  const pending = (children.get(null) ?? []).map((id) => ({ id, exit: false }))
  let clock = 0
  while (pending.length > 0) {
    const item = pending.pop()
    if (item === undefined) break
    if (item.exit) {
      ends.set(item.id, clock++)
      continue
    }
    if (starts.has(item.id)) continue
    starts.set(item.id, clock++)
    pending.push({ id: item.id, exit: true })
    for (const id of children.get(item.id) ?? []) pending.push({ id, exit: false })
  }
  const calls = new Map<string, NormalizedEntry[]>()
  const paired = new Map<NormalizedEntry, ToolEvidence>()
  for (const entry of entries) {
    if (entry.source !== 'tool_call' || entry.toolCallId === null) continue
    const candidates = calls.get(entry.toolCallId) ?? []
    candidates.push(entry)
    calls.set(entry.toolCallId, candidates)
  }
  for (const result of entries) {
    if (result.source !== 'tool_result' || result.toolCallId === null) continue
    const resultStart = starts.get(result.id) ?? -1
    let nearest: NormalizedEntry[] = []
    let nearestStart = -1
    for (const call of calls.get(result.toolCallId) ?? []) {
      const start = starts.get(call.id) ?? -1
      const end = ends.get(call.id) ?? -1
      if (
        call.toolName === result.toolName &&
        start < resultStart &&
        resultStart < end &&
        start >= nearestStart
      ) {
        if (start > nearestStart) nearest = []
        nearest.push(call)
        nearestStart = start
      }
    }
    for (const call of nearest) {
      const evidence = paired.get(call) ?? { results: [], ambiguous: false }
      if (nearest.length > 1) evidence.ambiguous = true
      else evidence.results.push(result)
      paired.set(call, evidence)
    }
  }
  return paired
}
