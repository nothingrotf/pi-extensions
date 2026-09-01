import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'

import type { SubagentDefinition } from './agents.ts'
import {
  type CancelReceipt,
  type SubagentController,
  type SubagentEvent,
  type SubagentHandle,
  type SubagentInvocation,
  type SubagentResult,
  SubagentRuntime,
  type SubagentSnapshot,
  type SteerReceipt,
  type TaskReceipt,
} from './runtime.ts'

const hosts = new WeakMap<ExtensionAPI, SubagentControllerHost>()

function cloneSnapshot(snapshot: SubagentSnapshot): SubagentSnapshot {
  return {
    ...snapshot,
    intercomUsage: { ...snapshot.intercomUsage },
    usage: { ...snapshot.usage },
  }
}

function cloneResult(result: SubagentResult): SubagentResult {
  return {
    ...result,
    artifact: result.artifact === undefined ? undefined : { ...result.artifact },
    gateResults: structuredClone(result.gateResults),
    intercomUsage: { ...result.intercomUsage },
    structuredOutput:
      result.structuredOutput === undefined ? undefined : structuredClone(result.structuredOutput),
    usage: { ...result.usage },
  }
}

function cloneReceipt(receipt: TaskReceipt): TaskReceipt {
  return { ...receipt, handle: { ...receipt.handle } }
}

function cloneEvent(event: SubagentEvent): SubagentEvent {
  if (event.type === 'created') return { ...event, receipt: cloneReceipt(event.receipt) }
  if (event.type === 'updated') {
    return { ...event, handle: { ...event.handle }, snapshot: cloneSnapshot(event.snapshot) }
  }
  if (event.type === 'terminal') {
    return { ...event, handle: { ...event.handle }, result: cloneResult(event.result) }
  }
  return { ...event }
}

export class SubagentControllerHost implements SubagentController {
  private readonly handles = new Map<string, SubagentHandle>()
  private readonly listeners = new Map<string, Set<(event: SubagentEvent) => void>>()
  private readonly published = new Map<string, number>()
  private invalidatedOwnerGeneration = -1
  private lifecycleGeneration = 0
  private replacementPending = false
  readonly runtime: SubagentRuntime
  registered = false

  constructor(pi: ExtensionAPI, runTimeoutMs?: number) {
    this.runtime = new SubagentRuntime(pi, runTimeoutMs)
    this.runtime.subscribe(() => this.publishUpdates())
  }

  async replaceSession(ctx: Pick<ExtensionContext, 'sessionManager'>): Promise<boolean> {
    if (this.runtime.ownerSessionId.length > 0 && !this.replacementPending) return false
    this.replacementPending = false
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    this.invalidateOwner()
    await this.runtime.shutdown()
    if (generation !== this.lifecycleGeneration) return false
    this.runtime.invalidateAgentCache()
    this.runtime.restore(ctx)
    return true
  }

  async stopSession(
    ctx: Pick<ExtensionContext, 'sessionManager'>,
    reason?: string,
  ): Promise<boolean> {
    if (ctx.sessionManager.getSessionId() !== this.runtime.ownerSessionId) return false
    this.replacementPending = true
    this.lifecycleGeneration += 1
    const generation = this.lifecycleGeneration
    this.invalidateOwner()
    await this.runtime.shutdown(reason)
    if (generation !== this.lifecycleGeneration) return false
    return true
  }

  async start(invocation: SubagentInvocation): Promise<TaskReceipt> {
    const result = await this.runtime.run({
      ctx: invocation.ctx,
      input: { ...invocation.input, run_in_background: true },
      retainBackgroundSignal: true,
      signal: invocation.signal,
    })
    if (result.kind !== 'background') {
      const detail = result.kind === 'failed' ? result.details.error : 'The subagent did not start.'
      throw new Error(detail)
    }
    const handle = result.details.handle
    const receipt: TaskReceipt = {
      background: true,
      createdAt: result.details.createdAt,
      handle: { ...handle },
      revision: this.runtime.currentRevision,
      status: 'running',
      transcriptPath: result.details.transcriptPath,
    }
    this.handles.set(handle.agentId, { ...handle })
    this.emit(handle.ownerSessionId, {
      receipt,
      revision: receipt.revision,
      type: 'created',
    })
    const terminal = this.runtime.resultFor(handle)
    if (terminal !== undefined) {
      this.emit(handle.ownerSessionId, {
        handle: { ...handle },
        result: cloneResult(terminal),
        revision: this.runtime.currentRevision,
        type: 'terminal',
      })
      this.published.set(handle.agentId, this.runtime.currentRevision)
    }
    return receipt
  }

