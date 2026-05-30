import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import {
  clearTerminalPortalSlot,
  findTerminalPortal,
  publishTerminalPortalSlot,
  useTerminalPortals
} from '../terminal-pane/terminal-portal-registry'
import {
  useTerminalPortalLoadingLabel,
  useTerminalPortalStatus
} from '../terminal-pane/terminal-portal-readiness'
import {
  getAgentTerminalPopoverUnavailableReason,
  getAgentTerminalPortalActive,
  getAgentTerminalPortalEffect,
  registerAgentTerminalPopoverInputActivation,
  shouldOpenAgentTerminalPopoverOnFocus,
  shouldRestoreAgentTerminalPopoverFocusOnClose,
  type AgentTerminalPopoverPublishedRef
} from './agent-terminal-popover-behavior'
import { requestAgentTerminalPopoverBackgroundMount } from './agent-terminal-popover-background-mount'
import { AgentTerminalPopoverSurface } from './AgentTerminalPopoverSurface'

const HOVER_OPEN_DELAY_MS = 120
const CLOSE_DELAY_MS = 180

export type AgentTerminalPopoverProps = {
  worktreeId: string
  tabId: string
  paneKey: string
  agentName: string
  statusLabel: string
  slotId: string
  activeSlotId: string | null
  claimSlot: (slotId: string) => string
  children: React.ReactNode
}

