import { describe, expect, it, beforeEach } from 'vitest'
import { join } from 'node:path'
import {
  buildSkillDiscoverySources,
  resetCache
} from '../main/skills/skill-discovery-sources'
import {
  agentHasOrchestrationSkill,
  getOrchestrationSkillAgentStatuses
} from '../renderer/src/lib/orchestration-skill-coverage'
import type { DiscoveredSkill } from '../shared/skills'

const HOME = '/Users/test'

beforeEach(() => {
  resetCache()
})

function skill(overrides: Partial<DiscoveredSkill>): DiscoveredSkill {
  return {
    id: 'skill-1',
    name: 'orchestration',
    description: null,
    providers: ['pi'],
    sourceKind: 'home',
    sourceLabel: 'Pi home',
    rootPath: join(HOME, '.pi', 'agent', 'skills'),
    directoryPath: join(HOME, '.pi', 'agent', 'skills', 'orchestration'),
    skillFilePath: join(HOME, '.pi', 'agent', 'skills', 'orchestration', 'SKILL.md'),
    installed: true,
    fileCount: 1,
    updatedAt: null,
    ...overrides
  }
}

describe('agent skill scan roots', () => {
  it('scans ~/.pi/agent/skills for Pi skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.pi', 'agent', 'skills'))).toBe(true)
  })

  it('scans ~/.opencode/skills for OpenCode skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.opencode', 'skills'))).toBe(true)
  })

  it('scans ~/.cursor/skills for Cursor skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.cursor', 'skills'))).toBe(true)
  })

  it('scans ~/.windsurf/skills for Windsurf skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.windsurf', 'skills'))).toBe(true)
  })

  it('scans ~/.warp/skills for Warp skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.warp', 'skills'))).toBe(true)
  })

  it('scans ~/.github-copilot/skills for GitHub Copilot skills', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    expect(roots.some((r) => r.path === join(HOME, '.github-copilot', 'skills'))).toBe(true)
  })
})

