/* oxlint-disable max-lines -- Why: crash-reporting IPC tests share mocked Electron/observability handler setup; splitting would duplicate brittle IPC wiring. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrashReportRecord } from '../../shared/crash-reporting'

const {
  handlers,
  clipboardWriteTextMock,
  collectDiagnosticBundleMock,
  deleteDiagnosticBundleMock,
  getDiagnosticsStatusMock,
  resolveDiagnosticOrcaChannelMock,
  resolveDiagnosticTokenEndpointMock,
  showMessageBoxMock,
  submitFeedbackMock,
  uploadDiagnosticBundleMock
} = vi.hoisted(() => ({
  handlers: new Map<string, (_event: unknown, args?: unknown) => unknown>(),
  clipboardWriteTextMock: vi.fn(),
  collectDiagnosticBundleMock: vi.fn(),
  deleteDiagnosticBundleMock: vi.fn(),
  getDiagnosticsStatusMock: vi.fn(),
  resolveDiagnosticOrcaChannelMock: vi.fn(),
  resolveDiagnosticTokenEndpointMock: vi.fn(),
  showMessageBoxMock: vi.fn(),
  submitFeedbackMock: vi.fn(),
  uploadDiagnosticBundleMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '1.2.3-test' },
  clipboard: { writeText: clipboardWriteTextMock },
  dialog: { showMessageBox: showMessageBoxMock },
  ipcMain: {
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (_event: unknown, args?: unknown) => unknown) => {
      handlers.set(channel, handler)
    })
  }
}))

vi.mock('./feedback', () => ({
  submitFeedback: submitFeedbackMock
}))

vi.mock('../observability', () => ({
  collectDiagnosticBundle: collectDiagnosticBundleMock,
  deleteDiagnosticBundle: deleteDiagnosticBundleMock,
  getDiagnosticsStatus: getDiagnosticsStatusMock,
  uploadDiagnosticBundle: uploadDiagnosticBundleMock
}))

vi.mock('../observability/diagnostic-upload-endpoint', () => ({
  resolveDiagnosticOrcaChannel: resolveDiagnosticOrcaChannelMock,
  resolveDiagnosticTokenEndpoint: resolveDiagnosticTokenEndpointMock
}))

import { registerCrashReportingHandlers } from './crash-reporting'

function diagnosticBundle(): ReturnType<typeof collectDiagnosticBundleMock> {
  return {
    bundleSubmissionId: 'bundleabcdefghijklmnop',
    payload: '{"type":"bundle-header"}\n',
    bytes: 25,
    spanCount: 1
  }
}

function report(
  status: CrashReportRecord['status'] = 'pending',
  id = 'crash-1'
): CrashReportRecord {
  return {
    id,
    createdAt: '2026-05-16T01:00:00.000Z',
    status,
    source: 'renderer',
    processType: 'renderer',
    reason: 'crashed',
    exitCode: 5,
    appVersion: '1.0.0',
    platform: process.platform,
    osRelease: 'test',
    arch: process.arch,
    electronVersion: '41',
    chromeVersion: '141',
    details: {}
  }
}

describe('registerCrashReportingHandlers', () => {
  beforeEach(() => {
    handlers.clear()
    clipboardWriteTextMock.mockReset()
    collectDiagnosticBundleMock.mockReset()
    collectDiagnosticBundleMock.mockReturnValue(diagnosticBundle())
    deleteDiagnosticBundleMock.mockReset()
    deleteDiagnosticBundleMock.mockResolvedValue(undefined)
    getDiagnosticsStatusMock.mockReset()
    getDiagnosticsStatusMock.mockReturnValue({
      localFileEnabled: true,
      otlpEnabled: false,
      bundleEnabled: true,
      otlpStatus: 'Disabled',
      traceFilePath: '/tmp/main.trace.ndjson',
      traceFamilySize: 25
    })
    resolveDiagnosticOrcaChannelMock.mockReset()
    resolveDiagnosticOrcaChannelMock.mockReturnValue('stable')
    resolveDiagnosticTokenEndpointMock.mockReset()
    resolveDiagnosticTokenEndpointMock.mockReturnValue(
      'https://diagnostics.example.com/diagnostics/token'
    )
    showMessageBoxMock.mockReset()
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    submitFeedbackMock.mockReset()
    submitFeedbackMock.mockResolvedValue({ ok: true })
    uploadDiagnosticBundleMock.mockReset()
    uploadDiagnosticBundleMock.mockResolvedValue({ ticketId: 'ticketabcdefghijklmnop' })
  })

  it('copies the latest pending diagnostic text to the clipboard', async () => {
    const latest = report()
    registerCrashReportingHandlers({
      getById: vi.fn(async () => latest),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [latest]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      notes: 'extra /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[Crash Report]'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(
      expect.stringContaining('extra [redacted-path]')
    )
  })

  it('copies an uncaptured crash report when no stored report exists', async () => {
    registerCrashReportingHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:copyLatestDiagnostics')?.(null, {
      notes: 'after opening /Users/alice/project'
    })

    expect(result).toEqual({ ok: true })
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('not captured'))
    expect(clipboardWriteTextMock).toHaveBeenCalledWith(expect.stringContaining('[redacted-path]'))
  })

  it('returns dismissed unsent reports for the manual Help menu entry', async () => {
    const dismissed = report('dismissed', 'crash-help-menu')
    registerCrashReportingHandlers({
      getById: vi.fn(async () => dismissed),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [report('sent', 'crash-sent'), dismissed]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    await expect(handlers.get('crashReports:getLatestPending')?.(null)).resolves.toBeNull()
    await expect(handlers.get('crashReports:getLatestReport')?.(null)).resolves.toEqual(dismissed)
  })

  it('submits a pending report through feedback and marks it sent', async () => {
    const pending = report('pending', 'crash-pending')
    const sent = report('sent', pending.id)
    const markSent = vi.fn(async () => sent)
    registerCrashReportingHandlers({
      getById: vi.fn(async () => pending),
      dismiss: vi.fn(),
      markSent,
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [pending]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      reportId: pending.id,
      notes: 'extra /Users/alice/project',
      submitAnonymously: false,
      githubLogin: 'trusted-user',
      githubEmail: null
    })

    expect(result).toEqual({ ok: true, report: sent })
    expect(submitFeedbackMock).toHaveBeenCalledWith({
      feedback: expect.stringContaining('ticketabcdefghijklmnop'),
      submissionType: 'crash',
      submitAnonymously: false,
      githubLogin: 'trusted-user',
      githubEmail: null
    })
    expect(uploadDiagnosticBundleMock).toHaveBeenCalledWith({
      tokenEndpoint: 'https://diagnostics.example.com/diagnostics/token',
      payload: diagnosticBundle().payload,
      bundleSubmissionId: diagnosticBundle().bundleSubmissionId
    })
    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Upload Logs', 'Send Without Logs'],
        message: expect.stringContaining('Upload recent local diagnostic logs')
      })
    )
    expect(markSent).toHaveBeenCalledWith(pending.id)
  })

  it('submits an uncaptured Help menu crash report and uploads the diagnostic bundle', async () => {
    registerCrashReportingHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      notes: 'blank window after opening /Users/alice/project',
      submitAnonymously: false,
      githubLogin: 'trusted-user',
      githubEmail: null
    })

    expect(result).toEqual({
      ok: true,
      report: null,
      diagnosticBundle: {
        status: 'uploaded',
        ticketId: 'ticketabcdefghijklmnop',
        bundleSubmissionId: 'bundleabcdefghijklmnop',
        bytes: 25,
        spanCount: 1
      }
    })
    expect(collectDiagnosticBundleMock).toHaveBeenCalledWith(
      expect.objectContaining({ lookbackMinutes: 3 * 24 * 60, orcaChannel: 'stable' })
    )
    expect(submitFeedbackMock).toHaveBeenCalledWith({
      feedback: expect.stringContaining('Report ID: not captured'),
      submissionType: 'crash',
      submitAnonymously: false,
      githubLogin: 'trusted-user',
      githubEmail: null
    })
    expect(submitFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: expect.stringContaining('ticketabcdefghijklmnop') })
    )
    expect(submitFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: expect.stringContaining('[redacted-path]') })
    )
    expect(showMessageBoxMock).toHaveBeenCalled()
  })

  it('sends an uncaptured crash report without logs when native upload confirmation is cancelled', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 })
    registerCrashReportingHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      notes: 'manual report',
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result).toEqual({
      ok: true,
      report: null,
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: 'diagnostic bundle upload cancelled',
        bundleSubmissionId: 'bundleabcdefghijklmnop',
        bytes: 25,
        spanCount: 1
      }
    })
    expect(uploadDiagnosticBundleMock).not.toHaveBeenCalled()
    expect(submitFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: expect.stringContaining('diagnostic bundle upload cancelled')
      })
    )
  })

  it('still submits an uncaptured crash report when the diagnostic bundle cannot upload', async () => {
    resolveDiagnosticTokenEndpointMock.mockReturnValue(null)
    registerCrashReportingHandlers({
      getById: vi.fn(async () => null),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => []),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      notes: 'manual report',
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result).toEqual({
      ok: true,
      report: null,
      diagnosticBundle: {
        status: 'not_uploaded',
        reason: 'diagnostic upload endpoint is not configured for this build',
        bundleSubmissionId: 'bundleabcdefghijklmnop',
        bytes: 25,
        spanCount: 1
      }
    })
    expect(uploadDiagnosticBundleMock).not.toHaveBeenCalled()
    expect(showMessageBoxMock).not.toHaveBeenCalled()
    expect(submitFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ feedback: expect.stringContaining('Status: not uploaded') })
    )
  })

  it('submits a dismissed startup prompt through feedback and marks it sent', async () => {
    const dismissed = report('dismissed', 'crash-dismissed')
    const sent = report('sent', dismissed.id)
    const markDismissedSent = vi.fn(async () => sent)
    registerCrashReportingHandlers({
      getById: vi.fn(async () => dismissed),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent,
      listRecent: vi.fn(async () => []),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      reportId: dismissed.id,
      notes: 'sent from startup prompt',
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result).toEqual({ ok: true, report: sent })
    expect(submitFeedbackMock).toHaveBeenCalledWith({
      feedback: expect.stringContaining('sent from startup prompt'),
      submissionType: 'crash',
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })
    expect(markDismissedSent).toHaveBeenCalledWith(dismissed.id)
  })

  it('dismisses a pending report locally without any network submission', async () => {
    const latest = report('pending', 'crash-dismiss')
    const dismissed = report('dismissed', latest.id)
    const dismiss = vi.fn(async () => dismissed)
    registerCrashReportingHandlers({
      getById: vi.fn(async () => latest),
      dismiss,
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [latest]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:dismiss')?.(null, {
      reportId: latest.id
    })

    expect(result).toEqual(dismissed)
    expect(dismiss).toHaveBeenCalledWith(latest.id)
    expect(submitFeedbackMock).not.toHaveBeenCalled()
  })

  it('keeps a pending report available if feedback submission fails', async () => {
    const pending = report('pending', 'crash-failed')
    const markSent = vi.fn()
    submitFeedbackMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'status 500'
    })
    registerCrashReportingHandlers({
      getById: vi.fn(async () => pending),
      dismiss: vi.fn(),
      markSent,
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [pending]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      reportId: pending.id,
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'status 500',
      report: pending
    })
    expect(deleteDiagnosticBundleMock).toHaveBeenCalledWith({
      tokenEndpoint: 'https://diagnostics.example.com/diagnostics/token',
      ticketId: 'ticketabcdefghijklmnop'
    })
    expect(markSent).not.toHaveBeenCalled()
  })

  it('returns the uploaded diagnostic ticket if cleanup fails after feedback submission fails', async () => {
    const pending = report('pending', 'crash-failed-cleanup')
    submitFeedbackMock.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'status 500'
    })
    deleteDiagnosticBundleMock.mockRejectedValue(new Error('delete failed'))
    registerCrashReportingHandlers({
      getById: vi.fn(async () => pending),
      dismiss: vi.fn(),
      markSent: vi.fn(),
      markDismissedSent: vi.fn(),
      listRecent: vi.fn(async () => [pending]),
      record: vi.fn(),
      formatDiagnosticText: vi.fn()
    } as never)

    const result = await handlers.get('crashReports:submit')?.(null, {
      reportId: pending.id,
      submitAnonymously: true,
      githubLogin: null,
      githubEmail: null
    })

    expect(result).toEqual({
      ok: false,
      status: 500,
      error: 'status 500',
      report: pending,
      diagnosticBundle: {
        status: 'uploaded',
        ticketId: 'ticketabcdefghijklmnop',
        bundleSubmissionId: 'bundleabcdefghijklmnop',
        bytes: 25,
        spanCount: 1
      }
    })
    expect(deleteDiagnosticBundleMock).toHaveBeenCalledWith({
      tokenEndpoint: 'https://diagnostics.example.com/diagnostics/token',
      ticketId: 'ticketabcdefghijklmnop'
    })
  })
})
