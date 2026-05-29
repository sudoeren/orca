import React, { useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { getScreenSubmitShortcutLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { linearUpdateIssue } from '@/runtime/runtime-linear-client'
import type { LinearIssue } from '../../../shared/types'

type LinearIssueTextEditorProps = {
  issue: LinearIssue
  onIssueChange: (patch: Pick<LinearIssue, 'title'> | Pick<LinearIssue, 'description'>) => void
  density?: 'page' | 'drawer'
  fields?: 'all' | 'title' | 'description'
}

type LinearIssueTextDraftState = {
  issueId: string
  sourceTitle: string
  sourceDescription: string
  title: string
  description: string
}

function getLinearIssueDescription(issue: LinearIssue): string {
  return issue.description ?? ''
}

function createLinearIssueTextDraftState(issue: LinearIssue): LinearIssueTextDraftState {
  const description = getLinearIssueDescription(issue)
  return {
    issueId: issue.id,
    sourceTitle: issue.title,
    sourceDescription: description,
    title: issue.title,
    description
  }
}

function resolveLinearIssueTextDraftState(
  state: LinearIssueTextDraftState,
  issue: LinearIssue
): LinearIssueTextDraftState {
  const sourceDescription = getLinearIssueDescription(issue)
  if (state.issueId !== issue.id) {
    return createLinearIssueTextDraftState(issue)
  }
  if (state.sourceTitle === issue.title && state.sourceDescription === sourceDescription) {
    return state
  }
  return {
    issueId: state.issueId,
    sourceTitle: issue.title,
    sourceDescription,
    title: state.title === state.sourceTitle ? issue.title : state.title,
    description:
      state.description === state.sourceDescription ? sourceDescription : state.description
  }
}

function useAutosizeTextArea(value: string): React.RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = ref.current
    if (!textarea) {
      return
    }
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])

  return ref
}

