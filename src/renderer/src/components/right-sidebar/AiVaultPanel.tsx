/* eslint-disable max-lines -- Why: the panel keeps filter state, grouped rows, and restore actions together so every resume path uses the same command builder. */
import { useVirtualizer } from '@tanstack/react-virtual'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  ArchiveRestore,
  Calendar,
  ChevronRight,
  Clock3,
  Copy,
  FileJson,
  FolderOpen,
  History,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import { AgentIcon } from '@/lib/agent-catalog'
import { CLIENT_PLATFORM } from '@/lib/new-workspace'
import { cn } from '@/lib/utils'
import { launchAiVaultSessionInNewTab } from '@/lib/launch-ai-vault-session'
import {
  AI_VAULT_SESSION_DRAG_END_EVENT,
  AI_VAULT_SESSION_DRAG_START_EVENT,
  writeAiVaultSessionDragData
} from '@/lib/ai-vault-session-drag'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import {
  agentLabel,
  filterAiVaultSessions,
  folderLabel,
  groupAiVaultSessions,
  type AiVaultSessionGroup
} from './ai-vault-session-filters'
import {
  AI_VAULT_AGENTS,
  buildAiVaultResumeCommand,
  type AiVaultAgent,
  type AiVaultGroup,
  type AiVaultListResult,
  type AiVaultScope,
  type AiVaultSession,
  type AiVaultSort
} from '../../../../shared/ai-vault-types'
import { isPathInsideOrEqual } from '../../../../shared/cross-platform-path'
import type { Repo } from '../../../../shared/types'

const SESSION_LIMIT = 500
const VAULT_ROW_OVERSCAN = 8

type AiVaultListRow =
  | { type: 'group'; group: AiVaultSessionGroup }
  | { type: 'session'; groupKey: string; session: AiVaultSession }

