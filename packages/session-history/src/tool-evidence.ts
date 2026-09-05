import type { NormalizedEntry } from './normalize.ts'
import { HistoryWork } from './work.ts'

interface ToolEvidence {
  results: NormalizedEntry[]
  ambiguous: boolean
}

interface CallLayer {
  calls: NormalizedEntry[]
  evidence?: ToolEvidence
}

interface Node {
  parentId: string | null
  entries: NormalizedEntry[]
  children: string[]
}

interface Binding {
  byName: Map<string | null, CallLayer>
  name: string | null
  previous: CallLayer | undefined
}

type Frame = { type: 'enter'; id: string } | { type: 'exit'; bindings: Binding[] }

export async function pairToolResults(
  entries: readonly NormalizedEntry[],
  work = new HistoryWork(),
): Promise<Map<NormalizedEntry, ToolEvidence>> {
  work.pair(entries.length)
  let steps = 0
  const nodes = new Map<string, Node>()
  for (const entry of entries) {
    if (++steps % 256 === 0) await work.yield()
    const node = nodes.get(entry.id) ?? { parentId: entry.parentId, entries: [], children: [] }
    node.entries.push(entry)
    nodes.set(entry.id, node)
  }
  const pending: Frame[] = []
  for (const [id, node] of nodes) {
    if (++steps % 256 === 0) await work.yield()
    if (node.parentId === null) pending.push({ type: 'enter', id })
    else nodes.get(node.parentId)?.children.push(id)
  }
  const active = new Map<string, Map<string | null, CallLayer>>()
  const owners = new Map<NormalizedEntry, CallLayer>()
  const visited = new Set<string>()
  while (pending.length > 0) {
    if (++steps % 256 === 0) await work.yield()
    const frame = pending.pop()
    if (frame === undefined) break
    if (frame.type === 'exit') {
      for (const binding of frame.bindings) {
        if (++steps % 256 === 0) await work.yield()
        if (binding.previous === undefined) binding.byName.delete(binding.name)
        else binding.byName.set(binding.name, binding.previous)
      }
      continue
    }
    if (visited.has(frame.id)) continue
    visited.add(frame.id)
    const node = nodes.get(frame.id)
    if (node === undefined) continue
    const grouped = new Map<string, Map<string | null, CallLayer>>()
    for (const entry of node.entries) {
      if (++steps % 256 === 0) await work.yield()
      const id = entry.toolCallId
      if (id === null) continue
      const name = entry.toolName
      if (entry.source === 'tool_result') {
        const owner = active.get(id)?.get(name)
        if (owner !== undefined) owners.set(entry, owner)
      } else if (entry.source === 'tool_call') {
        const byName = grouped.get(id) ?? new Map<string | null, CallLayer>()
        const layer = byName.get(name) ?? { calls: [] }
        layer.calls.push(entry)
        byName.set(name, layer)
        grouped.set(id, byName)
      }
    }
    const bindings: Binding[] = []
    for (const [id, layers] of grouped) {
      const byName = active.get(id) ?? new Map<string | null, CallLayer>()
      active.set(id, byName)
      for (const [name, layer] of layers) {
        if (++steps % 256 === 0) await work.yield()
        bindings.push({ byName, name, previous: byName.get(name) })
        byName.set(name, layer)
      }
    }
    pending.push({ type: 'exit', bindings })
    for (const id of node.children) {
      if (++steps % 256 === 0) await work.yield()
      pending.push({ type: 'enter', id })
    }
  }
  const paired = new Map<NormalizedEntry, ToolEvidence>()
  for (const entry of entries) {
    if (++steps % 256 === 0) await work.yield()
    const owner = owners.get(entry)
    if (owner === undefined) continue
    if (owner.evidence === undefined) {
      owner.evidence = { results: [], ambiguous: owner.calls.length > 1 }
      for (const call of owner.calls) {
        if (++steps % 256 === 0) await work.yield()
        paired.set(call, owner.evidence)
      }
    }
    if (!owner.evidence.ambiguous) owner.evidence.results.push(entry)
  }
  work.check()
  return paired
}
