import React, { useEffect, useLayoutEffect, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { parsePaneKey } from '../../../../shared/stable-pane-id'

export type TerminalPortalReadinessStatus = 'loading' | 'ready' | 'unavailable'

type TerminalPortalReadiness = {
  target: HTMLElement | null
  paneKey: string | null
  status: TerminalPortalReadinessStatus
}

type TerminalPortalDomStatus = {
  hasSelectedRoot: boolean
  ready: boolean
  unavailable: boolean
}

export const TERMINAL_PORTAL_LOADING_LABEL_DELAY_MS = 180
export const TERMINAL_PORTAL_UNAVAILABLE_TIMEOUT_MS = 1_200

function findTerminalPortalPane(
  root: HTMLElement,
  leafId: string
): { foundAnyPane: boolean; pane: HTMLElement | null } {
  let foundAnyPane = false
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-leaf-id]')) {
    foundAnyPane = true
    if (candidate.dataset.leafId === leafId) {
      return { foundAnyPane, pane: candidate }
    }
  }
  return { foundAnyPane, pane: null }
}

function hasInlineDisplayNoneBetween(element: HTMLElement, root: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current) {
    if (current.style.display === 'none') {
      return true
    }
    if (current === root) {
      return false
    }
    current = current.parentElement
  }
  return false
}

function hasUnhiddenSiblingPane(root: HTMLElement, selectedPane: HTMLElement): boolean {
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-leaf-id]')) {
    if (candidate !== selectedPane && !hasInlineDisplayNoneBetween(candidate, root)) {
      return true
    }
  }
  return false
}

function getSelectedTerminalPortalStatus(
  target: HTMLElement,
  paneKey: string
): TerminalPortalDomStatus {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return { hasSelectedRoot: false, ready: false, unavailable: true }
  }
  let selectedRoot: HTMLElement | null = null
  for (const candidate of target.querySelectorAll<HTMLElement>('[data-terminal-tab-id]')) {
    if (candidate.dataset.terminalTabId === parsed.tabId) {
      selectedRoot = candidate
      break
    }
  }
  if (!selectedRoot) {
    return { hasSelectedRoot: false, ready: false, unavailable: false }
  }

  const { foundAnyPane, pane: selectedPane } = findTerminalPortalPane(selectedRoot, parsed.leafId)
  if (!selectedPane) {
    return { hasSelectedRoot: true, ready: false, unavailable: foundAnyPane }
  }

  const unavailable = hasInlineDisplayNoneBetween(selectedPane, selectedRoot)
  const hasUnisolatedSibling = hasUnhiddenSiblingPane(selectedRoot, selectedPane)
  const isVisibleRoot =
    !unavailable && (selectedPane.offsetParent !== null || selectedPane.getClientRects().length > 0)
  const hasPtyBinding =
    selectedPane.hasAttribute('data-pty-id') ||
    selectedPane.querySelector<HTMLElement>('[data-pty-id]') !== null
  const hasXtermScreen = selectedPane.querySelector<HTMLElement>('.xterm-screen') !== null
  return {
    hasSelectedRoot: true,
    ready: isVisibleRoot && !hasUnisolatedSibling && hasPtyBinding && hasXtermScreen,
    unavailable
  }
}

