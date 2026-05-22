export type CrashReportStatus = 'pending' | 'sent' | 'dismissed'
export type CrashReportSource = 'renderer' | 'child'

export type CrashReportDetailValue = string | number | boolean | null
export type CrashReportBreadcrumbData = Record<string, CrashReportDetailValue>

export type CrashReportBreadcrumb = {
  createdAt: string
  name: string
  data?: CrashReportBreadcrumbData
}

export type CrashReportBreadcrumbInput = {
  createdAt: string
  name: string
  data?: Record<string, unknown>
}

export type CrashReportRecord = {
  id: string
  createdAt: string
  status: CrashReportStatus
  source: CrashReportSource
  processType: string
  reason: string
  exitCode: number | null
  appVersion: string
  platform: NodeJS.Platform
  osRelease: string
  arch: string
  electronVersion: string
  chromeVersion: string
  details: Record<string, CrashReportDetailValue>
  breadcrumbs?: CrashReportBreadcrumb[]
}

export type CrashReportDiagnosticBundle =
  | {
      status: 'uploaded'
      ticketId: string
      bundleSubmissionId: string
      bytes: number
      spanCount: number
    }
  | {
      status: 'not_uploaded'
      reason: string
      bundleSubmissionId?: string
      bytes?: number
      spanCount?: number
    }

export type UncapturedCrashReportContext = {
  createdAt: string
  appVersion: string
  platform: NodeJS.Platform
  osRelease: string
  arch: string
  electronVersion: string
  chromeVersion: string
}

export type CrashReportCreateInput = Omit<
  CrashReportRecord,
  'id' | 'createdAt' | 'status' | 'details' | 'breadcrumbs'
> & {
  details: Record<string, unknown>
  breadcrumbs?: CrashReportBreadcrumbInput[]
}

export type CrashReportSubmitArgs = {
  reportId?: string
  notes?: string
  submitAnonymously?: boolean
  githubLogin: string | null
  githubEmail: string | null
}

export type CrashReportSubmitResult =
  | { ok: true; report: CrashReportRecord | null; diagnosticBundle?: CrashReportDiagnosticBundle }
  | {
      ok: false
      status: number | null
      error: string
      report?: CrashReportRecord | null
      diagnosticBundle?: CrashReportDiagnosticBundle
    }

const MAX_STRING_DETAIL_LENGTH = 240
const MAX_BREADCRUMB_NAME_LENGTH = 80
const MAX_BREADCRUMBS = 30
const MAX_FORMATTED_REPORT_LENGTH = 64_000
const FORMATTED_REPORT_TRUNCATION_SUFFIX =
  '\n\n[Crash report truncated to fit feedback endpoint limits.]'
const SECRET_PATTERNS = [
  /\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9_-]{20,})\b/g,
  /\b([A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@)(?=[^/\s]+)/g,
  /\b(token|api[_-]?key|secret|password)=([^&\s]+)/gi
]

