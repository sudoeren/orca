import { useLayoutEffect, useState } from 'react'

export type TerminalPortalPurpose = 'activity' | 'agent-popover'

export type TerminalPortalPaneRouteKey = {
  worktreeId: string
  tabId: string
  paneKey: string
}

export type TerminalPortalTarget = TerminalPortalPaneRouteKey & {
  purpose: TerminalPortalPurpose
  slotId: string
  requestToken: string
  target: HTMLElement
  // Why: each portal targets one stable terminal leaf inside a tab.
  // Carry the durable paneKey across this boundary; TerminalPane resolves it
  // to the current numeric PaneManager handle immediately before isolation.
  paneKey: string
  paneRouteKey: TerminalPortalPaneRouteKey
  forceUnavailable?: boolean
  active: boolean
  publishOrder: number
}

export type TerminalPortalPublishTarget = Omit<TerminalPortalTarget, 'publishOrder'>

type Subscriber = (targets: TerminalPortalTarget[]) => void

let publishOrder = 0
const currentTargetsBySlot = new Map<string, TerminalPortalTarget>()
const subscribers = new Set<Subscriber>()

function snapshotTargets(): TerminalPortalTarget[] {
  return Array.from(currentTargetsBySlot.values())
}

function notifySubscribers(): void {
  const targets = snapshotTargets()
  for (const subscriber of subscribers) {
    subscriber(targets)
  }
}

function samePaneRouteKey(a: TerminalPortalPaneRouteKey, b: TerminalPortalPaneRouteKey): boolean {
  return a.worktreeId === b.worktreeId && a.tabId === b.tabId && a.paneKey === b.paneKey
}

function compareSamePanePortalTargets(a: TerminalPortalTarget, b: TerminalPortalTarget): number {
  if (a.purpose === 'activity' && b.purpose !== 'activity') {
    return -1
  }
  if (a.purpose !== 'activity' && b.purpose === 'activity') {
    return 1
  }
  if (a.publishOrder !== b.publishOrder) {
    return b.publishOrder - a.publishOrder
  }
  return a.slotId.localeCompare(b.slotId)
}

function compareTabPortalTargets(a: TerminalPortalTarget, b: TerminalPortalTarget): number {
  if (a.publishOrder !== b.publishOrder) {
    return b.publishOrder - a.publishOrder
  }
  return a.slotId.localeCompare(b.slotId)
}

function isStaleRequestToken(current: string, next: string): boolean {
  const currentNumber = Number(current)
  const nextNumber = Number(next)
  return Number.isSafeInteger(currentNumber) && Number.isSafeInteger(nextNumber)
    ? nextNumber < currentNumber
    : false
}

export function publishTerminalPortalSlot(
  target: TerminalPortalPublishTarget
): TerminalPortalTarget {
  const current = currentTargetsBySlot.get(target.slotId)
  if (current && isStaleRequestToken(current.requestToken, target.requestToken)) {
    return current
  }
  if (current && current.requestToken === target.requestToken && current.target === target.target) {
    const next = { ...target, publishOrder: current.publishOrder }
    currentTargetsBySlot.set(target.slotId, next)
    notifySubscribers()
    return next
  }

  const next = { ...target, publishOrder: ++publishOrder }
  currentTargetsBySlot.set(target.slotId, next)
  notifySubscribers()
  return next
}

export function clearTerminalPortalSlot(slotId: string, requestToken?: string): boolean {
  const current = currentTargetsBySlot.get(slotId)
  if (!current || (requestToken !== undefined && current.requestToken !== requestToken)) {
    return false
  }
  currentTargetsBySlot.delete(slotId)
  notifySubscribers()
  return true
}

// Reserved for compatibility adapters that translate a single owner snapshot
// into per-slot registry mutations. Independent publishers should use slots.
export function setTerminalPortals(targets: TerminalPortalPublishTarget[]): void {
  currentTargetsBySlot.clear()
  for (const target of targets) {
    currentTargetsBySlot.set(target.slotId, { ...target, publishOrder: ++publishOrder })
  }
  notifySubscribers()
}

export function useTerminalPortals(enabled: boolean): TerminalPortalTarget[] {
  const [targets, setTargets] = useState<TerminalPortalTarget[]>(enabled ? snapshotTargets() : [])

  useLayoutEffect(() => {
    if (!enabled) {
      setTargets([])
      return
    }
    setTargets(snapshotTargets())
    subscribers.add(setTargets)
    return () => {
      subscribers.delete(setTargets)
    }
  }, [enabled])

  return targets
}

export function findTerminalPortal(
  targets: readonly TerminalPortalTarget[],
  query: {
    worktreeId: string
    tabId: string
    purpose?: TerminalPortalPurpose
    slotId?: string
    paneKey?: string
    requestToken?: string
  }
): TerminalPortalTarget | null {
  const matching = targets.filter(
    (target) =>
      target.worktreeId === query.worktreeId &&
      target.tabId === query.tabId &&
      (query.purpose === undefined || target.purpose === query.purpose) &&
      (query.slotId === undefined || target.slotId === query.slotId) &&
      (query.paneKey === undefined || target.paneKey === query.paneKey) &&
      (query.requestToken === undefined || target.requestToken === query.requestToken)
  )
  if (matching.length === 0) {
    return null
  }

  const queryPaneKey = query.paneKey
  const routeScoped = queryPaneKey
    ? targets.filter(
        (target) =>
          samePaneRouteKey(target.paneRouteKey, {
            worktreeId: query.worktreeId,
            tabId: query.tabId,
            paneKey: queryPaneKey
          }) &&
          (query.purpose === undefined || target.purpose === query.purpose) &&
          (query.slotId === undefined || target.slotId === query.slotId) &&
          (query.requestToken === undefined || target.requestToken === query.requestToken)
      )
    : matching

  if (routeScoped.length === 0) {
    return null
  }

  const routeWinners = new Map<string, TerminalPortalTarget>()
  for (const target of routeScoped) {
    const key = `${target.paneRouteKey.worktreeId}\0${target.paneRouteKey.tabId}\0${target.paneRouteKey.paneKey}`
    const current = routeWinners.get(key)
    if (!current || compareSamePanePortalTargets(target, current) < 0) {
      routeWinners.set(key, target)
    }
  }

  const winners = Array.from(routeWinners.values()).sort((a, b) => {
    if (a.active !== b.active) {
      return a.active ? -1 : 1
    }
    return compareTabPortalTargets(a, b)
  })
  return winners[0] ?? null
}
