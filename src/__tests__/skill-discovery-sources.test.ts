import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { buildSkillDiscoverySources } from '../main/skills/skill-discovery-sources'

const HOME = '/Users/test'

describe('skill discovery sources include expected scan roots', () => {
  it('includes Codex home skill scan root', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    const root = roots.find((r) => r.id === 'home-codex')
    expect(root).toBeDefined()
    expect(root!.path).toBe(join(HOME, '.codex', 'skills'))
  })

  it('includes Agent skills home scan root', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    const root = roots.find((r) => r.id === 'home-agents')
    expect(root).toBeDefined()
    expect(root!.path).toBe(join(HOME, '.agents', 'skills'))
  })

  it('includes Claude home skill scan root', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    const root = roots.find((r) => r.id === 'home-claude')
    expect(root).toBeDefined()
    expect(root!.path).toBe(join(HOME, '.claude', 'skills'))
  })

  it('includes Codex plugin cache scan root', () => {
    const roots = buildSkillDiscoverySources({ homeDir: HOME })
    const root = roots.find((r) => r.id === 'codex-plugin-cache')
    expect(root).toBeDefined()
    expect(root!.path).toBe(join(HOME, '.codex', 'plugins', 'cache'))
  })
})
