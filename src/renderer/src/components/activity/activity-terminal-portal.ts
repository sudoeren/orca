import {
  clearTerminalPortalSlot,
  findTerminalPortal,
  publishTerminalPortalSlot,
  useTerminalPortals,
  type TerminalPortalTarget
} from '../terminal-pane/terminal-portal-registry'

export type ActivityTerminalPortalTarget = Omit<
  TerminalPortalTarget,
  'purpose' | 'paneRouteKey' | 'publishOrder'
>

const activitySlots = new Map<string, string>()

// Why: Activity still owns its two-slot snapshot API, but the underlying
// registry is shared so other terminal popout surfaces can coexist safely.
export function setActivityTerminalPortals(targets: ActivityTerminalPortalTarget[]): void {
  const nextSlots = new Set<string>()
  for (const target of targets) {
    nextSlots.add(target.slotId)
    publishTerminalPortalSlot({
      ...target,
      purpose: 'activity',
      paneRouteKey: {
        worktreeId: target.worktreeId,
        tabId: target.tabId,
        paneKey: target.paneKey
      }
    })
    activitySlots.set(target.slotId, target.requestToken)
  }
  for (const [slotId, requestToken] of activitySlots) {
    if (nextSlots.has(slotId)) {
      continue
    }
    clearTerminalPortalSlot(slotId, requestToken)
    activitySlots.delete(slotId)
  }
}

export function useActivityTerminalPortals(enabled: boolean): ActivityTerminalPortalTarget[] {
  return useTerminalPortals(enabled)
    .filter((target) => target.purpose === 'activity')
    .map(
      ({
        purpose: _purpose,
        paneRouteKey: _paneRouteKey,
        publishOrder: _publishOrder,
        ...target
      }) => target
    )
}

export function findActivityTerminalPortal(
  targets: readonly (ActivityTerminalPortalTarget | TerminalPortalTarget)[],
  query: {
    worktreeId: string
    tabId: string
    slotId?: string
    paneKey?: string
    requestToken?: string
  }
): ActivityTerminalPortalTarget | null {
  const terminalTargets = targets
    .filter((target): target is TerminalPortalTarget => 'purpose' in target)
    .filter((target) => target.purpose === 'activity')
  if (terminalTargets.length > 0) {
    const found = findTerminalPortal(terminalTargets, { ...query, purpose: 'activity' })
    if (!found) {
      return null
    }
    const {
      purpose: _purpose,
      paneRouteKey: _paneRouteKey,
      publishOrder: _publishOrder,
      ...target
    } = found
    return target
  }

  const activityTargets = targets as ActivityTerminalPortalTarget[]
  const matchingTab = activityTargets.filter(
    (target) => target.worktreeId === query.worktreeId && target.tabId === query.tabId
  )
  if (
    query.slotId !== undefined ||
    query.paneKey !== undefined ||
    query.requestToken !== undefined
  ) {
    const exact = matchingTab.find(
      (target) =>
        (query.slotId === undefined || target.slotId === query.slotId) &&
        (query.paneKey === undefined || target.paneKey === query.paneKey) &&
        (query.requestToken === undefined || target.requestToken === query.requestToken)
    )
    if (exact) {
      return exact
    }
  }
  return (
    matchingTab.find((target) => target.active) ??
    (matchingTab.length === 1 ? matchingTab[0] : null) ??
    null
  )
}
