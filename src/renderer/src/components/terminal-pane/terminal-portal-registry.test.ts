import { afterEach, describe, expect, it } from 'vitest'
import {
  clearTerminalPortalSlot,
  findTerminalPortal,
  publishTerminalPortalSlot,
  setTerminalPortals
} from './terminal-portal-registry'
import {
  findActivityTerminalPortal,
  setActivityTerminalPortals
} from '../activity/activity-terminal-portal'

function target(): HTMLElement {
  return {} as HTMLElement
}

afterEach(() => {
  setActivityTerminalPortals([])
  setTerminalPortals([])
})

describe('terminal portal registry', () => {
  it('publishes per-slot descriptors with purpose-qualified matching', () => {
    const published = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'agent-popover:wt-1:tab-1:tab-1:leaf-1',
      requestToken: '1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })

    expect(
      findTerminalPortal([published], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        purpose: 'activity'
      })
    ).toBeNull()
    expect(
      findTerminalPortal([published], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        purpose: 'agent-popover'
      })?.slotId
    ).toBe('agent-popover:wt-1:tab-1:tab-1:leaf-1')
  })

  it('ignores stale clears for the same slot', () => {
    const published = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'slot-1',
      requestToken: '2',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })

    expect(clearTerminalPortalSlot('slot-1', '1')).toBe(false)
    expect(
      findTerminalPortal([published], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        purpose: 'agent-popover'
      })?.requestToken
    ).toBe('2')
    expect(clearTerminalPortalSlot('slot-1', '2')).toBe(true)
  })

  it('ignores stale numeric publishes for the same slot', () => {
    const newest = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'slot-1',
      requestToken: '3',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })

    const stale = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'slot-1',
      requestToken: '2',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })

    expect(stale.requestToken).toBe('3')
    expect(stale.target).toBe(newest.target)
  })

  it('gives Activity deterministic ownership over the same pane route', () => {
    const popover = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'popover',
      requestToken: '1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })
    const activity = publishTerminalPortalSlot({
      purpose: 'activity',
      slotId: 'primary',
      requestToken: 'primary:tab-1:leaf-1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
      active: true
    })

    expect(
      findTerminalPortal([popover, activity], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1'
      })?.purpose
    ).toBe('activity')
  })

  it('uses publish order across different panes in the same terminal tab', () => {
    const activity = publishTerminalPortalSlot({
      purpose: 'activity',
      slotId: 'primary',
      requestToken: '1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-a',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-a' },
      active: true
    })
    const popover = publishTerminalPortalSlot({
      purpose: 'agent-popover',
      slotId: 'popover',
      requestToken: '1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-b',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-b' },
      active: true
    })

    expect(
      findTerminalPortal([activity, popover], {
        worktreeId: 'wt-1',
        tabId: 'tab-1'
      })?.slotId
    ).toBe('popover')
  })

  it('finds an Activity owner by terminal tab when the queried pane is a sibling', () => {
    const activity = publishTerminalPortalSlot({
      purpose: 'activity',
      slotId: 'primary',
      requestToken: '1',
      target: target(),
      worktreeId: 'wt-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-a',
      paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-a' },
      active: true
    })

    expect(
      findTerminalPortal([activity], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        purpose: 'activity'
      })?.paneKey
    ).toBe('tab-1:leaf-a')
    expect(
      findTerminalPortal([activity], {
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-b',
        purpose: 'activity'
      })
    ).toBeNull()
  })

  it('keeps Activity compatibility APIs backed by the neutral registry', () => {
    const el = target()
    setActivityTerminalPortals([
      {
        slotId: 'primary',
        requestToken: 'primary:tab-1:leaf-1',
        target: el,
        worktreeId: 'wt-1',
        tabId: 'tab-1',
        paneKey: 'tab-1:leaf-1',
        active: true
      }
    ])

    const found = findActivityTerminalPortal(
      [
        {
          purpose: 'activity',
          slotId: 'primary',
          requestToken: 'primary:tab-1:leaf-1',
          target: el,
          worktreeId: 'wt-1',
          tabId: 'tab-1',
          paneKey: 'tab-1:leaf-1',
          paneRouteKey: { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' },
          active: true,
          publishOrder: 1
        }
      ],
      { worktreeId: 'wt-1', tabId: 'tab-1', paneKey: 'tab-1:leaf-1' }
    )

    expect(found?.target).toBe(el)
  })
})
