/* eslint-disable max-lines -- Activity E2E keeps the setup helpers beside the split-pane, split-group, and workspace-card routing assertions they support. */
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  splitActiveTerminalPane,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForPaneIdentitySnapshot,
  type PaneIdentitySnapshot
} from './helpers/terminal'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  switchToOtherWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'

type SeededActivityThread = {
  paneKey: string
  leafId: string
  prompt: string
}

type ActivityPaneVisibility = {
  slotId: string | null
  allLeafIds: string[]
  visibleLeafIds: string[]
}

type ActivePaneSelection = {
  activeWorktreeId: string | null
  activeGroupId: string | null
  activeTabId: string | null
  activeLeafId: string | null
  activePaneId: number | null
}

type SplitGroupTerminal = {
  sourceGroupId: string
  groupId: string
  tabId: string
}

type TerminalPopoverDomSnapshot = {
  activeWorktreeId: string | null
  tabIds: string[]
  ptyIdsByLeafId: Record<string, string>
  popoverText: string
  hasArrow: boolean
  terminalRootCountForTab: number
  terminalRootInsidePopover: boolean
  leafIdsInsidePopover: string[]
  hasXtermScreen: boolean
}

async function seedActivityThread(
  page: Page,
  thread: SeededActivityThread,
  title: string,
  state: 'blocked' | 'done',
  message: string,
  startedAt: number
): Promise<void> {
  await page.evaluate(
    ({ thread, title, state, message, startedAt }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }

      store.getState().setAgentStatus(
        thread.paneKey,
        {
          state,
          prompt: thread.prompt,
          agentType: 'codex',
          lastAssistantMessage: message
        },
        title,
        { updatedAt: startedAt, stateStartedAt: startedAt }
      )
    },
    { thread, title, state, message, startedAt }
  )
}

async function seedActivityThreadsForSplitPanes(
  page: Page,
  snapshot: PaneIdentitySnapshot
): Promise<[SeededActivityThread, SeededActivityThread]> {
  const [firstPane, secondPane] = snapshot.panes
  if (!firstPane || !secondPane) {
    throw new Error('Activity pane isolation test needs two split panes')
  }

  const now = Date.now()
  const first: SeededActivityThread = {
    paneKey: `${snapshot.tabId}:${firstPane.leafId}`,
    leafId: firstPane.leafId,
    prompt: `ACTIVITY_UUID_LEFT_${now}`
  }
  const second: SeededActivityThread = {
    paneKey: `${snapshot.tabId}:${secondPane.leafId}`,
    leafId: secondPane.leafId,
    prompt: `ACTIVITY_UUID_RIGHT_${now}`
  }

  await seedActivityThread(
    page,
    first,
    'Codex left pane',
    'blocked',
    'Left pane is waiting for user input.',
    now - 2_000
  )
  await seedActivityThread(
    page,
    second,
    'Codex right pane',
    'done',
    'Right pane finished its turn.',
    now - 1_000
  )

  return [first, second]
}

async function readActivityPaneVisibility(page: Page): Promise<ActivityPaneVisibility> {
  return page.evaluate(() => {
    const slot = document.querySelector<HTMLElement>(
      '[data-activity-terminal-slot-id]:not([aria-hidden="true"])'
    )
    if (!slot) {
      return { slotId: null, allLeafIds: [], visibleLeafIds: [] }
    }

    const hasInlineDisplayNoneBetween = (element: HTMLElement, root: HTMLElement): boolean => {
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

    const panes = Array.from(slot.querySelectorAll<HTMLElement>('[data-leaf-id]'))
    return {
      slotId: slot.dataset.activityTerminalSlotId ?? null,
      allLeafIds: panes.map((pane) => pane.dataset.leafId ?? ''),
      visibleLeafIds: panes
        .filter((pane) => !hasInlineDisplayNoneBetween(pane, slot))
        .map((pane) => pane.dataset.leafId ?? '')
    }
  })
}

async function enableInlineAgentCards(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }

    const state = store.getState()
    if (!state.worktreeCardProperties.includes('inline-agents')) {
      state.toggleWorktreeCardProperty('inline-agents')
    }
    state.closeActivityPage()
  })
}

