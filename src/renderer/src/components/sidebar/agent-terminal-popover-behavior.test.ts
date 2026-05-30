import { describe, expect, it } from 'vitest'
import {
  getAgentTerminalPopoverUnavailableReason,
  getAgentTerminalPortalActive,
  getAgentTerminalPortalEffect,
  registerAgentTerminalPopoverInputActivation,
  shouldOpenAgentTerminalPopoverOnFocus,
  shouldRestoreAgentTerminalPopoverFocusOnClose
} from './agent-terminal-popover-behavior'

describe('agent terminal popover behavior', () => {
  it('publishes only when the popover is open with a live tab, target, and token', () => {
    expect(
      getAgentTerminalPortalEffect({
        open: true,
        hasLiveTab: true,
        activityOwnsTab: false,
        hasPortalTarget: true,
        hasRequestToken: true,
        published: null
      })
    ).toEqual({ kind: 'publish' })

    expect(
      getAgentTerminalPortalEffect({
        open: true,
        hasLiveTab: false,
        activityOwnsTab: false,
        hasPortalTarget: true,
        hasRequestToken: true,
        published: null
      })
    ).toEqual({ kind: 'none' })
  })

  it('clears a published descriptor when closed, the tab disappears, or Activity owns the tab', () => {
    const published = { slotId: 'agent-popover:wt:tab:pane', requestToken: '4' }

    expect(
      getAgentTerminalPortalEffect({
        open: false,
        hasLiveTab: true,
        activityOwnsTab: false,
        hasPortalTarget: true,
        hasRequestToken: true,
        published
      })
    ).toEqual({ kind: 'clear', ...published })

    expect(
      getAgentTerminalPortalEffect({
        open: true,
        hasLiveTab: false,
        activityOwnsTab: false,
        hasPortalTarget: true,
        hasRequestToken: true,
        published
      })
    ).toEqual({ kind: 'clear', ...published })

    expect(
      getAgentTerminalPortalEffect({
        open: true,
        hasLiveTab: true,
        activityOwnsTab: true,
        hasPortalTarget: true,
        hasRequestToken: true,
        published
      })
    ).toEqual({ kind: 'clear', ...published })
  })

  it('surfaces unavailable reasons in Activity, closed-tab, and generic unavailable states', () => {
    expect(
      getAgentTerminalPopoverUnavailableReason({ activityOwnsTab: true, hasLiveTab: true })
    ).toBe('already-open-activity')
    expect(
      getAgentTerminalPopoverUnavailableReason({ activityOwnsTab: false, hasLiveTab: false })
    ).toBe('closed')
    expect(
      getAgentTerminalPopoverUnavailableReason({ activityOwnsTab: false, hasLiveTab: true })
    ).toBe('unavailable')
  })

  it('suppresses the focus-open handler once after an intentional close returns focus', () => {
    expect(
      shouldOpenAgentTerminalPopoverOnFocus({
        suppressNextFocusOpen: false,
        focusIsAnchor: true
      })
    ).toBe(true)
    expect(
      shouldOpenAgentTerminalPopoverOnFocus({
        suppressNextFocusOpen: true,
        focusIsAnchor: true
      })
    ).toBe(false)
  })

  it('does not open when focus moves to a child control inside the row', () => {
    expect(
      shouldOpenAgentTerminalPopoverOnFocus({
        suppressNextFocusOpen: false,
        focusIsAnchor: false
      })
    ).toBe(false)
  })

  it('keeps hover-open portals non-active until explicit terminal input handoff', () => {
    expect(getAgentTerminalPortalActive({ terminalInputActive: false })).toBe(false)
    expect(getAgentTerminalPortalActive({ terminalInputActive: true })).toBe(true)
  })

  it('activates terminal input from native portal-target pointer and focus events', () => {
    const target = new EventTarget()
    let activationCount = 0
    const dispose = registerAgentTerminalPopoverInputActivation(target, () => {
      activationCount += 1
    })

    target.dispatchEvent(new Event('pointerdown'))
    target.dispatchEvent(new Event('focusin'))
    expect(activationCount).toBe(2)

    dispose()
    target.dispatchEvent(new Event('pointerdown'))
    expect(activationCount).toBe(2)
  })

  it('restores focus only for focus-opened popovers, not pointer hover popovers', () => {
    expect(shouldRestoreAgentTerminalPopoverFocusOnClose({ openedByFocus: true })).toBe(true)
    expect(shouldRestoreAgentTerminalPopoverFocusOnClose({ openedByFocus: false })).toBe(false)
  })
})
