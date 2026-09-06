interface Relationship {
  id: string
  parentId: string | null
}

export function linkedProjectSessions<Session extends Relationship & { isChild: boolean }>(
  records: readonly Session[],
  projectIds: ReadonlySet<string>,
  currentId: string,
): Session[] {
  const visible = new Set(projectIds)
  const children = new Map<string, string[]>()
  const pending: string[] = []
  for (const record of records) {
    if (
      record.id === currentId ||
      (!record.isChild && record.parentId === null && projectIds.has(record.id))
    ) {
      pending.push(record.id)
    }
    if (record.parentId !== null) {
      const siblings = children.get(record.parentId) ?? []
      siblings.push(record.id)
      children.set(record.parentId, siblings)
    }
  }
  const visited = new Set<string>()
  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined || visited.has(id)) continue
    visited.add(id)
    visible.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return records.filter((record) => visible.has(record.id))
}

export function invalidRelationships(records: readonly Relationship[]): Set<string> {
  const byId = new Map<string, Relationship>()
  const invalid = new Set<string>()
  for (const record of records) {
    if (byId.has(record.id)) invalid.add(record.id)
    byId.set(record.id, record)
  }
  const settled = new Set(invalid)
  for (const record of records) {
    const path = new Set<string>()
    let id: string | null = record.id
    while (id !== null && byId.has(id) && !settled.has(id) && !path.has(id)) {
      path.add(id)
      id = byId.get(id)?.parentId ?? null
    }
    const malformed = id !== null && (invalid.has(id) || path.has(id))
    for (const visited of path) {
      settled.add(visited)
      if (malformed) invalid.add(visited)
    }
  }
  return invalid
}
