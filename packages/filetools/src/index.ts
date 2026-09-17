import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { createPatchTool } from './patch.ts'
import { createBoundedReadTool } from './read.ts'

export { readArtifact } from './artifacts.ts'
export { selectJson, SelectorError, type JsonDocument } from './json-select.ts'
export { fileOutline, FULL_READ_BYTES, HEAD_LINES, outlineNotice } from './outline.ts'
export { structureProblem, STRUCTURE_CHECK_MAX_CHARS, type StructureProblem } from './structure.ts'
export {
  createPatchTool,
  formatPatchResults,
  PatchError,
  PatchSchema,
  planPatch,
  writePatch,
} from './patch.ts'
export {
  assertReadInput,
  boundedReadPlan,
  createBoundedReadTool,
  MAX_JSON_BYTES,
  MAX_READ_PATHS,
  MULTI_READ_BUDGET,
  projectJson,
  ReadInputError,
  ReadSchema,
  type ReadInput,
} from './read.ts'

const capabilityDiscoveryEvent = '@nothingrotf/subagent/discover-capabilities'
const capabilityRegistrationEvent = '@nothingrotf/subagent/register-capabilities'

export const FILETOOLS_CAPABILITY_ID = 'filetools'
export const FILETOOLS_SOURCE_ID = '@nothingrotf/filetools'

export default function filetools(pi: ExtensionAPI): void {
  const createTools = () => [createBoundedReadTool(process.cwd()), createPatchTool()]
  pi.registerTool(createBoundedReadTool(process.cwd()))
  pi.registerTool(createPatchTool())
  const publish = () => {
    pi.events.emit(capabilityRegistrationEvent, {
      registrations: [
        {
          createTools,
          extensions: [],
          id: FILETOOLS_CAPABILITY_ID,
          overrides: ['read'],
          readonlyTools: ['read'],
          tools: createTools(),
          version: '1',
        },
      ],
      sourceId: FILETOOLS_SOURCE_ID,
    })
  }
  const unsubscribe = pi.events.on(capabilityDiscoveryEvent, publish)
  publish()
  pi.on('session_shutdown', () => {
    unsubscribe()
  })
}
