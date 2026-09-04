import { type Component, Container, type TUI } from '@earendil-works/pi-tui'

import { childrenOf, maxTreeDepth } from './component-tree.ts'

export type RenderHost = Component & Pick<TUI, 'requestRender'>

export type TranscriptSubscription = {
  dispose: () => void
  markDirty: () => void
}

type ContainerSnapshot = {
  component: Component
  children: readonly Component[]
  first: Component | undefined
  last: Component | undefined
  length: number
}

type Listener = {
  dirty: boolean
  order: number
  update: () => void
}

function directChildren(component: Component): readonly Component[] {
  return component instanceof Container ? component.children : childrenOf(component)
}

function snapshot(component: Component): ContainerSnapshot {
  const children = directChildren(component)
  return {
    children,
    component,
    first: children[0],
    last: children.at(-1),
    length: children.length,
  }
}

function changed(previous: ContainerSnapshot): boolean {
  const children = directChildren(previous.component)
  return (
    (previous.component instanceof Container && children !== previous.children) ||
    children.length !== previous.length ||
    children[0] !== previous.first ||
    children.at(-1) !== previous.last
  )
}

function collect(root: Component, depth = 0): ContainerSnapshot[] {
  if (depth > maxTreeDepth) return []
  const current = snapshot(root)
  const snapshots = [current]
  for (const child of current.children) {
    if (child.constructor === Container) snapshots.push(...collect(child, depth + 1))
  }
  return snapshots
}

class TranscriptObserver {
  private readonly listeners = new Set<Listener>()
  private containers: ContainerSnapshot[] = []
  private scheduled = false
  private updating = false

  constructor(private readonly tui: RenderHost) {
    const original = tui.requestRender.bind(tui)
    tui.requestRender = (...args: Parameters<TUI['requestRender']>): void => {
      this.update()
      original(...args)
    }
  }

  subscribe(order: number, update: () => void): TranscriptSubscription {
    const listener: Listener = { dirty: true, order, update }
    this.listeners.add(listener)
    this.schedule()
    return {
      dispose: () => {
        this.listeners.delete(listener)
        if (this.listeners.size === 0) this.containers = []
      },
      markDirty: () => {
        if (!this.listeners.has(listener)) return
        listener.dirty = true
        this.schedule()
      },
    }
  }

  private schedule(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      if (this.listeners.size > 0) this.tui.requestRender()
    })
  }

  private update(): void {
    if (this.updating || this.listeners.size === 0) return
    const structuralChange = this.containers.length === 0 || this.containers.some(changed)
    const pending = [...this.listeners]
      .filter((listener) => listener.dirty || structuralChange)
      .sort((left, right) => left.order - right.order)
    if (pending.length === 0) return
    this.updating = true
    try {
      for (const listener of pending) {
        listener.dirty = false
        listener.update()
      }
      this.containers = collect(this.tui)
    } finally {
      this.updating = false
    }
  }
}

const observers = new WeakMap<RenderHost, TranscriptObserver>()

export function observeTranscript(
  tui: RenderHost,
  order: number,
  update: () => void,
): TranscriptSubscription {
  let observer = observers.get(tui)
  if (observer === undefined) {
    observer = new TranscriptObserver(tui)
    observers.set(tui, observer)
  }
  return observer.subscribe(order, update)
}
