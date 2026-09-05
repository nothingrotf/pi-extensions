import type {
  SessionBeforeCompactEvent,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent'

export function user(content: string): Extract<SessionMessageEntry['message'], { role: 'user' }> {
  return { role: 'user', content, timestamp: 1 }
}

export function assistant(
  content = 'Assistant response.',
  inputTokens = 10,
): Extract<SessionMessageEntry['message'], { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: 'compact-test',
    provider: 'compact-test',
    model: 'scripted',
    stopReason: 'stop',
    timestamp: 2,
    usage: {
      input: inputTokens,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: inputTokens + 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }
}

export function entry(
  id: string,
  message: SessionMessageEntry['message'],
  parentId: string | null = null,
): SessionMessageEntry {
  return { type: 'message', id, parentId, timestamp: new Date(0).toISOString(), message }
}

export function event(
  entries: SessionEntry[],
  firstKeptEntryId: string,
  signal = new AbortController().signal,
): SessionBeforeCompactEvent {
  const cut = entries.findIndex((item) => item.id === firstKeptEntryId)
  return {
    type: 'session_before_compact',
    branchEntries: entries,
    reason: 'manual',
    willRetry: false,
    signal,
    preparation: {
      firstKeptEntryId,
      messagesToSummarize: entries
        .slice(0, cut)
        .flatMap((item) => (item.type === 'message' ? [item.message] : [])),
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 20_000,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 2000, keepRecentTokens: 1000 },
    },
  }
}