async function enableAgentTerminalPopover(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const settings = await window.api.settings.set({ experimentalAgentTerminalPopover: true })
    // Why: settings persistence is async to the main process; update the
    // renderer store in-place so the next hover observes the experimental flag.
    window.__store?.setState({ settings })
  })
}

async function enableActivityAgentsView(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const settings = await window.api.settings.set({ experimentalActivity: true })
    // Why: these specs exercise the experimental Agents page. E2E profiles use
    // production defaults, where the sidebar entry is hidden unless enabled.
    window.__store?.setState({ settings })
  })
}

async function seedRetainedAgentRow(
  page: Page,
  worktreeId: string,
  thread: SeededActivityThread,
  startedAt: number
): Promise<void> {
  await page.evaluate(
    ({ worktreeId, thread, startedAt }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const tab = {
        id: thread.paneKey.split(':')[0],
        ptyId: null,
        worktreeId,
        title: 'Retained stale terminal',
        customTitle: null,
        color: null,
        sortOrder: 10_000,
        createdAt: startedAt
      }
      const entry = {
        state: 'done' as const,
        prompt: thread.prompt,
        agentType: 'codex' as const,
        paneKey: thread.paneKey,
        updatedAt: startedAt,
        stateStartedAt: startedAt,
        stateHistory: []
      }

      store.setState((state) => ({
        retainedAgentsByPaneKey: {
          ...state.retainedAgentsByPaneKey,
          [thread.paneKey]: {
            worktreeId,
            entry,
            tab,
            agentType: 'codex' as const,
            startedAt
          }
        }
      }))
    },
    { worktreeId, thread, startedAt }
  )
}

async function clickWorkspaceCardAgentRow(page: Page, prompt: string): Promise<void> {
  const rowLabel = page
    .getByRole('group', { name: 'Agents' })
    .locator(`span[title="${prompt}"]`)
    .first()
  await expect(rowLabel).toBeVisible({ timeout: 10_000 })
  await rowLabel.click()
}

