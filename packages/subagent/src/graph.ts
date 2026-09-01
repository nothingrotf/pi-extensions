import type { TaskNodeInput } from './schema.ts'

export interface TaskGraph {
  nodes: readonly TaskNodeInput[]
  waves: readonly (readonly TaskNodeInput[])[]
}

export function buildTaskGraph(nodes: readonly TaskNodeInput[]): TaskGraph {
  const byId = new Map<string, TaskNodeInput>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new Error(`Task ID "${node.id}" occurs more than once.`)
    byId.set(node.id, node)
  }
  for (const node of nodes) {
    const needs = new Set<string>()
    for (const dependency of node.needs ?? []) {
      if (dependency === node.id) throw new Error(`Task "${node.id}" cannot depend on itself.`)
      if (!byId.has(dependency)) {
        throw new Error(`Task "${node.id}" depends on unknown Task ID "${dependency}".`)
      }
      if (needs.has(dependency)) {
        throw new Error(`Task "${node.id}" lists dependency "${dependency}" more than once.`)
      }
      needs.add(dependency)
    }
  }

  const remaining = new Set(nodes.map((node) => node.id))
  const completed = new Set<string>()
  const waves: TaskNodeInput[][] = []
  while (remaining.size > 0) {
    const ready = nodes.filter(
      (node) =>
        remaining.has(node.id) &&
        (node.needs ?? []).every((dependency) => completed.has(dependency)),
    )
    if (ready.length === 0) {
      const cycle = nodes.filter((node) => remaining.has(node.id)).map((node) => node.id)
      throw new Error(`The Task graph contains a cycle among: ${cycle.join(', ')}.`)
    }
    waves.push(ready)
    for (const node of ready) {
      remaining.delete(node.id)
      completed.add(node.id)
    }
  }
  return { nodes: [...nodes], waves }
}