export function AgentTerminalPopover({
  worktreeId,
  tabId,
  paneKey,
  agentName,
  statusLabel,
  slotId,
  activeSlotId,
  claimSlot,
  children
}: AgentTerminalPopoverProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const openTimerRef = useRef<number | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const publishedRef = useRef<AgentTerminalPopoverPublishedRef | null>(null)
  const anchorPointerInsideRef = useRef(false)
  const contentPointerInsideRef = useRef(false)
  const suppressNextFocusOpenRef = useRef(false)
  const openedByFocusRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [requestToken, setRequestToken] = useState<string | null>(null)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [terminalInputActive, setTerminalInputActive] = useState(false)
  const ownsActiveSlot = activeSlotId === slotId
  const popoverOpen = open && ownsActiveSlot
  const terminalPortals = useTerminalPortals(true)
  const { hasLiveTab, forceUnavailable } = useAppStore(
    useShallow((state) => ({
      hasLiveTab: (state.tabsByWorktree[worktreeId] ?? []).some((tab) => tab.id === tabId),
      forceUnavailable: Object.values(state.migrationUnsupportedByPtyId).some(
        (entry) => entry.paneKey === paneKey
      )
    }))
  )
  // Why: TerminalPane renders once per tab, then isolates the selected leaf.
  // If Activity owns any pane in this tab, a sibling popover would have no
  // independent pane to portal and would show an empty/unavailable surface.
  const activityOwnsTab =
    findTerminalPortal(terminalPortals, {
      worktreeId,
      tabId,
      purpose: 'activity'
    }) !== null
  const portalStatus = useTerminalPortalStatus(
    portalTarget,
    popoverOpen && hasLiveTab && !activityOwnsTab ? paneKey : null,
    forceUnavailable,
    true
  )
  const showLoadingLabel = useTerminalPortalLoadingLabel(
    popoverOpen && hasLiveTab && !activityOwnsTab && portalStatus === 'loading'
  )

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current)
      openTimerRef.current = null
    }
  }, [])

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const openNow = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    // Why: sidebar rows can belong to non-active restored worktrees. Request a
    // hidden TerminalPane mount so the existing pane can portal without
    // activating or switching the workspace.
    requestAgentTerminalPopoverBackgroundMount(worktreeId)
    const nextToken = claimSlot(slotId)
    setTerminalInputActive(false)
    setRequestToken(nextToken)
    setOpen(true)
  }, [claimSlot, clearCloseTimer, clearOpenTimer, slotId, worktreeId])

  const openFromFocus = useCallback(() => {
    openedByFocusRef.current = true
    openNow()
  }, [openNow])

  const openFromPointer = useCallback(() => {
    openedByFocusRef.current = false
    openNow()
  }, [openNow])

  const closeNow = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    suppressNextFocusOpenRef.current = true
    setTerminalInputActive(false)
    setOpen(false)
  }, [clearCloseTimer, clearOpenTimer])

  const scheduleOpen = useCallback(() => {
    clearCloseTimer()
    if (open) {
      return
    }
    clearOpenTimer()
    openTimerRef.current = window.setTimeout(openFromPointer, HOVER_OPEN_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer, open, openFromPointer])

  const isInsidePopoverSurface = useCallback((target: EventTarget | null) => {
    return (
      target instanceof Node &&
      (anchorRef.current?.contains(target) === true ||
        contentRef.current?.contains(target) === true)
    )
  }, [])

  const hasPointerInsideSurface = useCallback(() => {
    return (
      anchorPointerInsideRef.current ||
      contentPointerInsideRef.current ||
      anchorRef.current?.matches(':hover') === true ||
      contentRef.current?.matches(':hover') === true
    )
  }, [])

  const scheduleClose = useCallback(() => {
    clearOpenTimer()
    clearCloseTimer()
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (hasPointerInsideSurface() || isInsidePopoverSurface(document.activeElement)) {
        return
      }
      closeNow()
    }, CLOSE_DELAY_MS)
  }, [clearCloseTimer, clearOpenTimer, closeNow, hasPointerInsideSurface, isInsidePopoverSurface])

  const handleAnchorPointerEnter = useCallback(() => {
    anchorPointerInsideRef.current = true
    scheduleOpen()
  }, [scheduleOpen])

  const handleAnchorPointerLeave = useCallback(() => {
    anchorPointerInsideRef.current = false
    scheduleClose()
  }, [scheduleClose])

  const handleContentPointerEnter = useCallback(() => {
    contentPointerInsideRef.current = true
    clearCloseTimer()
    // Why: background-worktree terminal panes need the portal marked active
    // before the user's first click reaches xterm, or the click can land on a
    // visible-but-noninteractive terminal surface.
    setTerminalInputActive(true)
  }, [clearCloseTimer])

  const handleContentPointerLeave = useCallback(() => {
    contentPointerInsideRef.current = false
    scheduleClose()
  }, [scheduleClose])

  useLayoutEffect(() => {
    if (open && activeSlotId !== null && activeSlotId !== slotId) {
      // Why: the parent active slot is the single owner. Row-to-row hover
      // should transfer the popover immediately, not after the hover close
      // grace period reserved for moving between a row and its own surface.
      closeNow()
    }
  }, [activeSlotId, closeNow, open, slotId])

  useLayoutEffect(() => {
    const effect = getAgentTerminalPortalEffect({
      open: popoverOpen,
      hasLiveTab,
      activityOwnsTab,
      hasPortalTarget: portalTarget !== null,
      hasRequestToken: requestToken !== null,
      published: publishedRef.current
    })
    if (effect.kind === 'publish' && portalTarget && requestToken) {
      publishTerminalPortalSlot({
        purpose: 'agent-popover',
        slotId,
        requestToken,
        target: portalTarget,
        worktreeId,
        tabId,
        paneKey,
        paneRouteKey: { worktreeId, tabId, paneKey },
        forceUnavailable,
        active: getAgentTerminalPortalActive({ terminalInputActive })
      })
      publishedRef.current = { slotId, requestToken }
      return
    }
    if (effect.kind === 'clear') {
      clearTerminalPortalSlot(effect.slotId, effect.requestToken)
      publishedRef.current = null
    }
  }, [
    activityOwnsTab,
    forceUnavailable,
    hasLiveTab,
    paneKey,
    portalTarget,
    popoverOpen,
    requestToken,
    slotId,
    tabId,
    terminalInputActive,
    worktreeId
  ])

  useEffect(() => {
    if (!portalTarget) {
      return
    }
    const handleTerminalInputActivation = () => {
      setTerminalInputActive(true)
    }
    // Why: TerminalPane is React-portaled into this DOM node from a different
    // React tree. Native events follow the DOM path, so they reliably catch
    // xterm clicks/focus where React bubbling from the popover would not.
    return registerAgentTerminalPopoverInputActivation(portalTarget, handleTerminalInputActivation)
  }, [portalTarget])

  useEffect(() => {
    return () => {
      clearOpenTimer()
      clearCloseTimer()
      const published = publishedRef.current
      if (published) {
        clearTerminalPortalSlot(published.slotId, published.requestToken)
        publishedRef.current = null
      }
    }
  }, [clearCloseTimer, clearOpenTimer])

  const stopPropagation = useCallback((event: React.SyntheticEvent) => {
    event.stopPropagation()
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        openFromFocus()
      } else if (!openedByFocusRef.current) {
        // Why: pointer-opened terminal popovers are hover surfaces. The
        // portaled xterm focus path can look like an outside interaction to
        // Radix, so let pointer leave or explicit controls close this mode.
        clearCloseTimer()
      } else if (!hasPointerInsideSurface()) {
        closeNow()
      } else {
        clearCloseTimer()
      }
    },
    [clearCloseTimer, closeNow, hasPointerInsideSurface, openFromFocus]
  )

  const handleBlur = useCallback(
    (event: React.FocusEvent) => {
      const next = event.relatedTarget
      if (isInsidePopoverSurface(next)) {
        return
      }
      // Why: portaling an active terminal can move focus while the pointer is
      // still hovering the agent row. Hover-open popovers must not interpret
      // that focus churn as user dismissal.
      if (hasPointerInsideSurface()) {
        return
      }
      scheduleClose()
    },
    [hasPointerInsideSurface, isInsidePopoverSurface, scheduleClose]
  )

  const keepPortalInteractionsInside = useCallback(
    (event: { target: EventTarget | null; preventDefault: () => void }) => {
      // Why: Radix's outside-interaction bookkeeping follows its React tree.
      // TerminalPane is portaled from the terminal overlay tree into this DOM
      // surface, so validate containment against the actual DOM as well.
      if (isInsidePopoverSurface(event.target)) {
        event.preventDefault()
      }
    },
    [isInsidePopoverSurface]
  )

  const handleFocus = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const suppress = suppressNextFocusOpenRef.current
      suppressNextFocusOpenRef.current = false
      if (
        shouldOpenAgentTerminalPopoverOnFocus({
          suppressNextFocusOpen: suppress,
          focusIsAnchor: event.target === event.currentTarget
        })
      ) {
        openFromFocus()
      }
    },
    [openFromFocus]
  )

  const unavailableReason = getAgentTerminalPopoverUnavailableReason({
    activityOwnsTab,
    hasLiveTab
  })

  return (
    <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
      <PopoverAnchor asChild>
        <div
          ref={anchorRef}
          className="block rounded-sm outline-none focus-within:ring-2 focus-within:ring-sidebar-ring"
          data-agent-terminal-popover-anchor=""
          tabIndex={-1}
          aria-label={`Open terminal for ${agentName}, status ${statusLabel}`}
          aria-haspopup="dialog"
          aria-expanded={popoverOpen}
          onPointerEnter={handleAnchorPointerEnter}
          onPointerLeave={handleAnchorPointerLeave}
          onFocusCapture={handleFocus}
          onBlurCapture={handleBlur}
        >
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        ref={contentRef}
        side="right"
        align="center"
        sideOffset={10}
        className="h-[min(520px,calc(100vh-24px))] w-[min(720px,calc(100vw-24px))] p-0"
        data-agent-terminal-popover-content=""
        onPointerEnter={handleContentPointerEnter}
        onPointerLeave={handleContentPointerLeave}
        onPointerDown={stopPropagation}
        onClick={stopPropagation}
        onBlur={handleBlur}
        onFocusOutside={keepPortalInteractionsInside}
        onInteractOutside={keepPortalInteractionsInside}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (
            shouldRestoreAgentTerminalPopoverFocusOnClose({
              openedByFocus: openedByFocusRef.current
            })
          ) {
            anchorRef.current?.focus()
          }
          openedByFocusRef.current = false
        }}
        onEscapeKeyDown={() => closeNow()}
      >
        <PopoverArrow className="fill-popover stroke-border/50" />
        <AgentTerminalPopoverSurface
          agentName={agentName}
          hasLiveTab={hasLiveTab}
          activityOwnsTab={activityOwnsTab}
          portalStatus={portalStatus}
          showLoadingLabel={showLoadingLabel}
          unavailableReason={unavailableReason}
          setPortalTarget={setPortalTarget}
          closePopover={closeNow}
        />
      </PopoverContent>
    </Popover>
  )
}