export function LinearIssueTextEditor({
  issue,
  onIssueChange,
  density = 'page',
  fields = 'all'
}: LinearIssueTextEditorProps): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const patchLinearIssue = useAppStore((s) => s.patchLinearIssue)
  const [draftState, setDraftState] = useState(() => createLinearIssueTextDraftState(issue))
  const resolvedDraftState = resolveLinearIssueTextDraftState(draftState, issue)
  if (resolvedDraftState !== draftState) {
    // Why: Linear can push updated title/description while another field has
    // unsaved edits; reconcile only untouched drafts before the next paint.
    setDraftState(resolvedDraftState)
  }
  const titleDraft = resolvedDraftState.title
  const descriptionDraft = resolvedDraftState.description
  const [savingField, setSavingField] = useState<'title' | 'description' | null>(null)
  const submitShortcutLabel = getScreenSubmitShortcutLabel()
  const titleRef = useAutosizeTextArea(titleDraft)
  const descriptionRef = useAutosizeTextArea(descriptionDraft)
  const updateTitleDraft = useCallback(
    (title: string): void => {
      setDraftState((current) => ({
        ...resolveLinearIssueTextDraftState(current, issue),
        title
      }))
    },
    [issue]
  )
  const updateDescriptionDraft = useCallback(
    (description: string): void => {
      setDraftState((current) => ({
        ...resolveLinearIssueTextDraftState(current, issue),
        description
      }))
    },
    [issue]
  )

  const saveField = useCallback(
    async (field: 'title' | 'description') => {
      const nextTitle = titleDraft.trim()
      const nextDescription = descriptionDraft.trimEnd()
      if (field === 'title' && !nextTitle) {
        updateTitleDraft(issue.title)
        toast.error('Title is required')
        return
      }

      const nextValue = field === 'title' ? nextTitle : nextDescription
      const currentValue = field === 'title' ? issue.title : (issue.description ?? '')
      if (nextValue === currentValue) {
        return
      }

      const patch =
        field === 'title'
          ? ({ title: nextTitle } as const)
          : ({ description: nextDescription } as const)
      setSavingField(field)
      onIssueChange(patch)
      patchLinearIssue(issue.id, patch)
      try {
        const result = await linearUpdateIssue(settings, issue.id, patch, issue.workspaceId)
        if (!result.ok) {
          throw new Error(result.error)
        }
      } catch (error) {
        const revert =
          field === 'title'
            ? ({ title: issue.title } as const)
            : ({ description: issue.description ?? '' } as const)
        onIssueChange(revert)
        patchLinearIssue(issue.id, revert)
        if (field === 'title') {
          updateTitleDraft(issue.title)
        } else {
          updateDescriptionDraft(issue.description ?? '')
        }
        toast.error(error instanceof Error ? error.message : `Failed to update ${field}`)
      } finally {
        setSavingField(null)
      }
    },
    [
      descriptionDraft,
      issue.description,
      issue.id,
      issue.title,
      issue.workspaceId,
      onIssueChange,
      patchLinearIssue,
      settings,
      titleDraft,
      updateDescriptionDraft,
      updateTitleDraft
    ]
  )

  const handleDescriptionKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isScreenSubmitShortcut(event)) {
        return
      }
      event.preventDefault()
      event.currentTarget.blur()
    },
    []
  )

  const handleTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        event.currentTarget.blur()
        return
      }
      handleDescriptionKeyDown(event)
    },
    [handleDescriptionKeyDown]
  )

  const titleClass =
    density === 'page'
      ? 'text-[28px] font-semibold leading-tight'
      : 'text-[15px] font-semibold leading-tight'
  const descriptionClass =
    density === 'page' ? 'mt-7 px-3 text-[15px] leading-7' : 'px-3 text-[14px] leading-relaxed'

  return (
    <div className="min-w-0">
      {fields !== 'description' ? (
        <div className="relative">
          <textarea
            ref={titleRef}
            value={titleDraft}
            onChange={(event) => updateTitleDraft(event.target.value)}
            onBlur={() => void saveField('title')}
            onKeyDown={handleTitleKeyDown}
            disabled={savingField === 'title'}
            rows={1}
            aria-label="Issue title"
            className={cn(
              'peer scrollbar-sleek block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent px-1 py-0 text-foreground outline-none transition hover:border-border/50 hover:bg-accent/40 focus-visible:border-border focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-80',
              titleClass
            )}
          />
          <div className="pointer-events-none absolute bottom-1.5 right-2 z-10 flex items-center gap-1 text-[10px] text-muted-foreground/75 opacity-0 transition-opacity peer-focus:opacity-100">
            <kbd className="inline-flex h-4 min-w-4 select-none items-center justify-center rounded border border-border bg-muted/70 px-1 font-mono text-[9px] font-medium shadow-xs">
              ↵
            </kbd>
            <span>to save</span>
          </div>
          {savingField === 'title' ? (
            <LoaderCircle className="absolute right-2 top-2 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}

      {fields !== 'title' ? (
        <div className="relative">
          <textarea
            ref={descriptionRef}
            value={descriptionDraft}
            onChange={(event) => updateDescriptionDraft(event.target.value)}
            onBlur={() => void saveField('description')}
            onKeyDown={handleDescriptionKeyDown}
            disabled={savingField === 'description'}
            rows={descriptionDraft.trim() ? 3 : 1}
            placeholder="No description provided."
            aria-label="Issue description"
            className={cn(
              'peer scrollbar-sleek block w-full resize-none overflow-hidden rounded-md border border-transparent bg-transparent py-1 text-foreground outline-none transition placeholder:italic placeholder:text-muted-foreground hover:border-border/50 hover:bg-accent/40 focus-visible:border-border focus-visible:bg-background focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-80',
              descriptionClass
            )}
          />
          <div className="pointer-events-none absolute bottom-1.5 right-2 z-10 flex items-center gap-1.5 text-[10px] text-muted-foreground/75 opacity-0 transition-opacity peer-focus:opacity-100">
            <span className="flex items-center gap-1">
              <span>{submitShortcutLabel}</span>
              <span>save</span>
            </span>
            <span className="text-muted-foreground/35">·</span>
            <span className="flex items-center gap-1">
              <kbd className="inline-flex h-4 min-w-4 select-none items-center justify-center rounded border border-border bg-muted/70 px-1 font-mono text-[9px] font-medium shadow-xs">
                ↵
              </kbd>
              <span>newline</span>
            </span>
          </div>
          {savingField === 'description' ? (
            <LoaderCircle className="absolute right-2 top-2 size-4 animate-spin text-muted-foreground" />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