describe('agent-specific coverage', () => {
  it('maps Pi skills from ~/.pi/agent/skills to Pi agent', () => {
    expect(
      agentHasOrchestrationSkill('pi', [
        skill({
          rootPath: join(HOME, '.pi', 'agent', 'skills'),
          directoryPath: join(HOME, '.pi', 'agent', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps OpenCode skills from ~/.opencode/skills to OpenCode agent', () => {
    expect(
      agentHasOrchestrationSkill('opencode', [
        skill({
          providers: ['opencode'],
          rootPath: join(HOME, '.opencode', 'skills'),
          directoryPath: join(HOME, '.opencode', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps Cursor skills from ~/.cursor/skills to Cursor agent', () => {
    expect(
      agentHasOrchestrationSkill('cursor', [
        skill({
          id: 'skill-cursor',
          providers: ['cursor'],
          rootPath: join(HOME, '.cursor', 'skills'),
          directoryPath: join(HOME, '.cursor', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps Windsurf skills from ~/.windsurf/skills to Windsurf agent', () => {
    expect(
      agentHasOrchestrationSkill('windsurf', [
        skill({
          id: 'skill-windsurf',
          providers: ['windsurf'],
          rootPath: join(HOME, '.windsurf', 'skills'),
          directoryPath: join(HOME, '.windsurf', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps Warp skills from ~/.warp/skills to Warp agent', () => {
    expect(
      agentHasOrchestrationSkill('warp', [
        skill({
          id: 'skill-warp',
          providers: ['warp'],
          rootPath: join(HOME, '.warp', 'skills'),
          directoryPath: join(HOME, '.warp', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps GitHub Copilot skills from ~/.github-copilot/skills to GitHub Copilot agent', () => {
    expect(
      agentHasOrchestrationSkill('github-copilot', [
        skill({
          id: 'skill-ghcp',
          providers: ['github-copilot'],
          rootPath: join(HOME, '.github-copilot', 'skills'),
          directoryPath: join(HOME, '.github-copilot', 'skills', 'orchestration')
        })
      ])
    ).toBe(true)
  })

  it('maps skills from ~/.agents/skills to all agents as fallback', () => {
    const skills = [
      skill({
        providers: ['agent-skills'],
        rootPath: join(HOME, '.agents', 'skills'),
        directoryPath: join(HOME, '.agents', 'skills', 'orchestration')
      })
    ]
    expect(agentHasOrchestrationSkill('pi', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('opencode', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('cursor', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('windsurf', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('warp', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('github-copilot', skills)).toBe(true)
  })
})

describe('orchestration skill statuses', () => {
  it('reports agent statuses based on dedicated path skills', () => {
    const skills = [
      skill({
        rootPath: join(HOME, '.pi', 'agent', 'skills'),
        directoryPath: join(HOME, '.pi', 'agent', 'skills', 'orchestration')
      }),
      skill({
        id: 'skill-2',
        providers: ['opencode'],
        rootPath: join(HOME, '.opencode', 'skills'),
        directoryPath: join(HOME, '.opencode', 'skills', 'orchestration')
      }),
      skill({
        id: 'skill-3',
        providers: ['cursor'],
        rootPath: join(HOME, '.cursor', 'skills'),
        directoryPath: join(HOME, '.cursor', 'skills', 'orchestration')
      })
    ]
    const statuses = getOrchestrationSkillAgentStatuses(skills, ['pi', 'opencode', 'cursor', 'codex'])
    expect(statuses.find((s) => s.agent === 'pi')?.installed).toBe(true)
    expect(statuses.find((s) => s.agent === 'opencode')?.installed).toBe(true)
    expect(statuses.find((s) => s.agent === 'cursor')?.installed).toBe(true)
    expect(statuses.find((s) => s.agent === 'codex')?.installed).toBe(false)
  })
})

describe('skill-to-agent routing', () => {
  it('routes skill in ~/.pi/agent/skills to Pi but not to unrelated agents', () => {
    const skills = [
      skill({
        rootPath: join(HOME, '.pi', 'agent', 'skills'),
        directoryPath: join(HOME, '.pi', 'agent', 'skills', 'orchestration')
      })
    ]
    expect(agentHasOrchestrationSkill('pi', skills)).toBe(true)
    expect(agentHasOrchestrationSkill('cursor', skills)).toBe(false)
  })
})

describe('dedicated vs shared path conflict', () => {
  it('resolves to dedicated path when same skill exists in both dedicated and shared paths', () => {
    const skills = [
      skill({
        name: 'orchestration',
        rootPath: join(HOME, '.pi', 'agent', 'skills'),
        directoryPath: join(HOME, '.pi', 'agent', 'skills', 'orchestration')
      }),
      skill({
        id: 'skill-shared',
        name: 'orchestration',
        providers: ['agent-skills'],
        rootPath: join(HOME, '.agents', 'skills'),
        directoryPath: join(HOME, '.agents', 'skills', 'orchestration')
      })
    ]
    expect(agentHasOrchestrationSkill('pi', skills)).toBe(true)
    const statuses = getOrchestrationSkillAgentStatuses(skills, ['pi'])
    expect(statuses).toHaveLength(1)
    expect(statuses[0].agent).toBe('pi')
    expect(statuses[0].installed).toBe(true)
  })
})

describe('cache invalidation', () => {
  it('rebuilds scan roots after cache reset when discovery is called again', () => {
    resetCache()
    const firstCall = buildSkillDiscoverySources({ homeDir: HOME })
    expect(firstCall.length).toBeGreaterThan(0)

    const firstPaths = firstCall.map((r) => r.path)
    resetCache()

    const secondCall = buildSkillDiscoverySources({ homeDir: HOME })
    expect(secondCall.length).toBe(firstCall.length)
    const secondPaths = secondCall.map((r) => r.path)

    for (const path of firstPaths) {
      expect(secondPaths).toContain(path)
    }
  })
})
