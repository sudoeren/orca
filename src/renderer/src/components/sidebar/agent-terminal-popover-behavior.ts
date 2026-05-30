export type AgentTerminalPopoverUnavailableReason =
  | 'unavailable'
  | 'already-open-activity'
  | 'closed'

export type AgentTerminalPopoverPublishedRef = {
  slotId: string
  requestToken: string
}

export type AgentTerminalPortalEffect =
  | {
      kind: 'publish'
    }
  | {
      kind: 'clear'
      slotId: string
      requestToken: string
    }
  | {
      kind: 'none'
    }

export function getAgentTerminalPopoverUnavailableReason({
  activityOwnsTab,
  hasLiveTab
}: {
  activityOwnsTab: boolean
  hasLiveTab: boolean
}): AgentTerminalPopoverUnavailableReason {
  if (activityOwnsTab) {
    return 'already-open-activity'
  }
  return hasLiveTab ? 'unavailable' : 'closed'
}

export function shouldOpenAgentTerminalPopoverOnFocus({
  suppressNextFocusOpen,
  focusIsAnchor
}: {
  suppressNextFocusOpen: boolean
  focusIsAnchor: boolean
}): boolean {
  return !suppressNextFocusOpen && focusIsAnchor
}

export function getAgentTerminalPortalActive({
  terminalInputActive
}: {
  terminalInputActive: boolean
}): boolean {
  return terminalInputActive
}

export function registerAgentTerminalPopoverInputActivation(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  activate: () => void
): () => void {
  target.addEventListener('pointerdown', activate, { capture: true })
  target.addEventListener('focusin', activate)
  return () => {
    target.removeEventListener('pointerdown', activate, { capture: true })
    target.removeEventListener('focusin', activate)
  }
}

export function shouldRestoreAgentTerminalPopoverFocusOnClose({
  openedByFocus
}: {
  openedByFocus: boolean
}): boolean {
  return openedByFocus
}

export function getAgentTerminalPortalEffect({
  open,
  hasLiveTab,
  activityOwnsTab,
  hasPortalTarget,
  hasRequestToken,
  published
}: {
  open: boolean
  hasLiveTab: boolean
  activityOwnsTab: boolean
  hasPortalTarget: boolean
  hasRequestToken: boolean
  published: AgentTerminalPopoverPublishedRef | null
}): AgentTerminalPortalEffect {
  if (open && hasLiveTab && !activityOwnsTab && hasPortalTarget && hasRequestToken) {
    return { kind: 'publish' }
  }
  if (published && (!open || !hasLiveTab || activityOwnsTab)) {
    return { kind: 'clear', slotId: published.slotId, requestToken: published.requestToken }
  }
  return { kind: 'none' }
}
