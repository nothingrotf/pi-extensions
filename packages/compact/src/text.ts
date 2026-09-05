export function excerpt(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n[excerpt omitted]\n'
  const room = Math.max(0, limit - marker.length)
  const head = Math.ceil(room * 0.6)
  return `${text.slice(0, head)}${marker}${text.slice(-(room - head))}`.slice(0, limit)
}

export function compactText(text: string, limit = 600): string {
  return excerpt(text.replace(/\r\n?/g, '\n').trim(), limit)
}
