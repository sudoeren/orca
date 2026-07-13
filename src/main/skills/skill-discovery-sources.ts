import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { Priority, SkillDiscoverySource, SkillProvider, SkillSourceKind } from '../../shared/skills'
import type { Repo } from '../../shared/types'

export type SkillScanRoot = Omit<SkillDiscoverySource, 'exists' | 'skippedReason'> & {
  priority: Priority
}

export const ALL_PROVIDERS: readonly SkillProvider[] = [
  'codex',
  'claude',
  'agent-skills',
  'pi',
  'opencode',
  'cursor',
  'windsurf',
  'warp',
  'github-copilot'
] as const

let lastProviderHash: string | null = null
const rootCache = new Map<string, SkillScanRoot[]>()

export function isCacheStale(): boolean {
  const currentHash = createHash('sha1')
    .update(ALL_PROVIDERS.join(','))
    .digest('hex')
  if (lastProviderHash !== null && lastProviderHash !== currentHash) {
    lastProviderHash = currentHash
    rootCache.clear()
    return true
  }
  lastProviderHash = currentHash
  return false
}

export function resetCache(): void {
  lastProviderHash = null
  rootCache.clear()
}

export function stablePathId(pathValue: string): string {
  return createHash('sha1').update(pathValue).digest('hex').slice(0, 16)
}

function source(
  id: string,
  label: string,
  path: string,
  sourceKind: SkillSourceKind,
  providers: SkillProvider[]
): SkillScanRoot {
  const isGeneric = providers.length === 1 && providers[0] === 'agent-skills'
  return {
    id,
    label,
    path,
    sourceKind,
    providers,
    priority: isGeneric ? 3 : 1
  }
}

export function buildSkillDiscoverySources(
  args: {
    homeDir?: string
    cwd?: string
    repos?: Repo[]
  } = {}
): SkillScanRoot[] {
  const home = args.homeDir ?? homedir()
  const cwd = args.cwd ?? process.cwd()

  const cacheKey = `${home}|${cwd}`
  const cached = rootCache.get(cacheKey)
  if (cached !== undefined && !isCacheStale()) {
    return cached
  }

  const roots: SkillScanRoot[] = [
    source('home-codex', 'Codex home', join(home, '.codex', 'skills'), 'home', ['codex']),
    source('home-agents', 'Agent skills home', join(home, '.agents', 'skills'), 'home', [
      'agent-skills'
    ]),
    source('home-claude', 'Claude home', join(home, '.claude', 'skills'), 'home', ['claude']),
    source(
      'codex-plugin-cache',
      'Codex plugin cache',
      join(home, '.codex', 'plugins', 'cache'),
      'plugin',
      ['codex', 'agent-skills']
    ),
    source('home-pi', 'Pi home', join(home, '.pi', 'agent', 'skills'), 'home', ['pi']),
    source(
      'home-opencode',
      'OpenCode home',
      join(home, '.opencode', 'skills'),
      'home',
      ['opencode']
    ),
    source(
      'home-cursor',
      'Cursor home',
      join(home, '.cursor', 'skills'),
      'home',
      ['cursor']
    ),
    source(
      'home-windsurf',
      'Windsurf home',
      join(home, '.windsurf', 'skills'),
      'home',
      ['windsurf']
    ),
    source('home-warp', 'Warp home', join(home, '.warp', 'skills'), 'home', ['warp']),
    source(
      'home-github-copilot',
      'GitHub Copilot home',
      join(home, '.github-copilot', 'skills'),
      'home',
      ['github-copilot']
    )
  ]

  const projectPaths = new Set<string>()
  for (const repo of args.repos ?? []) {
    if (repo.connectionId) {
      continue
    }
    projectPaths.add(repo.path)
  }
  projectPaths.add(cwd)

  for (const repoPath of projectPaths) {
    const label = `Repo ${basename(repoPath)}`
    roots.push(
      source(
        `repo-agents-${stablePathId(repoPath)}`,
        `${label} .agents`,
        join(repoPath, '.agents', 'skills'),
        'repo',
        ['agent-skills']
      ),
      source(
        `repo-claude-${stablePathId(repoPath)}`,
        `${label} .claude`,
        join(repoPath, '.claude', 'skills'),
        'repo',
        ['claude']
      )
    )
  }

  rootCache.set(cacheKey, roots)
  isCacheStale()
  return roots
}
