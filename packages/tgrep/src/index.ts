import { createGrepToolDefinition, type ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { search } from './search.ts'

export default function tgrep(pi: ExtensionAPI) {
  pi.registerFlag('tgrep-indexed', {
    description: 'Use tgrep indexes. Results can omit hidden files and recent edits.',
    type: 'boolean',
    default: false,
  })
  const native = createGrepToolDefinition(process.cwd())
  pi.registerTool({
    ...native,
    description: `${native.description} Uses Microsoft tgrep. Fresh mode scans disk; --tgrep-indexed opts into potentially stale indexes without hidden files. Output also has a 2000-line cap.`,
    promptSnippet: 'Search file contents with Microsoft tgrep',
    execute(_id, input, signal, _onUpdate, ctx) {
      return search(input, ctx.cwd, pi.getFlag('tgrep-indexed') === true, 'tgrep', signal)
    },
  })
}
