import { createGrepToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { search } from './search.ts'

const capabilityDiscoveryEvent = '@nothingrotf/subagent/discover-capabilities'
const capabilityRegistrationEvent = '@nothingrotf/subagent/register-capabilities'

export const TGREP_CAPABILITY_ID = 'tgrep'
export const TGREP_SOURCE_ID = '@nothingrotf/tgrep'

export function createTgrepTool(
  indexed: () => boolean,
): ReturnType<typeof createGrepToolDefinition> {
  const native = createGrepToolDefinition(process.cwd())
  return {
    ...native,
    description: `${native.description} Uses Microsoft tgrep. Fresh mode scans disk; --tgrep-indexed opts into potentially stale indexes without hidden files. Output also has a 2000-line cap.`,
    promptSnippet: 'Search file contents with Microsoft tgrep',
    execute(_id, input, signal, _onUpdate, ctx) {
      return search(input, ctx.cwd, indexed(), 'tgrep', signal)
    },
  }
}

export default function tgrep(pi: ExtensionAPI) {
  pi.registerFlag('tgrep-indexed', {
    description: 'Use tgrep indexes. Results can omit hidden files and recent edits.',
    type: 'boolean',
    default: false,
  })
  const indexed = () => pi.getFlag('tgrep-indexed') === true
  pi.registerTool(createTgrepTool(indexed))
  const createTools = () => [createTgrepTool(indexed)]
  const publish = () => {
    pi.events.emit(capabilityRegistrationEvent, {
      registrations: [
        {
          createTools,
          extensions: [],
          id: TGREP_CAPABILITY_ID,
          overrides: ['grep'],
          readonlyTools: ['grep'],
          tools: createTools(),
          version: '1',
        },
      ],
      sourceId: TGREP_SOURCE_ID,
    })
  }
  const unsubscribe = pi.events.on(capabilityDiscoveryEvent, publish)
  publish()
  pi.on('session_shutdown', () => {
    unsubscribe()
  })
}
