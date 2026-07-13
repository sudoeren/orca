Add dedicated scan roots for Pi, OpenCode and Cursor orchestration skill discovery, and prioritize agent-specific paths over the shared fallback.

The buildSkillDiscoverySources function must include dedicated scan roots for each agent:
- id 'home-pi' at path ~/.pi/agent/skills with providers ['pi'] and sourceKind 'home'
- id 'home-opencode' at path ~/.opencode/skills with providers ['opencode'] and sourceKind 'home'
- id 'home-cursor' at path ~/.cursor/skills with providers ['cursor'] and sourceKind 'home'

Existing roots remain unchanged: id 'home-codex' at ~/.codex/skills (providers ['codex']), 'home-claude' at ~/.claude/skills (providers ['claude']), 'codex-plugin-cache' at ~/.codex/plugins/cache (providers ['codex', 'agent-skills']). The shared fallback root '~/.agents/skills' with providers ['agent-skills'] continues to serve agents that lack dedicated paths.

The agentHasOrchestrationSkill(agent, skills) function must return true when a discovered skill has a directoryPath ending with '/orchestration' and either (a) the skill's providers includes the agent and was found under that agent's dedicated root, or (b) the skill was found under the shared ~/.agents/skills root (provider 'agent-skills').

The getOrchestrationSkillAgentStatuses(skills, agents) function must return a list of { agent, installed } per input agent, reflecting the above detection rules. A dedicated agent path must take priority over the shared fallback when both contain the same skill.
