import { existsSync } from 'fs'
import { getNodePtySpawnHelperCandidates } from '../providers/local-pty-utils'

/**
 * Return the first existing helper candidate, or null when none exist.
 *
 * Why: `getNodePtySpawnHelperCandidates()` returns the same set the loaded
 * `node-pty` checks at spawn time, so a candidate that exists on disk now
 * is what `posix_spawnp` would have used if the daemon were spawned today.
 * Persisting the path that actually existed at fork time lets the next
 * health probe detect when a rebuild or worktree delete silently invalidated
 * the helper the long-lived daemon still has mapped (issue #4365).
 */
export function pickExistingNodePtyHelper(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Capture the node-pty spawn-helper path the current process is loaded
 * against. Returns null on Windows (no spawn-helper) and on resolution
 * failure (dev installs without node-pty — e.g. renderer-only test runs).
 */
export function getLoadedNodePtyHelperSnapshot(): string | null {
  if (process.platform === 'win32') {
    return null
  }
  try {
    return pickExistingNodePtyHelper(getNodePtySpawnHelperCandidates())
  } catch {
    return null
  }
}
