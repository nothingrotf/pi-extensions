interface Relationship {
  id: string
  parentId: string | null
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
