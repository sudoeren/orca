import {
  BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
  type BackgroundMountTerminalWorktreeDetail
} from '@/constants/terminal'

export function requestAgentTerminalPopoverBackgroundMount(worktreeId: string): void {
  window.dispatchEvent(
    new CustomEvent<BackgroundMountTerminalWorktreeDetail>(
      BACKGROUND_MOUNT_TERMINAL_WORKTREE_EVENT,
      {
        detail: { worktreeId }
      }
    )
  )
}
