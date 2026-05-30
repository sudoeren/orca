import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  TerminalPortalStatusChip,
  TerminalPortalUnavailableNotice,
  type TerminalPortalReadinessStatus
} from '../terminal-pane/terminal-portal-readiness'
import type { AgentTerminalPopoverUnavailableReason } from './agent-terminal-popover-behavior'

export function AgentTerminalPopoverSurface({
  agentName,
  hasLiveTab,
  activityOwnsTab,
  portalStatus,
  showLoadingLabel,
  unavailableReason,
  setPortalTarget,
  closePopover
}: {
  agentName: string
  hasLiveTab: boolean
  activityOwnsTab: boolean
  portalStatus: TerminalPortalReadinessStatus
  showLoadingLabel: boolean
  unavailableReason: AgentTerminalPopoverUnavailableReason
  setPortalTarget: (target: HTMLElement | null) => void
  closePopover: () => void
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col bg-popover text-popover-foreground">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xs font-medium leading-none" title={agentName}>
            {agentName}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Close agent terminal popover"
          onClick={closePopover}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {hasLiveTab && !activityOwnsTab ? (
        <div className="relative min-h-0 flex-1 overflow-hidden bg-editor-surface">
          <div
            ref={setPortalTarget}
            className="absolute inset-0 min-h-0 min-w-0"
            data-agent-terminal-popover-target=""
          />
          {portalStatus !== 'ready' ? (
            <div
              className="pointer-events-none absolute inset-0 z-20 bg-editor-surface"
              aria-hidden="true"
            >
              {portalStatus === 'unavailable' ? (
                <TerminalPortalStatusChip status="unavailable" />
              ) : showLoadingLabel ? (
                <TerminalPortalStatusChip status="loading" />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <TerminalPortalUnavailableNotice reason={unavailableReason} />
      )}
    </div>
  )
}