const PATH_PATTERNS = [
  /\/(?:Users|home)\/(?:(?!\s+(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /\/(?:Applications|Library|System|Volumes|etc|media|mnt|opt|private|root|srv|tmp|usr|var)\/(?:(?!\s+(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /\/[A-Za-z0-9._ -]+\/(?:(?!\s+(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /[A-Za-z]:\\(?:(?!\s+(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi,
  /\\\\[^\\\s"'`<>\n\r)]+\\(?:(?!\s+(?:\/|[A-Za-z]:\\|\\\\|gh[pousr]_|sk-|(?:token|api[_-]?key|secret|password)=))[^"'`<>\n\r)])+/gi
]

export function isCrashReportReason(reason: string): boolean {
  return [
    'abnormal-exit',
    'crashed',
    'integrity-failure',
    'killed',
    'launch-failed',
    'memory-eviction',
    'oom'
  ].includes(reason)
}

export function sanitizeCrashReportString(value: string): string {
  let sanitized = value
  for (const pattern of PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[redacted-path]')
  }
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match, key?: string) => {
      if (key && /^(token|api[_-]?key|secret|password)$/i.test(key)) {
        return `${key}=[redacted]`
      }
      return match.includes('@') ? '[redacted-credential]@' : '[redacted-secret]'
    })
  }
  return sanitized.length > MAX_STRING_DETAIL_LENGTH
    ? `${sanitized.slice(0, MAX_STRING_DETAIL_LENGTH)}...`
    : sanitized
}

export function sanitizeCrashReportDetails(
  details: Record<string, unknown>
): Record<string, CrashReportDetailValue> {
  const sanitized: Record<string, CrashReportDetailValue> = {}
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeCrashReportString(value)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      sanitized[key] = value
    } else if (typeof value === 'boolean' || value === null) {
      sanitized[key] = value
    }
  }
  return sanitized
}

export function sanitizeCrashReportBreadcrumbs(
  breadcrumbs: CrashReportBreadcrumbInput[] | undefined
): CrashReportBreadcrumb[] | undefined {
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return undefined
  }

  const sanitized = breadcrumbs
    .slice(-MAX_BREADCRUMBS)
    .map((breadcrumb): CrashReportBreadcrumb | null => {
      if (!breadcrumb.name.trim() || !breadcrumb.createdAt.trim()) {
        return null
      }
      const data = breadcrumb.data ? sanitizeCrashReportDetails(breadcrumb.data) : {}
      return {
        createdAt: sanitizeCrashReportString(breadcrumb.createdAt),
        name: sanitizeCrashReportString(breadcrumb.name).slice(0, MAX_BREADCRUMB_NAME_LENGTH),
        ...(Object.keys(data).length > 0 ? { data } : {})
      }
    })
    .filter((breadcrumb): breadcrumb is CrashReportBreadcrumb => breadcrumb !== null)

  return sanitized.length > 0 ? sanitized : undefined
}

export function formatCrashReportText(
  report: CrashReportRecord,
  notes?: string,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  const lines = [
    '[Crash Report]',
    '',
    `Report ID: ${report.id}`,
    `Created: ${report.createdAt}`,
    `Status: ${report.status}`,
    `Source: ${report.source}`,
    `Process: ${report.processType}`,
    `Reason: ${report.reason}`,
    `Exit code: ${report.exitCode ?? 'unknown'}`,
    `App version: ${report.appVersion}`,
    `Platform: ${report.platform} ${report.osRelease} ${report.arch}`,
    `Electron: ${report.electronVersion}`,
    `Chrome: ${report.chromeVersion}`
  ]

  const details = Object.entries(report.details)
  if (details.length > 0) {
    lines.push('', 'Details:')
    for (const [key, value] of details) {
      lines.push(`- ${key}: ${String(value)}`)
    }
  }

  if (report.breadcrumbs && report.breadcrumbs.length > 0) {
    lines.push('', 'Recent activity:')
    for (const breadcrumb of report.breadcrumbs) {
      const data = breadcrumb.data ? Object.entries(breadcrumb.data) : []
      const suffix =
        data.length > 0
          ? ` (${data.map(([key, value]) => `${key}=${String(value)}`).join(', ')})`
          : ''
      lines.push(`- ${breadcrumb.createdAt}: ${breadcrumb.name}${suffix}`)
    }
  }

  appendDiagnosticBundleLines(lines, diagnosticBundle)

  const trimmedNotes = notes?.trim()
  if (trimmedNotes) {
    lines.push('', 'User notes:', sanitizeCrashReportString(trimmedNotes))
  }

  return truncateFormattedCrashReport(lines.join('\n'))
}

export function formatUncapturedCrashReportText(
  context: UncapturedCrashReportContext,
  notes?: string,
  diagnosticBundle?: CrashReportDiagnosticBundle
): string {
  const lines = [
    '[Crash Report]',
    '',
    'Report ID: not captured',
    `Created: ${context.createdAt}`,
    'Status: uncaptured',
    'Source: user-reported',
    'Process: unknown',
    'Reason: no captured crash report',
    'Exit code: unknown',
    `App version: ${context.appVersion}`,
    `Platform: ${context.platform} ${context.osRelease} ${context.arch}`,
    `Electron: ${context.electronVersion}`,
    `Chrome: ${context.chromeVersion}`,
    '',
    'Details:',
    '- captured_crash_report: false',
    '- report_source: help_menu'
  ]

  appendDiagnosticBundleLines(lines, diagnosticBundle)

  const trimmedNotes = notes?.trim()
  if (trimmedNotes) {
    lines.push('', 'User notes:', sanitizeCrashReportString(trimmedNotes))
  }

  return truncateFormattedCrashReport(lines.join('\n'))
}

function appendDiagnosticBundleLines(
  lines: string[],
  diagnosticBundle: CrashReportDiagnosticBundle | undefined
): void {
  if (!diagnosticBundle) {
    return
  }
  lines.push('', 'Diagnostic log:')
  if (diagnosticBundle.status === 'uploaded') {
    lines.push(
      '- Status: uploaded',
      `- Ticket ID: ${sanitizeCrashReportString(diagnosticBundle.ticketId)}`,
      `- Bundle submission ID: ${sanitizeCrashReportString(diagnosticBundle.bundleSubmissionId)}`,
      `- Spans: ${diagnosticBundle.spanCount}`,
      `- Bytes: ${diagnosticBundle.bytes}`
    )
    return
  }
  lines.push(
    '- Status: not uploaded',
    `- Reason: ${sanitizeCrashReportString(diagnosticBundle.reason)}`
  )
  if (diagnosticBundle.bundleSubmissionId) {
    lines.push(
      `- Bundle submission ID: ${sanitizeCrashReportString(diagnosticBundle.bundleSubmissionId)}`
    )
  }
  if (typeof diagnosticBundle.spanCount === 'number') {
    lines.push(`- Spans: ${diagnosticBundle.spanCount}`)
  }
  if (typeof diagnosticBundle.bytes === 'number') {
    lines.push(`- Bytes: ${diagnosticBundle.bytes}`)
  }
}

function truncateFormattedCrashReport(text: string): string {
  if (text.length <= MAX_FORMATTED_REPORT_LENGTH) {
    return text
  }
  // Why: the feedback endpoint accepts larger crash bodies and handles
  // Slack-specific attachments server-side. Keep local reports below that API cap.
  const budget = MAX_FORMATTED_REPORT_LENGTH - FORMATTED_REPORT_TRUNCATION_SUFFIX.length
  return `${text.slice(0, Math.max(0, budget)).trimEnd()}${FORMATTED_REPORT_TRUNCATION_SUFFIX}`
}