  async wait(handle: SubagentHandle, signal?: AbortSignal): Promise<SubagentResult> {
    return cloneResult(await this.runtime.waitFor(handle, signal))
  }

  snapshot(handle: SubagentHandle): SubagentSnapshot | undefined {
    const snapshot = this.runtime.snapshotFor(handle)
    return snapshot === undefined ? undefined : cloneSnapshot(snapshot)
  }

  result(handle: SubagentHandle): SubagentResult | undefined {
    const result = this.runtime.resultFor(handle)
    return result === undefined ? undefined : cloneResult(result)
  }

  steer(handle: SubagentHandle, message: string): Promise<SteerReceipt> {
    return this.runtime.steer(handle, message)
  }

  async cancel(handle: SubagentHandle): Promise<CancelReceipt> {
    if (
      handle.ownerSessionId !== this.runtime.ownerSessionId ||
      handle.ownerGeneration !== this.runtime.currentOwnerGeneration
    ) {
      return { revision: this.runtime.currentRevision, status: 'stale-handle' }
    }
    const active = this.runtime.handle(handle.agentId)
    if (active === undefined) {
      return {
        handle: { ...handle },
        revision: this.runtime.currentRevision,
        status: this.runtime.resultFor(handle) === undefined ? 'not-found' : 'already-terminal',
      }
    }
    if (
      active.ownerGeneration !== handle.ownerGeneration ||
      active.runGeneration !== handle.runGeneration
    ) {
      return { revision: this.runtime.currentRevision, status: 'stale-handle' }
    }
    this.runtime.requestCancel(handle.agentId)
    return {
      handle: { ...handle },
      revision: this.runtime.currentRevision,
      status: 'requested',
    }
  }

  subscribe(ownerSessionId: string, listener: (event: SubagentEvent) => void): () => void {
    const listeners = this.listeners.get(ownerSessionId) ?? new Set()
    listeners.add(listener)
    this.listeners.set(ownerSessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.listeners.delete(ownerSessionId)
    }
  }

  registerAgents(sourceId: string, definitions: readonly SubagentDefinition[]): () => void {
    return this.runtime.registerAgents(sourceId, definitions)
  }

  invalidateAgentCache(): void {
    this.runtime.invalidateAgentCache()
  }

  private invalidateOwner(): void {
    if (this.runtime.currentOwnerGeneration === this.invalidatedOwnerGeneration) return
    const ownerSessionId = this.runtime.ownerSessionId
    const ownerGeneration = this.runtime.currentOwnerGeneration
    this.runtime.invalidateHandles()
    this.invalidatedOwnerGeneration = this.runtime.currentOwnerGeneration
    if (ownerSessionId.length > 0) {
      this.emit(ownerSessionId, {
        ownerGeneration,
        ownerSessionId,
        revision: this.runtime.currentRevision,
        type: 'owner-invalidated',
      })
    }
    for (const [agentId, handle] of this.handles) {
      if (handle.ownerSessionId !== ownerSessionId) continue
      this.handles.delete(agentId)
      this.published.delete(agentId)
    }
  }

  private publishUpdates(): void {
    const revision = this.runtime.currentRevision
    for (const handle of this.handles.values()) {
      if (this.published.get(handle.agentId) === revision) continue
      const snapshot = this.runtime.snapshotFor(handle)
      if (snapshot !== undefined) {
        this.emit(handle.ownerSessionId, {
          handle: { ...handle },
          revision,
          snapshot: cloneSnapshot(snapshot),
          type: 'updated',
        })
        this.published.set(handle.agentId, revision)
        continue
      }
      const result = this.runtime.resultFor(handle)
      if (result !== undefined) {
        this.emit(handle.ownerSessionId, {
          handle: { ...handle },
          result: cloneResult(result),
          revision,
          type: 'terminal',
        })
        this.published.set(handle.agentId, revision)
      }
    }
  }

  private emit(ownerSessionId: string, event: SubagentEvent): void {
    for (const listener of this.listeners.get(ownerSessionId) ?? []) {
      try {
        listener(cloneEvent(event))
      } catch {}
    }
  }
}

export function acquireSubagentHost(
  pi: ExtensionAPI,
  runTimeoutMs?: number,
): SubagentControllerHost {
  const existing = hosts.get(pi)
  if (existing !== undefined) return existing
  const host = new SubagentControllerHost(pi, runTimeoutMs)
  hosts.set(pi, host)
  return host
}

export function acquireSubagentController(pi: ExtensionAPI): SubagentController {
  return acquireSubagentHost(pi)
}
