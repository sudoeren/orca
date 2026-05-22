import { arch as osArch, platform as osPlatform, release as osRelease } from 'node:os'
import { app, clipboard, dialog, ipcMain } from 'electron'
import {
  formatCrashReportText,
  formatUncapturedCrashReportText,
  sanitizeCrashReportString,
  type CrashReportDiagnosticBundle,
  type CrashReportSubmitArgs,
  type CrashReportSubmitResult
} from '../../shared/crash-reporting'
import { submitFeedback } from './feedback'
import type { CrashReportStore } from '../crash-reporting/crash-report-store'
import {
  collectDiagnosticBundle,
  deleteDiagnosticBundle,
  getDiagnosticsStatus,
  uploadDiagnosticBundle
} from '../observability'
import {
  resolveDiagnosticOrcaChannel,
  resolveDiagnosticTokenEndpoint
} from '../observability/diagnostic-upload-endpoint'

const inFlightSubmissions = new Set<string>()
const submittedReportIds = new Set<string>()
const CRASH_REPORT_LOG_LOOKBACK_MINUTES = 3 * 24 * 60

type CrashDiagnosticBundleUpload = {
  readonly diagnosticBundle: CrashReportDiagnosticBundle
  readonly tokenEndpoint?: string
}

async function getLatestPendingReport(
  store: CrashReportStore
): Promise<Awaited<ReturnType<CrashReportStore['getLatestPending']>>> {
  const reports = await store.listRecent()
  return (
    reports.find((report) => report.status === 'pending' && !submittedReportIds.has(report.id)) ??
    null
  )
}

async function getLatestSendableReport(
  store: CrashReportStore
): Promise<Awaited<ReturnType<CrashReportStore['getLatestPending']>>> {
  const reports = await store.listRecent()
  return (
    reports.find(
      (report) =>
        (report.status === 'pending' || report.status === 'dismissed') &&
        !submittedReportIds.has(report.id)
    ) ?? null
  )
}

function formatUnknownError(error: unknown): string {
  return sanitizeCrashReportString(error instanceof Error ? error.message : String(error))
}

function buildUncapturedCrashReportText(
  notes: string | undefined,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  return formatUncapturedCrashReportText(
    {
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: osPlatform(),
      osRelease: osRelease(),
      arch: osArch(),
      electronVersion: process.versions.electron ?? 'unknown',
      chromeVersion: process.versions.chrome ?? 'unknown'
    },
    notes,
    diagnosticBundle
  )
}

async function confirmCrashDiagnosticBundleUpload(): Promise<boolean> {
  const result = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Upload Logs', 'Send Without Logs'],
    defaultId: 1,
    cancelId: 1,
    title: 'Upload diagnostic logs?',
    message: 'Upload recent local diagnostic logs with this crash report?',
    detail:
      'The logs are redacted before upload. Choose "Send Without Logs" to submit only the crash report text.'
  })
  return result.response === 0
}

async function collectAndUploadCrashDiagnosticBundle(): Promise<CrashDiagnosticBundleUpload> {
  const status = getDiagnosticsStatus()
  if (!status.bundleEnabled) {
    return {
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: status.disabledReason ?? 'diagnostic bundle collection is disabled'
      }
    }
  }

  let bundle: ReturnType<typeof collectDiagnosticBundle>
  try {
    bundle = collectDiagnosticBundle({
      appVersion: app.getVersion(),
      platform: osPlatform(),
      arch: osArch(),
      osRelease: osRelease(),
      orcaChannel: resolveDiagnosticOrcaChannel(),
      // Why: Help > Report Crash is often used after relaunch, long after the
      // default 30 minute support bundle window would miss the failure context.
      lookbackMinutes: CRASH_REPORT_LOG_LOOKBACK_MINUTES
    })
  } catch (error) {
    return { diagnosticBundle: { status: 'not_uploaded', reason: formatUnknownError(error) } }
  }

  const tokenEndpoint = resolveDiagnosticTokenEndpoint()
  if (!tokenEndpoint) {
    return {
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: 'diagnostic upload endpoint is not configured for this build',
        bundleSubmissionId: bundle.bundleSubmissionId,
        bytes: bundle.bytes,
        spanCount: bundle.spanCount
      }
    }
  }

  const uploadConfirmed = await confirmCrashDiagnosticBundleUpload()
  if (!uploadConfirmed) {
    return {
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: 'diagnostic bundle upload cancelled',
        bundleSubmissionId: bundle.bundleSubmissionId,
        bytes: bundle.bytes,
        spanCount: bundle.spanCount
      }
    }
  }

  try {
    const result = await uploadDiagnosticBundle({
      tokenEndpoint,
      payload: bundle.payload,
      bundleSubmissionId: bundle.bundleSubmissionId
    })
    return {
      diagnosticBundle: {
        status: 'uploaded',
        ticketId: result.ticketId,
        bundleSubmissionId: bundle.bundleSubmissionId,
        bytes: bundle.bytes,
        spanCount: bundle.spanCount
      },
      tokenEndpoint
    }
  } catch (error) {
    return {
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: formatUnknownError(error),
        bundleSubmissionId: bundle.bundleSubmissionId,
        bytes: bundle.bytes,
        spanCount: bundle.spanCount
      }
    }
  }
}

