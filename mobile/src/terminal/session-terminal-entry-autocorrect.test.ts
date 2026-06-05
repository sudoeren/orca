import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sessionSource = readFileSync(
  new URL('../../app/h/[hostId]/session/[worktreeId].tsx', import.meta.url),
  'utf8'
)

// Why: iOS only flags the non-direct (buffered) terminal input as missing
// auto-correct (#4606). The live/direct input still wants both flags off so
// raw PTY bytes are not autocorrected or spellchecked before they reach the
// shell. These tests assert on the rendered source rather than rendering the
// 5k-line screen, matching the convention used by terminal-viewport-refit.
describe('session screen terminal entry autocorrect', () => {
  function findTextInputBlockAfter(anchor: string, lookahead = 1200): string {
    const anchorIndex = sessionSource.indexOf(anchor)
    expect(anchorIndex).toBeGreaterThanOrEqual(0)
    // Why: each terminal-entry branch is wrapped in a unique container
    // (liveInputBar / plain inputBar). Starting the search from the
    // container's opening tag and bounding it by `lookahead` keeps the
    // match scoped to that branch even when anchors like the placeholder
    // live inside the <TextInput> element itself.
    const textInputIndex = sessionSource.indexOf('<TextInput', anchorIndex)
    expect(textInputIndex).toBeGreaterThanOrEqual(0)
    expect(textInputIndex - anchorIndex).toBeLessThan(lookahead)
    return sessionSource.slice(textInputIndex, sessionSource.indexOf('/>', textInputIndex) + 2)
  }

  it('keeps autocorrect and spellcheck off on the live (direct) terminal input', () => {
    const liveInput = findTextInputBlockAfter('styles.liveInputBar')

    expect(liveInput).toContain('autoCorrect={false}')
    expect(liveInput).toContain('spellCheck={false}')
  })

  it('enables autocorrect on the non-direct (buffered) terminal input', () => {
    // Why: issue #4606 — the buffered command bar on iOS should let the
    // keyboard show autocorrect suggestions. Omitting the prop lets React
    // Native fall back to the iOS default (true) while leaving Android
    // unchanged, which is exactly what the issue asks for.
    const bufferedInput = findTextInputBlockAfter('<View style={styles.inputBar}>')

    expect(bufferedInput).not.toContain('autoCorrect={false}')
    expect(bufferedInput).not.toContain('autoCorrect={true}')
    expect(bufferedInput).not.toContain('spellCheck')
  })
})
