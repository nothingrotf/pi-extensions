import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { Type, type Static } from 'typebox'
import { Value } from 'typebox/value'

import type { ContextFile } from './discovery.ts'

export const messageType = 'subdir-context'

export const DeliveryDetailsSchema = Type.Object({
  files: Type.Array(
    Type.Object({ path: Type.String({ minLength: 1 }), sha256: Type.String({ minLength: 1 }) }),
  ),
  version: Type.Literal(1),
})

export type DeliveryDetails = Static<typeof DeliveryDetailsSchema>

/** First branch index whose entries still reach the model after the latest compaction. */
function contextStart(branch: readonly SessionEntry[]): number {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry?.type !== 'compaction') continue
    const kept = branch.findIndex((candidate) => candidate.id === entry.firstKeptEntryId)
    return kept >= 0 ? kept : index
  }
  return 0
}

/** Instruction files already in the model context of the branch, by path, with their content hash. */
export function deliveredFiles(branch: readonly SessionEntry[]): Map<string, string> {
  const delivered = new Map<string, string>()
  for (const entry of branch.slice(contextStart(branch))) {
    if (entry.type !== 'custom_message' || entry.customType !== messageType) continue
    if (!Value.Check(DeliveryDetailsSchema, entry.details)) continue
    for (const file of entry.details.files) delivered.set(file.path, file.sha256)
  }
  return delivered
}

export function deliveryMessage(
  toolName: string,
  files: readonly ContextFile[],
  changed: ReadonlySet<string>,
): string {
  const sections = files.map((file) => {
    const heading = changed.has(file.path)
      ? `## ${file.path} (changed since it was loaded)`
      : `## ${file.path}`
    return `${heading}\n\n${file.content.trim()}`
  })
  return [
    `Directory instructions for paths that \`${toolName}\` touched. Each file applies to its directory and below, adds to the project instructions, and does not approve actions that already ran.`,
    ...sections,
  ].join('\n\n')
}