async function deleteUploadedCrashDiagnosticBundle(
  upload: CrashDiagnosticBundleUpload
): Promise<boolean> {
  if (upload.diagnosticBundle.status !== 'uploaded') {
    return true
  }
  if (!upload.tokenEndpoint) {
    return false
  }
  try {
    await deleteDiagnosticBundle({
      tokenEndpoint: upload.tokenEndpoint,
      ticketId: upload.diagnosticBundle.ticketId
    })
    return true
  } catch (error) {
    // Why: if the feedback post fails after log upload, deleting the orphaned
    // bundle preserves the user's expectation that one Send creates one report.
    console.error('[crash-reporting] Failed to delete orphaned diagnostic bundle:', error)
    return false
  }
}

export function registerCrashReportingHandlers(store: CrashReportStore): void {
  ipcMain.removeHandler('crashReports:getLatestPending')
  ipcMain.handle('crashReports:getLatestPending', () => getLatestPendingReport(store))

  ipcMain.removeHandler('crashReports:getLatestReport')
  ipcMain.handle('crashReports:getLatestReport', () => getLatestSendableReport(store))

  ipcMain.removeHandler('crashReports:dismiss')
  ipcMain.handle('crashReports:dismiss', async (_event, args: { reportId: string }) => {
    if (inFlightSubmissions.has(args.reportId)) {
      return store.getById(args.reportId)
    }
    if (submittedReportIds.has(args.reportId)) {
      const report = await store.getById(args.reportId)
      return report ? { ...report, status: 'sent' as const } : null
    }
    return store.dismiss(args.reportId)
  })

  ipcMain.removeHandler('crashReports:copyLatestDiagnostics')
  ipcMain.handle(
    'crashReports:copyLatestDiagnostics',
    async (_event, args?: { reportId?: string; notes?: string }) => {
      const report = args?.reportId
        ? await store.getById(args.reportId)
        : await getLatestPendingReport(store)
      if (!report) {
        clipboard.writeText(buildUncapturedCrashReportText(args?.notes))
        return { ok: true as const }
      }
      clipboard.writeText(formatCrashReportText(report, args?.notes))
      return { ok: true as const }
    }
  )

  ipcMain.removeHandler('crashReports:submit')
  ipcMain.handle(
    'crashReports:submit',
    async (_event, args: CrashReportSubmitArgs): Promise<CrashReportSubmitResult> => {
      const report = args.reportId
        ? await store.getById(args.reportId)
        : await getLatestPendingReport(store)
      if (!report) {
        const diagnosticUpload = await collectAndUploadCrashDiagnosticBundle()
        const diagnosticBundle = diagnosticUpload.diagnosticBundle
        const result = await submitFeedback({
          feedback: buildUncapturedCrashReportText(args.notes, diagnosticBundle),
          submissionType: 'crash',
          submitAnonymously: args.submitAnonymously,
          githubLogin: args.githubLogin,
          githubEmail: args.githubEmail
        })
        return result.ok
          ? { ok: true, report: null, diagnosticBundle }
          : {
              ...result,
              report: null,
              ...((await deleteUploadedCrashDiagnosticBundle(diagnosticUpload))
                ? {}
                : { diagnosticBundle })
            }
      }
      const canSubmitDismissedReport = Boolean(args.reportId && report.status === 'dismissed')
      if (
        (!canSubmitDismissedReport && report.status !== 'pending') ||
        submittedReportIds.has(report.id)
      ) {
        return {
          ok: true,
          report: submittedReportIds.has(report.id) ? { ...report, status: 'sent' } : report
        }
      }
      if (inFlightSubmissions.has(report.id)) {
        return {
          ok: false,
          status: null,
          error: 'Crash report submission already in progress.',
          report
        }
      }

      inFlightSubmissions.add(report.id)
      try {
        const diagnosticUpload = await collectAndUploadCrashDiagnosticBundle()
        const diagnosticBundle = diagnosticUpload.diagnosticBundle
        const result = await submitFeedback({
          feedback: formatCrashReportText(report, args.notes, diagnosticBundle),
          submissionType: 'crash',
          submitAnonymously: args.submitAnonymously,
          githubLogin: args.githubLogin,
          githubEmail: args.githubEmail
        })
        if (!result.ok) {
          return {
            ...result,
            report,
            ...((await deleteUploadedCrashDiagnosticBundle(diagnosticUpload))
              ? {}
              : { diagnosticBundle })
          }
        }
        submittedReportIds.add(report.id)
        if (report.status === 'dismissed') {
          try {
            // Why: startup prompts are dismissed before the user can send from
            // the still-open dialog, so successful uploads must update storage.
            const sent = await store.markDismissedSent(report.id)
            return { ok: true, report: sent ?? { ...report, status: 'sent' } }
          } catch (error) {
            console.error('[crash-reporting] Failed to mark dismissed crash report sent:', error)
            return { ok: true, report: { ...report, status: 'sent' } }
          }
        }
        try {
          const sent = await store.markSent(report.id)
          return { ok: true, report: sent ?? { ...report, status: 'sent' } }
        } catch (error) {
          // Why: the upstream submission already succeeded. A local persistence
          // failure must not present as upload failure or invite duplicate sends
          // during this app session.
          console.error('[crash-reporting] Failed to mark crash report sent:', error)
          return { ok: true, report: { ...report, status: 'sent' } }
        }
      } finally {
        inFlightSubmissions.delete(report.id)
      }
    }
  )
}