async function readTerminalPopoverDomSnapshot(
  page: Page,
  tabId: string
): Promise<TerminalPopoverDomSnapshot> {
  return page.evaluate((tabId) => {
    const store = window.__store
    const activeWorktreeId = store?.getState().activeWorktreeId ?? null
    const tabIds = activeWorktreeId
      ? (store?.getState().tabsByWorktree[activeWorktreeId] ?? []).map((tab) => tab.id)
      : []
    const ptyIdsByLeafId = store?.getState().terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId ?? {}
    const popover = document.querySelector<HTMLElement>('[data-agent-terminal-popover-content]')
    const terminalRootsForTab = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-terminal-tab-id="${tabId}"]`)
    )
    const terminalRootInsidePopover =
      popover !== null && terminalRootsForTab.some((root) => popover.contains(root))
    const leafIdsInsidePopover = popover
      ? Array.from(popover.querySelectorAll<HTMLElement>('[data-leaf-id]')).map(
          (pane) => pane.dataset.leafId ?? ''
        )
      : []

    return {
      activeWorktreeId,
      tabIds,
      ptyIdsByLeafId,
      popoverText: popover?.innerText ?? '',
      hasArrow: Boolean(popover?.querySelector('[data-slot="popover-arrow"]')),
      terminalRootCountForTab: terminalRootsForTab.length,
      terminalRootInsidePopover,
      leafIdsInsidePopover,
      hasXtermScreen: Boolean(popover?.querySelector('.xterm-screen'))
    }
  }, tabId)
}

async function readTerminalTabContent(page: Page, tabId: string): Promise<string> {
  return page.evaluate((tabId) => {
    const manager = window.__paneManagers?.get(tabId)
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    return pane?.serializeAddon?.serialize?.() ?? ''
  }, tabId)
}

async function readActivePaneSelection(page: Page): Promise<ActivePaneSelection> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      return {
        activeWorktreeId: null,
        activeGroupId: null,
        activeTabId: null,
        activeLeafId: null,
        activePaneId: null
      }
    }

    const state = store.getState()
    const activeWorktreeId = state.activeWorktreeId ?? null
    const activeGroupId = activeWorktreeId
      ? (state.activeGroupIdByWorktree[activeWorktreeId] ?? null)
      : null
    const activeTabId = state.activeTabId ?? null
    const activePane = activeTabId
      ? (window.__paneManagers?.get(activeTabId)?.getActivePane?.() ?? null)
      : null

    return {
      activeWorktreeId,
      activeGroupId,
      activeTabId,
      activeLeafId: activePane?.leafId ?? null,
      activePaneId: activePane?.id ?? null
    }
  })
}

async function createTerminalInNewSplitGroup(page: Page): Promise<SplitGroupTerminal> {
  return page.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    const state = store.getState()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      throw new Error('No active worktree for split-group terminal setup')
    }
    const sourceGroupId =
      state.activeGroupIdByWorktree[worktreeId] ?? state.groupsByWorktree[worktreeId]?.[0]?.id
    if (!sourceGroupId) {
      throw new Error('No source group for split-group terminal setup')
    }

    const groupId = state.createEmptySplitGroup(worktreeId, sourceGroupId, 'right')
    if (!groupId) {
      throw new Error('Failed to create split group')
    }

    const tab = state.createTab(worktreeId, groupId, undefined, { activate: true })
    state.focusGroup(worktreeId, groupId)
    state.setActiveTab(tab.id)
    state.setActiveTabType('terminal')
    return { sourceGroupId, groupId, tabId: tab.id }
  })
}

test.describe('Activity Agent Pane Isolation', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await enableActivityAgentsView(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const hasPaneManager = await waitForActiveTerminalManager(orcaPage, 30_000)
      .then(() => true)
      .catch(() => false)
    test.skip(
      !hasPaneManager,
      'Electron automation in this environment never mounts the live TerminalPane manager, so Activity pane isolation would only fail on harness setup.'
    )
    await waitForPaneCount(orcaPage, 1, 30_000)
  })

  test('selecting agent rows isolates the matching split pane by stable leaf id', async ({
    orcaPage
  }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const [first, second] = await seedActivityThreadsForSplitPanes(orcaPage, snapshot)

    await orcaPage.getByRole('button', { name: /Agents/ }).click()
    await expect(orcaPage.getByText(first.prompt)).toBeVisible()
    await expect(orcaPage.getByText(second.prompt)).toBeVisible()

    await orcaPage.getByRole('button').filter({ hasText: first.prompt }).first().click()
    await expect
      .poll(async () => readActivityPaneVisibility(orcaPage), {
        timeout: 10_000,
        message: 'Activity did not isolate the first selected split pane'
      })
      .toMatchObject({
        allLeafIds: expect.arrayContaining([first.leafId, second.leafId]),
        visibleLeafIds: [first.leafId]
      })

    await orcaPage.getByRole('button').filter({ hasText: second.prompt }).first().click()
    await expect
      .poll(async () => readActivityPaneVisibility(orcaPage), {
        timeout: 10_000,
        message: 'Activity did not switch isolation to the second selected split pane'
      })
      .toMatchObject({
        allLeafIds: expect.arrayContaining([first.leafId, second.leafId]),
        visibleLeafIds: [second.leafId]
      })
  })

  test('acknowledged stable pane keys clear the Agents unread badge', async ({ orcaPage }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const firstPane = snapshot.panes[0]
    if (!firstPane) {
      throw new Error('Activity acknowledgement test needs a split pane')
    }
    const now = Date.now()
    const thread: SeededActivityThread = {
      paneKey: `${snapshot.tabId}:${firstPane.leafId}`,
      leafId: firstPane.leafId,
      prompt: `ACTIVITY_ACK_STABLE_PANE_${now}`
    }

    await orcaPage.evaluate(() => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      for (const worktree of Object.values(state.worktreesByRepo).flat()) {
        state.markWorktreeVisited(worktree.id)
      }
    })

    await seedActivityThread(
      orcaPage,
      thread,
      'Codex acknowledged pane',
      'blocked',
      'Waiting for acknowledgement migration coverage.',
      now - 5_000
    )

    await expect(orcaPage.getByRole('button', { name: /^Agents\s+1$/ })).toBeVisible()

    await orcaPage.evaluate((paneKey) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      store.getState().acknowledgeAgents([paneKey])
    }, thread.paneKey)

    await expect(orcaPage.getByRole('button', { name: /^Agents$/ })).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: /^Agents\s+1$/ })).toHaveCount(0)
  })

  test('workspace card agent rows focus the matching terminal split pane', async ({ orcaPage }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const [first, second] = await seedActivityThreadsForSplitPanes(orcaPage, snapshot)

    await enableInlineAgentCards(orcaPage)

    await clickWorkspaceCardAgentRow(orcaPage, first.prompt)
    await expect
      .poll(async () => readActivePaneSelection(orcaPage), {
        timeout: 10_000,
        message: 'Workspace-card row did not focus the first split pane'
      })
      .toMatchObject({
        activeTabId: snapshot.tabId,
        activeLeafId: first.leafId
      })

    await clickWorkspaceCardAgentRow(orcaPage, second.prompt)
    await expect
      .poll(async () => readActivePaneSelection(orcaPage), {
        timeout: 10_000,
        message: 'Workspace-card row did not focus the second split pane'
      })
      .toMatchObject({
        activeTabId: snapshot.tabId,
        activeLeafId: second.leafId
      })
  })

  test('hovering the workspace-card agent row portals the existing terminal with a right-side arrow', async ({
    orcaPage
  }) => {
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 1)
    const pane = snapshot.panes[0]
    if (!pane) {
      throw new Error('Agent terminal popover test needs a mounted terminal pane')
    }
    const now = Date.now()
    const thread: SeededActivityThread = {
      paneKey: `${snapshot.tabId}:${pane.leafId}`,
      leafId: pane.leafId,
      prompt: `AGENT_POPOVER_ROW_HITBOX_${now}`
    }
    await seedActivityThread(
      orcaPage,
      thread,
      'Codex row popover pane',
      'blocked',
      'Popover terminal is waiting for input.',
      now
    )
    await enableInlineAgentCards(orcaPage)
    await enableAgentTerminalPopover(orcaPage)

    const before = await readTerminalPopoverDomSnapshot(orcaPage, snapshot.tabId)
    const rowLabel = orcaPage
      .getByRole('group', { name: 'Agents' })
      .locator(`span[title="${thread.prompt}"]`)
      .first()
    await expect(rowLabel).toBeVisible({ timeout: 10_000 })

    // Why: this hovers the row text, not the status dot. The regression was a
    // dot-sized trigger that made the row hitbox feel broken.
    await rowLabel.hover()
    await expect(orcaPage.locator('[data-agent-terminal-popover-content]').first()).toBeVisible({
      timeout: 10_000
    })
    await expect(orcaPage.getByRole('button', { name: 'Focus terminal input' })).toHaveCount(0)

    const content = orcaPage.locator('[data-agent-terminal-popover-content]').first()
    await expect(content.getByRole('heading', { name: thread.prompt })).toBeVisible()
    await expect(content.locator('[data-slot="popover-arrow"]')).toBeVisible()
    await expect(content).not.toContainText(
      'Agent terminal closed. Open a new terminal in this workspace to continue.'
    )

    await expect
      .poll(async () => readTerminalPopoverDomSnapshot(orcaPage, snapshot.tabId), {
        timeout: 10_000,
        message: 'Agent terminal did not portal into the popover'
      })
      .toMatchObject({
        activeWorktreeId: before.activeWorktreeId,
        tabIds: before.tabIds,
        ptyIdsByLeafId: before.ptyIdsByLeafId,
        hasArrow: true,
        terminalRootCountForTab: 1,
        terminalRootInsidePopover: true,
        leafIdsInsidePopover: [thread.leafId],
        hasXtermScreen: true
      })

    const rowBox = await rowLabel
      .locator('xpath=ancestor::*[@data-agent-terminal-popover-anchor]')
      .boundingBox()
    const popoverBox = await content.boundingBox()
    const arrowBox = await content.locator('[data-slot="popover-arrow"]').boundingBox()
    expect(rowBox, 'agent row popover anchor should have a bounding box').not.toBeNull()
    expect(popoverBox, 'agent terminal popover should have a bounding box').not.toBeNull()
    expect(arrowBox, 'agent terminal popover arrow should have a bounding box').not.toBeNull()
    expect(popoverBox!.x).toBeGreaterThan(rowBox!.x + rowBox!.width - 2)
    const rowCenterY = rowBox!.y + rowBox!.height / 2
    const popoverCenterY = popoverBox!.y + popoverBox!.height / 2
    const arrowCenterY = arrowBox!.y + arrowBox!.height / 2
    expect(Math.abs(popoverCenterY - rowCenterY)).toBeLessThanOrEqual(2)
    expect(Math.abs(arrowCenterY - rowCenterY)).toBeLessThanOrEqual(2)

    // Why: the active terminal can move focus while being portaled. Keep the
    // row hovered long enough to catch focus-driven dismissals that make the
    // popover appear briefly and then disappear for normal users.
    await orcaPage.waitForTimeout(1_500)
    await expect(content).toBeVisible()
    await expect
      .poll(async () => readTerminalPopoverDomSnapshot(orcaPage, snapshot.tabId), {
        timeout: 5_000,
        message: 'Agent terminal popover did not remain open after the terminal focused itself'
      })
      .toMatchObject({
        terminalRootCountForTab: 1,
        terminalRootInsidePopover: true,
        leafIdsInsidePopover: [thread.leafId],
        hasXtermScreen: true
      })

    await content.locator('.xterm-screen').click({ position: { x: 12, y: 12 } })
    await orcaPage.waitForTimeout(600)
    await expect(content).toBeVisible()
    await expect
      .poll(async () => readTerminalPopoverDomSnapshot(orcaPage, snapshot.tabId), {
        timeout: 5_000,
        message: 'Agent terminal popover did not remain open after clicking the portaled xterm'
      })
      .toMatchObject({
        terminalRootCountForTab: 1,
        terminalRootInsidePopover: true,
        leafIdsInsidePopover: [thread.leafId],
        hasXtermScreen: true
      })
  })

  test('background workspace terminal popover accepts input without switching workspaces', async ({
    orcaPage
  }) => {
    const sourceWorktreeId = await waitForActiveWorktree(orcaPage)
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 1)
    const pane = snapshot.panes[0]
    if (!pane) {
      throw new Error('Background popover interaction test needs a mounted terminal pane')
    }
    const now = Date.now()
    const thread: SeededActivityThread = {
      paneKey: `${snapshot.tabId}:${pane.leafId}`,
      leafId: pane.leafId,
      prompt: `AGENT_POPOVER_BACKGROUND_INPUT_${now}`
    }
    await seedActivityThread(
      orcaPage,
      thread,
      'Codex background popover pane',
      'blocked',
      'Background workspace terminal is waiting for input.',
      now
    )
    await enableInlineAgentCards(orcaPage)
    await enableAgentTerminalPopover(orcaPage)

    const otherWorktreeId = await switchToOtherWorktree(orcaPage, sourceWorktreeId)
    test.skip(otherWorktreeId === null, 'Need at least two worktrees for background popover input')
    await expect
      .poll(async () => getActiveWorktreeId(orcaPage), { timeout: 5_000 })
      .toBe(otherWorktreeId)

    const rowLabel = orcaPage
      .getByRole('group', { name: 'Agents' })
      .locator(`span[title="${thread.prompt}"]`)
      .first()
    await expect(rowLabel).toBeVisible({ timeout: 10_000 })
    await rowLabel.hover()

    const content = orcaPage.locator('[data-agent-terminal-popover-content]').first()
    await expect(content.getByRole('heading', { name: thread.prompt })).toBeVisible({
      timeout: 10_000
    })
    await expect
      .poll(async () => readTerminalPopoverDomSnapshot(orcaPage, snapshot.tabId), {
        timeout: 10_000,
        message: 'Background agent terminal did not portal into the popover'
      })
      .toMatchObject({
        activeWorktreeId: otherWorktreeId,
        terminalRootInsidePopover: true,
        leafIdsInsidePopover: [thread.leafId],
        hasXtermScreen: true
      })

    const marker = `POPOVER_BACKGROUND_TYPED_${Date.now()}`
    await content.locator('.xterm-screen').click({ position: { x: 12, y: 12 } })
    await orcaPage.keyboard.type(marker)

    await expect
      .poll(async () => (await readTerminalTabContent(orcaPage, snapshot.tabId)).includes(marker), {
        timeout: 10_000,
        message: 'Typed text did not reach the background portaled terminal'
      })
      .toBe(true)
    await expect
      .poll(async () => getActiveWorktreeId(orcaPage), { timeout: 5_000 })
      .toBe(otherWorktreeId)
    await expect(content).toBeVisible()
  })

  test('hovering between adjacent workspace-card agent rows keeps one terminal popover open', async ({
    orcaPage
  }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    const snapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const [first, second] = await seedActivityThreadsForSplitPanes(orcaPage, snapshot)
    await enableInlineAgentCards(orcaPage)
    await enableAgentTerminalPopover(orcaPage)

    const agentsGroup = orcaPage.getByRole('group', { name: 'Agents' })
    const firstLabel = agentsGroup.locator(`span[title="${first.prompt}"]`).first()
    const secondLabel = agentsGroup.locator(`span[title="${second.prompt}"]`).first()
    await expect(firstLabel).toBeVisible({ timeout: 10_000 })
    await expect(secondLabel).toBeVisible({ timeout: 10_000 })

    const popovers = orcaPage.locator('[data-agent-terminal-popover-content]')
    await firstLabel.hover()
    await expect(orcaPage.getByRole('heading', { name: first.prompt })).toBeVisible({
      timeout: 10_000
    })
    await expect(popovers).toHaveCount(1)

    await secondLabel.hover()
    await expect(orcaPage.getByRole('heading', { name: second.prompt })).toBeVisible({
      timeout: 10_000
    })

    // Why: adjacent row hover should transfer ownership immediately. A delayed
    // close leaves two portaled terminal popovers visible while users move
    // through a dense agent list.
    const visiblePopoverCount = await popovers.evaluateAll(
      (nodes) =>
        nodes.filter((node) => {
          const element = node as HTMLElement
          const style = window.getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && rect.height > 0
        }).length
    )
    expect(visiblePopoverCount).toBe(1)
    expect(await orcaPage.getByRole('heading', { name: first.prompt }).count()).toBe(0)
  })

  test('stale retained agent rows do not open a closed-terminal popover on hover', async ({
    orcaPage
  }) => {
    const worktreeId = await waitForActiveWorktree(orcaPage)
    const now = Date.now()
    const staleThread: SeededActivityThread = {
      paneKey: `stale-tab-${now}:stale-leaf-${now}`,
      leafId: `stale-leaf-${now}`,
      prompt: `AGENT_POPOVER_STALE_ROW_${now}`
    }
    await seedRetainedAgentRow(orcaPage, worktreeId, staleThread, now)
    await enableInlineAgentCards(orcaPage)
    await enableAgentTerminalPopover(orcaPage)

    const rowLabel = orcaPage
      .getByRole('group', { name: 'Agents' })
      .locator(`span[title="${staleThread.prompt}"]`)
      .first()
    await expect(rowLabel).toBeVisible({ timeout: 10_000 })
    await rowLabel.hover()

    // Why: HOVER_OPEN_DELAY_MS is 120ms. Wait beyond it so this catches rows
    // that are incorrectly wired and open the old closed-terminal fallback.
    await orcaPage.waitForTimeout(350)
    await expect(orcaPage.locator('[data-agent-terminal-popover-content]')).toHaveCount(0)
    await expect(
      orcaPage.getByText(
        'Agent terminal closed. Open a new terminal in this workspace to continue.'
      )
    ).toHaveCount(0)
  })

  test('workspace card agent rows focus the matching split-group terminal pane', async ({
    orcaPage
  }) => {
    await splitActiveTerminalPane(orcaPage, 'vertical')
    await waitForPaneCount(orcaPage, 2)
    const firstGroupSnapshot = await waitForPaneIdentitySnapshot(orcaPage, 2)
    const [first, second] = await seedActivityThreadsForSplitPanes(orcaPage, firstGroupSnapshot)

    const splitGroup = await createTerminalInNewSplitGroup(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)
    await waitForPaneCount(orcaPage, 1, 30_000)
    const secondGroupSnapshot = await waitForPaneIdentitySnapshot(orcaPage, 1)
    const secondGroupPane = secondGroupSnapshot.panes[0]
    if (!secondGroupPane) {
      throw new Error('Split-group terminal did not mount a pane')
    }
    const now = Date.now()
    const splitGroupThread: SeededActivityThread = {
      paneKey: `${secondGroupSnapshot.tabId}:${secondGroupPane.leafId}`,
      leafId: secondGroupPane.leafId,
      prompt: `ACTIVITY_UUID_SPLIT_GROUP_${now}`
    }
    await seedActivityThread(
      orcaPage,
      splitGroupThread,
      'Codex split group pane',
      'blocked',
      'Split group pane is waiting for user input.',
      now
    )

    await enableInlineAgentCards(orcaPage)

    await clickWorkspaceCardAgentRow(orcaPage, splitGroupThread.prompt)
    await expect
      .poll(async () => readActivePaneSelection(orcaPage), {
        timeout: 10_000,
        message: 'Workspace-card row did not focus the split-group terminal pane'
      })
      .toMatchObject({
        activeGroupId: splitGroup.groupId,
        activeTabId: secondGroupSnapshot.tabId,
        activeLeafId: splitGroupThread.leafId
      })

    await clickWorkspaceCardAgentRow(orcaPage, first.prompt)
    await expect
      .poll(async () => readActivePaneSelection(orcaPage), {
        timeout: 10_000,
        message: 'Workspace-card row did not return to the first split group'
      })
      .toMatchObject({
        activeGroupId: splitGroup.sourceGroupId,
        activeTabId: firstGroupSnapshot.tabId,
        activeLeafId: first.leafId
      })

    await clickWorkspaceCardAgentRow(orcaPage, second.prompt)
    await expect
      .poll(async () => readActivePaneSelection(orcaPage), {
        timeout: 10_000,
        message: 'Workspace-card row did not focus the sibling pane after group switch'
      })
      .toMatchObject({
        activeGroupId: splitGroup.sourceGroupId,
        activeTabId: firstGroupSnapshot.tabId,
        activeLeafId: second.leafId
      })
  })
})
