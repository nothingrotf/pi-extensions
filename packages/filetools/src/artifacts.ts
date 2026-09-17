const markers: readonly RegExp[] = [
  /\[bounded read\]/,
  /\[Showing lines \d+-\d+ of \d+/,
  /\[\d+ more lines in file\. Use offset=\d+ to continue\.\]/,
  /Use offset=\d+ to continue\.\]/,
  /\.\.\. \[truncated\]/,
  /\[Line \d+ is [^\]]*exceeds[^\]]*limit\./,
]

/**
 * Detect text that a bounded read produced rather than the file itself.
 *
 * A model that echoes a bounded read back into a write would drop every line the read omitted.
 * The guard refuses that write instead of destroying the omitted content.
 */
export function readArtifact(content: string): string | undefined {
  for (const marker of markers) {
    const match = marker.exec(content)
    if (match !== null) return match[0]
  }
  return undefined
}
