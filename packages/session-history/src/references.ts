export function sessionReference(sessionId: string): string {
  return `pi-session://${encodeURIComponent(sessionId)}`
}

export function entryReference(sessionId: string, entryId: string): string {
  return `${sessionReference(sessionId)}/${encodeURIComponent(entryId)}`
}