export default function AiVaultPanel(): React.JSX.Element {
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const agentCmdOverrides = useAppStore((s) => s.settings?.agentCmdOverrides ?? {})
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<AiVaultScope>('workspace')
  const [sort, setSort] = useState<AiVaultSort>('updated')
  const [group, setGroup] = useState<AiVaultGroup>('folder')
  const [agents, setAgents] = useState<AiVaultAgent[]>([...AI_VAULT_AGENTS])
  const [sessions, setSessions] = useState<AiVaultSession[]>([])
  const [scanResult, setScanResult] = useState<AiVaultListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const refreshIdRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const mountedRef = useRef(true)
  const listScrollRef = useRef<HTMLDivElement>(null)

  const isRemoteWorktree = Boolean(activeRepo?.connectionId)
  const activeWorktreePath = activeWorktree?.path ?? null
  const hasAllAgentsSelected = agents.length === AI_VAULT_AGENTS.length
  const viewAdjustmentCount =
    (hasAllAgentsSelected ? 0 : 1) + (sort === 'updated' ? 0 : 1) + (group === 'folder' ? 0 : 1)

  useEffect(() => {
    if (!activeWorktreePath && scope === 'workspace') {
      setScope('all')
    }
  }, [activeWorktreePath, scope])

  const refresh = useCallback(async (args: { force?: boolean } = {}): Promise<void> => {
    if (refreshInFlightRef.current) {
      return
    }

    refreshInFlightRef.current = true
    const refreshId = refreshIdRef.current + 1
    refreshIdRef.current = refreshId
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.aiVault.listSessions({
        limit: SESSION_LIMIT,
        force: args.force
      })
      if (!mountedRef.current || refreshIdRef.current !== refreshId) {
        return
      }
      setScanResult(result)
      setSessions(result.sessions)
    } catch (err) {
      if (mountedRef.current && refreshIdRef.current === refreshId) {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      refreshInFlightRef.current = false
      if (mountedRef.current && refreshIdRef.current === refreshId) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      refreshIdRef.current += 1
      refreshInFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const filteredSessions = useMemo(
    () =>
      filterAiVaultSessions(sessions, {
        query,
        agents,
        scope,
        sort,
        activeWorktreePath
      }),
    [activeWorktreePath, agents, query, scope, sessions, sort]
  )

  const groups = useMemo(
    () => groupAiVaultSessions(filteredSessions, group),
    [filteredSessions, group]
  )

  const vaultRows = useMemo(() => {
    const rows: AiVaultListRow[] = []
    for (const sessionGroup of groups) {
      rows.push({ type: 'group', group: sessionGroup })
      if (!collapsedGroups.has(sessionGroup.key)) {
        for (const session of sessionGroup.sessions) {
          rows.push({ type: 'session', groupKey: sessionGroup.key, session })
        }
      }
    }
    return rows
  }, [collapsedGroups, groups])

  const virtualizer = useVirtualizer({
    count: vaultRows.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: (index) => (vaultRows[index]?.type === 'group' ? 28 : 64),
    overscan: VAULT_ROW_OVERSCAN,
    getItemKey: (index) => {
      const row = vaultRows[index]
      if (!row) {
        return `missing:${index}`
      }
      return row.type === 'group' ? `group:${row.group.key}` : `session:${row.session.id}`
    }
  })

  const sessionRepoById = useMemo(() => {
    const matches = new Map<string, Repo>()
    for (const session of sessions) {
      const repo = findSessionRepo(session.cwd, repos, worktreesByRepo)
      if (repo) {
        matches.set(session.id, repo)
      }
    }
    return matches
  }, [repos, sessions, worktreesByRepo])

  const buildResumeCommand = useCallback(
    (session: AiVaultSession): string =>
      buildAiVaultResumeCommand({
        agent: session.agent,
        sessionId: session.sessionId,
        cwd: session.cwd,
        platform: CLIENT_PLATFORM,
        commandOverride: agentCmdOverrides[session.agent]
      }),
    [agentCmdOverrides]
  )

  const copyResumeCommand = useCallback(
    async (session: AiVaultSession): Promise<void> => {
      await window.api.ui.writeClipboardText(buildResumeCommand(session))
      toast.success('Resume command copied')
    },
    [buildResumeCommand]
  )

  const copyText = useCallback(async (text: string, label: string): Promise<void> => {
    await window.api.ui.writeClipboardText(text)
    toast.success(`${label} copied`)
  }, [])

  const handleResume = useCallback(
    (session: AiVaultSession): void => {
      if (!activeWorktree) {
        toast.error('Open a workspace before resuming a session.')
        return
      }
      if (isRemoteWorktree) {
        toast.error('Resume from history is only available in local workspaces.')
        return
      }
      launchAiVaultSessionInNewTab({
        agent: session.agent,
        worktreeId: activeWorktree.id,
        command: buildResumeCommand(session)
      })
      toast.success(`${agentLabel(session.agent)} session queued`)
    },
    [activeWorktree, buildResumeCommand, isRemoteWorktree]
  )

  const setAgentEnabled = useCallback((agent: AiVaultAgent, enabled: boolean) => {
    setAgents((current) => {
      if (enabled) {
        return current.includes(agent) ? current : [...current, agent]
      }
      const next = current.filter((entry) => entry !== agent)
      return next.length > 0 ? next : current
    })
  }, [])

  const resetViewOptions = useCallback(() => {
    setAgents([...AI_VAULT_AGENTS])
    setSort('updated')
    setGroup('folder')
  }, [])

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="shrink-0 border-b border-sidebar-border px-2.5 py-2">
        <div className="flex items-center gap-1.5">
          <History className="size-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">Session History</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {scanResult
                ? `${filteredSessions.length} shown · ${sessions.length} recent`
                : 'Resume past sessions'}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <VaultScopeSwitch
              scope={scope}
              workspaceAvailable={Boolean(activeWorktreePath)}
              onScopeChange={setScope}
            />
            <VaultViewMenu
              agents={agents}
              sort={sort}
              group={group}
              adjustmentCount={viewAdjustmentCount}
              onAgentEnabledChange={setAgentEnabled}
              onSortChange={setSort}
              onGroupChange={setGroup}
              onReset={resetViewOptions}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Refresh Session History"
              onClick={() => void refresh({ force: true })}
              disabled={loading}
              aria-busy={loading}
              className="size-7"
            >
              {loading ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="mt-2 flex h-8 items-center gap-1.5 rounded-md border border-sidebar-border bg-input/50 px-2 focus-within:border-sidebar-ring focus-within:ring-[2px] focus-within:ring-sidebar-ring/30">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search sessions"
            className="min-w-0 flex-1 bg-transparent py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/50"
            spellCheck={false}
          />
          {loading ? <LoaderCircle className="size-3 animate-spin text-muted-foreground" /> : null}
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-5 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>

      {isRemoteWorktree ? (
        <div className="border-b border-sidebar-border px-3 py-2 text-[11px] leading-4 text-muted-foreground">
          Remote workspaces can browse local history. Resume actions run from local workspaces.
        </div>
      ) : null}

      {error ? (
        <div className="border-b border-sidebar-border px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {scanResult && scanResult.issues.length > 0 ? (
        <div className="border-b border-sidebar-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {scanResult.issues.length} transcript{scanResult.issues.length === 1 ? '' : 's'} skipped
        </div>
      ) : null}

      <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
        {loading && sessions.length === 0 ? <SessionLoadingState /> : null}

        {!loading && sessions.length === 0 && !error ? (
          <EmptyState title="No agent sessions found" />
        ) : null}

        {sessions.length > 0 && filteredSessions.length === 0 ? (
          <EmptyState title="No sessions match the current filters" />
        ) : null}

        {vaultRows.length > 0 ? (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = vaultRows[virtualRow.index]
              if (!row) {
                return null
              }
              return (
                <div
                  key={virtualRow.key}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {row.type === 'group' ? (
                    <VaultGroupHeader
                      group={row.group}
                      collapsed={collapsedGroups.has(row.group.key)}
                      onToggle={() => toggleGroup(row.group.key)}
                    />
                  ) : (
                    <VaultSessionRow
                      session={row.session}
                      repo={sessionRepoById.get(row.session.id) ?? null}
                      resumeCommand={buildResumeCommand(row.session)}
                      resumeDisabled={!activeWorktree || isRemoteWorktree}
                      onResume={() => handleResume(row.session)}
                      onCopyResume={() => void copyResumeCommand(row.session)}
                      onCopyId={() => void copyText(row.session.sessionId, 'Session ID')}
                      onCopyPath={() => void copyText(row.session.filePath, 'Log path')}
                      onOpenLog={() => void window.api.shell.openFilePath(row.session.filePath)}
                      onRevealLog={() => void window.api.shell.openPath(row.session.filePath)}
                      onOpenCwd={
                        row.session.cwd
                          ? () => {
                              if (row.session.cwd) {
                                void window.api.shell.openPath(row.session.cwd)
                              }
                            }
                          : undefined
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function VaultGroupHeader({
  group,
  collapsed,
  onToggle
}: {
  group: AiVaultSessionGroup
  collapsed: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex h-7 w-full items-center gap-1.5 border-y border-sidebar-border bg-sidebar-accent/25 px-2.5 text-left text-[11px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent/45"
      onClick={onToggle}
    >
      <ChevronRight className={cn('size-3 transition-transform', !collapsed && 'rotate-90')} />
      <span className="min-w-0 flex-1 truncate">{group.label}</span>
      <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] leading-none text-sidebar-accent-foreground">
        {group.sessions.length}
      </span>
    </button>
  )
}

function SessionLoadingState(): React.JSX.Element {
  return (
    <div className="px-3 py-3" aria-busy="true">
      <div className="mb-3 flex items-center gap-2 text-[11px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>Scanning sessions</span>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex items-start gap-2">
            <div className="mt-1 size-4 rounded-full bg-sidebar-accent" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-3 w-4/5 rounded-sm bg-sidebar-accent" />
              <div className="h-2.5 w-3/5 rounded-sm bg-sidebar-accent/75" />
              <div className="h-2.5 w-2/5 rounded-sm bg-sidebar-accent/60" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function VaultScopeSwitch({
  scope,
  workspaceAvailable,
  onScopeChange
}: {
  scope: AiVaultScope
  workspaceAvailable: boolean
  onScopeChange: (scope: AiVaultScope) => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 min-w-9 shrink-0 border-sidebar-border bg-sidebar-accent/35 px-2 text-[11px] font-medium text-foreground shadow-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={`Session History scope: ${scope === 'workspace' ? 'current workspace' : 'all sessions'}`}
        >
          {scope === 'workspace' ? 'This' : 'All'}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-48">
        <DropdownMenuLabel>Scope</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope}
          onValueChange={(value) => onScopeChange(value as AiVaultScope)}
        >
          <DropdownMenuRadioItem value="workspace" disabled={!workspaceAvailable}>
            Current workspace
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="all">All sessions</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function VaultViewMenu({
  agents,
  sort,
  group,
  adjustmentCount,
  onAgentEnabledChange,
  onSortChange,
  onGroupChange,
  onReset
}: {
  agents: readonly AiVaultAgent[]
  sort: AiVaultSort
  group: AiVaultGroup
  adjustmentCount: number
  onAgentEnabledChange: (agent: AiVaultAgent, enabled: boolean) => void
  onSortChange: (sort: AiVaultSort) => void
  onGroupChange: (group: AiVaultGroup) => void
  onReset: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-xs"
          className="relative size-7 border-sidebar-border bg-sidebar-accent/35 text-foreground shadow-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Session History view options"
        >
          <ListFilter className="size-3.5" />
          <span className="sr-only">View options</span>
          {adjustmentCount > 0 ? (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium leading-none text-primary-foreground"
            >
              {adjustmentCount}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuLabel>Agents</DropdownMenuLabel>
        {AI_VAULT_AGENTS.map((agent) => (
          <DropdownMenuCheckboxItem
            key={agent}
            checked={agents.includes(agent)}
            disabled={agents.length === 1 && agents.includes(agent)}
            onCheckedChange={(checked) => onAgentEnabledChange(agent, checked === true)}
            onSelect={(event) => event.preventDefault()}
          >
            <AgentIcon agent={agent} size={14} />
            {agentLabel(agent)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort}
          onValueChange={(value) => onSortChange(value as AiVaultSort)}
        >
          <DropdownMenuRadioItem value="updated">
            <Clock3 className="size-3.5" />
            Last updated
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="created">
            <Calendar className="size-3.5" />
            Created
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Group</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={group}
          onValueChange={(value) => onGroupChange(value as AiVaultGroup)}
        >
          <DropdownMenuRadioItem value="folder">
            <FolderOpen className="size-3.5" />
            Folder
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="agent">
            <ArchiveRestore className="size-3.5" />
            Agent
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {adjustmentCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onReset}>Reset view</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmptyState({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
      <ArchiveRestore className="mb-3 size-7 opacity-50" />
      <p className="text-sm font-medium">{title}</p>
    </div>
  )
}

function findSessionRepo(
  cwd: string | null,
  repos: readonly Repo[],
  worktreesByRepo: Record<string, readonly { path: string }[] | undefined>
): Repo | null {
  if (!cwd) {
    return null
  }
  let bestRepo: Repo | null = null
  let bestPathLength = -1

  const consider = (repo: Repo, path: string): void => {
    if (!path || !isPathInsideOrEqual(path, cwd)) {
      return
    }
    if (path.length > bestPathLength) {
      bestRepo = repo
      bestPathLength = path.length
    }
  }

  for (const repo of repos) {
    consider(repo, repo.path)
    for (const worktree of worktreesByRepo[repo.id] ?? []) {
      consider(repo, worktree.path)
    }
  }

  return bestRepo
}

function VaultSessionRow({
  session,
  repo,
  resumeCommand,
  resumeDisabled,
  onResume,
  onCopyResume,
  onCopyId,
  onCopyPath,
  onOpenLog,
  onRevealLog,
  onOpenCwd
}: {
  session: AiVaultSession
  repo: Repo | null
  resumeCommand: string
  resumeDisabled: boolean
  onResume: () => void
  onCopyResume: () => void
  onCopyId: () => void
  onCopyPath: () => void
  onOpenLog: () => void
  onRevealLog: () => void
  onOpenCwd?: () => void
}): React.JSX.Element {
  const updatedAt = session.updatedAt ?? session.modifiedAt

  return (
    <HoverCard openDelay={350} closeDelay={80}>
      <ContextMenu>
        <HoverCardTrigger asChild>
          <ContextMenuTrigger asChild>
            <div
              draggable={!resumeDisabled}
              className={cn(
                'group relative flex min-h-[64px] w-full items-start border-b border-sidebar-border px-3 py-2 text-left transition-colors hover:bg-sidebar-accent/55',
                !resumeDisabled && 'cursor-grab active:cursor-grabbing'
              )}
              onDragStart={(event) => {
                if (resumeDisabled) {
                  event.preventDefault()
                  return
                }
                writeAiVaultSessionDragData(event.dataTransfer, {
                  agent: session.agent,
                  sessionId: session.sessionId,
                  title: session.title,
                  command: resumeCommand
                })
                window.dispatchEvent(new Event(AI_VAULT_SESSION_DRAG_START_EVENT))
              }}
              onDragEnd={() => {
                window.dispatchEvent(new Event(AI_VAULT_SESSION_DRAG_END_EVENT))
              }}
              onDoubleClick={() => {
                if (!resumeDisabled) {
                  onResume()
                }
              }}
            >
              <div className="min-w-0 flex-1 pr-16">
                <div className="truncate text-[13px] font-medium leading-5 text-foreground">
                  {session.title}
                </div>
                <SessionMetadata session={session} repo={repo} />
                <div className="mt-1 truncate font-mono text-[11px] leading-4 text-muted-foreground/75">
                  {folderLabel(session.cwd)}
                </div>
              </div>
              <SessionTime
                value={updatedAt}
                className="absolute right-3 top-2 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0"
              />
              <div className="pointer-events-none absolute right-2 top-1.5 flex items-center gap-1 rounded-md bg-sidebar/95 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Resume ${agentLabel(session.agent)} session`}
                  disabled={resumeDisabled}
                  onClick={(event) => {
                    event.stopPropagation()
                    onResume()
                  }}
                >
                  <Play className="size-3.5" />
                </Button>
                <SessionActionsMenu
                  session={session}
                  onResume={onResume}
                  onCopyResume={onCopyResume}
                  onCopyId={onCopyId}
                  onCopyPath={onCopyPath}
                  onOpenLog={onOpenLog}
                  onRevealLog={onRevealLog}
                  onOpenCwd={onOpenCwd}
                  resumeDisabled={resumeDisabled}
                />
              </div>
            </div>
          </ContextMenuTrigger>
        </HoverCardTrigger>
        <ContextMenuContent>
          <ContextMenuItem disabled={resumeDisabled} onSelect={onResume}>
            <Play className="size-3.5" />
            Resume in New Tab
          </ContextMenuItem>
          <ContextMenuItem onSelect={onCopyResume}>
            <Copy className="size-3.5" />
            Copy Resume Command
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onOpenLog}>
            <FileJson className="size-3.5" />
            Open Log
          </ContextMenuItem>
          <ContextMenuItem onSelect={onRevealLog}>
            <FolderOpen className="size-3.5" />
            Reveal Log
          </ContextMenuItem>
          {onOpenCwd ? (
            <ContextMenuItem onSelect={onOpenCwd}>
              <FolderOpen className="size-3.5" />
              Open Working Directory
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onCopyId}>Copy Session ID</ContextMenuItem>
          <ContextMenuItem onSelect={onCopyPath}>Copy Log Path</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <SessionDetailsHoverCard session={session} repo={repo} resumeCommand={resumeCommand} />
    </HoverCard>
  )
}

function SessionMetadata({
  session,
  repo
}: {
  session: AiVaultSession
  repo: Repo | null
}): React.JSX.Element {
  return (
    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <AgentIcon agent={session.agent} size={14} />
      </span>
      {repo ? (
        <RepoBadge repo={repo} />
      ) : (
        <span className="max-w-[7rem] truncate font-mono text-[10.5px] text-muted-foreground/85">
          {folderLabel(session.cwd)}
        </span>
      )}
      {session.model ? (
        <>
          <MetaDot />
          <span className="max-w-[92px] truncate">{session.model}</span>
        </>
      ) : null}
      {session.branch ? (
        <>
          <MetaDot />
          <span className="min-w-0 truncate text-muted-foreground/85">{session.branch}</span>
        </>
      ) : null}
      <MetaDot />
      <span className="shrink-0">{session.messageCount} msgs</span>
      {session.totalTokens > 0 ? (
        <>
          <MetaDot />
          <span className="shrink-0">{formatTokenCount(session.totalTokens)} tok</span>
        </>
      ) : null}
    </div>
  )
}

function RepoBadge({ repo }: { repo: Repo }): React.JSX.Element {
  return (
    <span className="flex h-[16px] max-w-[7rem] shrink-0 items-center gap-1.5 rounded-[4px] border border-border bg-accent px-1.5 leading-none dark:border-border/60 dark:bg-accent/50">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: repo.badgeColor }}
      />
      <span className="min-w-0 truncate text-[10px] font-semibold lowercase text-foreground">
        {repo.displayName}
      </span>
    </span>
  )
}

function SessionDetailsHoverCard({
  session,
  repo,
  resumeCommand
}: {
  session: AiVaultSession
  repo: Repo | null
  resumeCommand: string
}): React.JSX.Element {
  const updatedAt = session.updatedAt ?? session.modifiedAt

  return (
    <HoverCardContent
      side="left"
      align="start"
      sideOffset={8}
      className="scrollbar-sleek max-h-[min(28rem,calc(100vh-2rem))] w-80 overflow-y-auto p-3"
    >
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-muted-foreground">
            <AgentIcon agent={session.agent} size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-[13px] font-medium leading-5 text-popover-foreground">
              {session.title}
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">{agentLabel(session.agent)}</span>
              {repo ? (
                <>
                  <MetaDot />
                  <RepoBadge repo={repo} />
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-1.5 text-[11px] leading-4">
          <DetailLine label="Updated" value={formatDateTime(updatedAt)} />
          <DetailLine label="Created" value={formatDateTime(session.createdAt)} />
          <DetailLine label="Working dir" value={session.cwd ?? 'Unknown location'} mono />
          {session.branch ? <DetailLine label="Branch" value={session.branch} /> : null}
          {session.model ? <DetailLine label="Model" value={session.model} /> : null}
          <DetailLine
            label="Usage"
            value={`${session.messageCount} msgs${session.totalTokens > 0 ? ` · ${formatTokenCount(session.totalTokens)} tok` : ''}`}
          />
          <DetailLine label="Session" value={session.sessionId} mono />
        </div>

        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Latest log</div>
          {session.previewMessages.length > 0 ? (
            <div className="space-y-2">
              {session.previewMessages.map((message, index) => (
                <div key={`${message.role}:${index}`} className="min-w-0">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                    {previewRoleLabel(message.role)}
                  </div>
                  <div className="line-clamp-3 whitespace-pre-wrap text-[11px] leading-4 text-popover-foreground/90">
                    {message.text}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] leading-4 text-muted-foreground">
              No readable message preview in this transcript.
            </div>
          )}
        </div>

        <div className="mt-3 border-t border-border/60 pt-2">
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Resume command</div>
          <div className="line-clamp-3 break-all font-mono text-[10.5px] leading-4 text-popover-foreground/85">
            {resumeCommand}
          </div>
        </div>
      </div>
    </HoverCardContent>
  )
}

function DetailLine({
  label,
  value,
  mono = false
}: {
  label: string
  value: string
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate text-popover-foreground/90', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  )
}

function MetaDot(): React.JSX.Element {
  return <span className="shrink-0 text-muted-foreground/45">·</span>
}

function SessionActionsMenu({
  session,
  onResume,
  onCopyResume,
  onCopyId,
  onCopyPath,
  onOpenLog,
  onRevealLog,
  onOpenCwd,
  resumeDisabled
}: {
  session: AiVaultSession
  onResume: () => void
  onCopyResume: () => void
  onCopyId: () => void
  onCopyPath: () => void
  onOpenLog: () => void
  onRevealLog: () => void
  onOpenCwd?: () => void
  resumeDisabled: boolean
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${agentLabel(session.agent)} session actions`}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={resumeDisabled} onSelect={onResume}>
          <Play className="size-3.5" />
          Resume in New Tab
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyResume}>
          <Copy className="size-3.5" />
          Copy Resume Command
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenLog}>
          <FileJson className="size-3.5" />
          Open Log
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRevealLog}>
          <FolderOpen className="size-3.5" />
          Reveal Log
        </DropdownMenuItem>
        {onOpenCwd ? (
          <DropdownMenuItem onSelect={onOpenCwd}>
            <FolderOpen className="size-3.5" />
            Open Working Directory
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCopyId}>Copy Session ID</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyPath}>Copy Log Path</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SessionTime({
  value,
  className
}: {
  value: string
  className?: string
}): React.JSX.Element {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return (
      <span className={cn('shrink-0 text-[11px] text-muted-foreground', className)}>
        Unknown time
      </span>
    )
  }

  const date = new Date(timestamp)
  return (
    <span className={cn('shrink-0 text-[11px] text-muted-foreground', className)}>
      <time dateTime={date.toISOString()}>{formatTimeAgo(timestamp)}</time>
    </span>
  )
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return 'Unknown'
  }
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return 'Unknown'
  }
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function previewRoleLabel(role: AiVaultSession['previewMessages'][number]['role']): string {
  if (role === 'user') {
    return 'User'
  }
  if (role === 'assistant') {
    return 'Assistant'
  }
  if (role === 'tool') {
    return 'Tool'
  }
  if (role === 'system') {
    return 'System'
  }
  return 'Log'
}

function formatTimeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  if (diffMs < 60_000) {
    return 'Just now'
  }
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  if (days < 30) {
    return `${days}d ago`
  }
  const months = Math.floor(days / 30)
  if (months < 12) {
    return `${months}mo ago`
  }
  return `${Math.floor(months / 12)}y ago`
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`
  }
  return String(value)
}
