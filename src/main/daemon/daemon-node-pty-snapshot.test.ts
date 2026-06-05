import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getLoadedNodePtyHelperSnapshot,
  pickExistingNodePtyHelper
} from './daemon-node-pty-snapshot'

describe('pickExistingNodePtyHelper', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'node-pty-snapshot-test-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns the first existing candidate', () => {
    const a = join(dir, 'a-spawn-helper')
    const b = join(dir, 'b-spawn-helper')
    writeFileSync(a, '')
    writeFileSync(b, '')

    expect(pickExistingNodePtyHelper([a, b])).toBe(a)
  })

  it('skips missing candidates and returns the first one that exists', () => {
    const missing = join(dir, 'missing-spawn-helper')
    const present = join(dir, 'present-spawn-helper')
    writeFileSync(present, '')

    expect(pickExistingNodePtyHelper([missing, present])).toBe(present)
  })

  it('returns null when no candidate exists', () => {
    expect(pickExistingNodePtyHelper([join(dir, 'a'), join(dir, 'b'), join(dir, 'c')])).toBeNull()
  })

  it('returns null for an empty candidate list', () => {
    expect(pickExistingNodePtyHelper([])).toBeNull()
  })
})

describe('getLoadedNodePtyHelperSnapshot', () => {
  it('returns null on Windows where there is no spawn-helper', () => {
    if (process.platform !== 'win32') {
      return
    }
    expect(getLoadedNodePtyHelperSnapshot()).toBeNull()
  })

  it('returns null on POSIX when the candidates list is empty', async () => {
    if (process.platform === 'win32') {
      return
    }
    // Simulate a dev environment where node-pty resolves to a layout with
    // no surviving candidates — e.g. an out-of-date worktree whose prebuilds
    // dir has been replaced by `pnpm install`.
    const candidatesModule = await import('../providers/local-pty-utils')
    const candidatesSpy = vi
      .spyOn(candidatesModule, 'getNodePtySpawnHelperCandidates')
      .mockReturnValue([])

    try {
      expect(getLoadedNodePtyHelperSnapshot()).toBeNull()
    } finally {
      candidatesSpy.mockRestore()
    }
  })

  it('returns a real candidate path on POSIX when one exists', async () => {
    if (process.platform === 'win32') {
      return
    }
    const dir = mkdtempSync(join(tmpdir(), 'node-pty-snapshot-real-'))
    const helper = join(dir, 'spawn-helper')
    writeFileSync(helper, '')

    try {
      const candidatesModule = await import('../providers/local-pty-utils')
      const candidatesSpy = vi
        .spyOn(candidatesModule, 'getNodePtySpawnHelperCandidates')
        .mockReturnValue([join(dir, 'does-not-exist'), helper])

      try {
        expect(getLoadedNodePtyHelperSnapshot()).toBe(helper)
      } finally {
        candidatesSpy.mockRestore()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
