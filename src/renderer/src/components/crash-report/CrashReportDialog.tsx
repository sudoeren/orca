import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Clipboard, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import { formatCrashReportText, type CrashReportRecord } from '../../../../shared/crash-reporting'
import type { GitHubViewer } from '../../../../shared/types'

function formatSummary(report: CrashReportRecord): string {
  return `${report.processType} ${report.reason}${
    report.exitCode === null ? '' : ` (exit ${report.exitCode})`
  }`
}

export function CrashReportDialog(): React.JSX.Element {
  const promptedThisLaunch = useRef(false)
  const mountedRef = useMountedRef()
  const [open, setOpen] = useState(false)
  const [report, setReport] = useState<CrashReportRecord | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [viewer, setViewer] = useState<GitHubViewer | null>(null)
  const [openedFromHelp, setOpenedFromHelp] = useState(false)
  const deferredNotes = useDeferredValue(notes)
  const title = openedFromHelp ? 'Report a crash' : 'Orca closed unexpectedly'
  const notesPlaceholder =
    openedFromHelp && !report
      ? 'Optional: what happened?'
      : 'Optional: what were you doing before Orca closed?'
  const diagnosticText = useMemo(
    // Why: formatting applies redaction and truncation over the full crash
    // payload. Keep that preview update out of the textarea keystroke path.
    () => (report ? formatCrashReportText(report, deferredNotes) : ''),
    [deferredNotes, report]
  )

  const loadCrashReport = useCallback(
    async (promptIfPresent: boolean): Promise<void> => {
      if (!promptIfPresent && mountedRef.current) {
        setOpenedFromHelp(true)
      }
      setLoading(true)
      try {
        const nextReport = promptIfPresent
          ? await window.api.crashReports.getLatestPending()
          : await window.api.crashReports.getLatestReport()
        let displayedReport = nextReport
        if (nextReport?.status === 'pending' && promptIfPresent) {
          try {
            // Why: startup crash prompts are one-shot. The open dialog keeps the
            // report data locally if the user chooses to send immediately, while
            // Help > Report Crash can still reopen dismissed unsent reports.
            await window.api.crashReports.dismiss({ reportId: nextReport.id })
            displayedReport = { ...nextReport, status: 'dismissed' as const }
          } catch (error) {
            console.error('Failed to dismiss crash report after startup prompt:', error)
          }
        }
        if (!mountedRef.current) {
          return
        }
        setReport(displayedReport)
        if (nextReport && promptIfPresent && mountedRef.current) {
          setOpenedFromHelp(false)
          setOpen(true)
        }
      } catch (error) {
        console.error('Failed to load crash report:', error)
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    },
    [mountedRef]
  )

  useEffect(() => {
    if (promptedThisLaunch.current) {
      return
    }
    promptedThisLaunch.current = true
    void loadCrashReport(true)
  }, [loadCrashReport])

  useEffect(() => {
    return window.api.ui.onOpenCrashReport(() => {
      void loadCrashReport(false).then(() => {
        if (mountedRef.current) {
          setOpen(true)
        }
      })
    })
  }, [loadCrashReport, mountedRef])

  useEffect(() => {
    if (!open) {
      setViewer(null)
      return
    }

    let cancelled = false
    void window.api.gh
      .viewer()
      .then((nextViewer) => {
        if (!cancelled) {
          setViewer(nextViewer)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setViewer(null)
          console.error('Failed to load GitHub viewer for crash report:', error)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const handleCopy = async (): Promise<void> => {
    const result = await window.api.crashReports.copyLatestDiagnostics(
      report ? { reportId: report.id, notes } : { notes }
    )
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    toast.success('Crash report copied.')
  }

  const dismissReportIfNeeded = async (): Promise<void> => {
    if (report?.status === 'pending') {
      await window.api.crashReports.dismiss({ reportId: report.id })
      if (mountedRef.current) {
        setReport({ ...report, status: 'dismissed' })
      }
    }
  }

  const handleDismiss = async (): Promise<void> => {
    await dismissReportIfNeeded()
    if (mountedRef.current) {
      setOpen(false)
    }
  }

  const handleSubmit = async (): Promise<void> => {
    setSubmitting(true)
    try {
      const result = await window.api.crashReports.submit({
        ...(report ? { reportId: report.id } : {}),
        notes,
        // Why: crash reporting must degrade to anonymous if gh is unavailable;
        // identity lookup is best-effort and never blocks report creation.
        submitAnonymously: !viewer,
        githubLogin: viewer?.login ?? null,
        githubEmail: null
      })
      if (!result.ok) {
        if (result.diagnosticBundle?.status === 'uploaded') {
          toast.error(
            `Failed to send crash report. Diagnostic ticket ${result.diagnosticBundle.ticketId} was uploaded but not linked.`
          )
        } else {
          toast.error('Failed to send crash report.')
        }
        console.error('Failed to submit crash report:', result.error)
        return
      }
      if (!mountedRef.current) {
        return
      }
      if (result.report) {
        setReport(result.report)
      }
      setNotes('')
      toast.success('Crash report sent.')
      setOpen(false)
    } catch (error) {
      toast.error('Failed to send crash report.')
      console.error('Failed to submit crash report:', error)
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (submitting && !nextOpen) {
          return
        }
        if (!nextOpen) {
          void dismissReportIfNeeded().finally(() => {
            if (mountedRef.current) {
              setOpen(false)
            }
          })
          return
        }
        setOpen(true)
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="size-4 text-destructive" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Send a privacy-safe crash report. Recent redacted diagnostic logs are included when
            available.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {report ? (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs">
              <div className="font-medium text-foreground">{formatSummary(report)}</div>
              <div className="mt-1 text-muted-foreground">
                {new Date(report.createdAt).toLocaleString()} · {report.platform} {report.arch} ·
                Orca {report.appVersion}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
              {loading
                ? 'Checking for crash reports...'
                : 'No automatic crash report was captured. You can still send details and include recent diagnostic logs when available.'}
            </div>
          )}
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            placeholder={notesPlaceholder}
            className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {report ? (
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-muted-foreground">Diagnostic text</div>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/20 p-3 font-mono text-[11px] leading-5 text-muted-foreground scrollbar-sleek">
                {diagnosticText}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCopy} disabled={loading}>
            <Clipboard className="size-3.5" />
            Copy Details
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDismiss}
            disabled={submitting}
          >
            Don&apos;t Send
          </Button>
          <Button type="button" size="sm" onClick={handleSubmit} disabled={loading || submitting}>
            <Send className="size-3.5" />
            Send Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