export function useTerminalPortalStatus(
  target: HTMLElement | null,
  paneKey: string | null,
  forceUnavailable = false,
  timeoutUnavailable = false
): TerminalPortalReadinessStatus {
  const [readiness, setReadiness] = useState<TerminalPortalReadiness>({
    target: null,
    paneKey: null,
    status: 'loading'
  })

  useLayoutEffect(() => {
    if (!target || !paneKey) {
      setReadiness((prev) =>
        prev.target === null && prev.paneKey === null && prev.status === 'loading'
          ? prev
          : { target: null, paneKey: null, status: 'loading' }
      )
      return
    }
    if (forceUnavailable) {
      setReadiness((prev) =>
        prev.target === target && prev.paneKey === paneKey && prev.status === 'unavailable'
          ? prev
          : { target, paneKey, status: 'unavailable' }
      )
      return
    }

    let disposed = false
    let readyFrame: number | null = null
    let unavailableTimer: ReturnType<typeof setTimeout> | null = null
    let sawUnreadySelectedRoot = false

    const updateReadiness = (status: TerminalPortalReadinessStatus): void => {
      setReadiness((prev) =>
        prev.target === target && prev.paneKey === paneKey && prev.status === status
          ? prev
          : { target, paneKey, status }
      )
    }

    const cancelReadyFrame = (): void => {
      if (readyFrame !== null) {
        cancelAnimationFrame(readyFrame)
        readyFrame = null
      }
    }

    const cancelUnavailableTimer = (): void => {
      if (unavailableTimer !== null) {
        clearTimeout(unavailableTimer)
        unavailableTimer = null
      }
    }

    const scheduleUnavailableTimeout = (): void => {
      if (unavailableTimer !== null) {
        return
      }
      // Why: a portal target can exist before the hidden TerminalPane root has
      // mounted. Bound the waiting state, but keep observing so a late mount
      // still recovers to ready without reopening the popover.
      unavailableTimer = setTimeout(() => {
        unavailableTimer = null
        if (!disposed) {
          updateReadiness('unavailable')
        }
      }, TERMINAL_PORTAL_UNAVAILABLE_TIMEOUT_MS)
    }

    const checkReadiness = (): void => {
      const status = getSelectedTerminalPortalStatus(target, paneKey)
      if (status.unavailable) {
        cancelReadyFrame()
        cancelUnavailableTimer()
        updateReadiness('unavailable')
        return
      }
      if (status.ready) {
        cancelUnavailableTimer()
        if (!sawUnreadySelectedRoot) {
          cancelReadyFrame()
          updateReadiness('ready')
          return
        }
        if (readyFrame !== null) {
          return
        }
        // Why: the PTY id can appear before xterm has painted replayed output.
        // Waiting one frame keeps the cover in place for the blank canvas frame.
        readyFrame = requestAnimationFrame(() => {
          readyFrame = null
          if (!disposed && getSelectedTerminalPortalStatus(target, paneKey).ready) {
            updateReadiness('ready')
          }
        })
        return
      }
      if (status.hasSelectedRoot) {
        sawUnreadySelectedRoot = true
      }
      cancelReadyFrame()
      if (timeoutUnavailable) {
        scheduleUnavailableTimeout()
      } else {
        cancelUnavailableTimer()
      }
      updateReadiness('loading')
    }

    updateReadiness('loading')
    checkReadiness()

    const observer = new MutationObserver(checkReadiness)
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-terminal-tab-id', 'data-leaf-id', 'data-pty-id', 'style']
    })

    return () => {
      disposed = true
      cancelReadyFrame()
      cancelUnavailableTimer()
      observer.disconnect()
    }
  }, [target, paneKey, forceUnavailable, timeoutUnavailable])

  return readiness.target === target && readiness.paneKey === paneKey ? readiness.status : 'loading'
}

export function useTerminalPortalLoadingLabel(loading: boolean): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!loading) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), TERMINAL_PORTAL_LOADING_LABEL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [loading])

  return visible
}

export function TerminalPortalUnavailableNotice({
  reason = 'unavailable',
  className
}: {
  reason?: 'unavailable' | 'already-open-activity' | 'closed' | 'standalone'
  className?: string
}): React.JSX.Element {
  const label =
    reason === 'already-open-activity'
      ? 'Already open in Activity'
      : reason === 'closed'
        ? 'Agent terminal closed. Open a new terminal in this workspace to continue.'
        : reason === 'standalone'
          ? 'Standalone terminal unavailable in Activity.'
          : 'Terminal unavailable'
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground',
        className
      )}
    >
      <TerminalSquare className="size-7" />
      <span>{label}</span>
    </div>
  )
}

export function TerminalPortalStatusChip({
  status
}: {
  status: 'loading' | 'unavailable'
}): React.JSX.Element {
  return (
    <div className="ml-3 mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-xs">
      <span
        className={cn(
          'h-3 w-1.5 rounded-sm bg-muted-foreground/70',
          status === 'loading' && 'animate-pulse'
        )}
      />
      <span>{status === 'loading' ? 'Connecting terminal...' : 'Terminal unavailable'}</span>
    </div>
  )
}
