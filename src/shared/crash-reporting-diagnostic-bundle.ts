export type CrashReportDiagnosticBundle =
  | {
      status: 'uploaded'
      ticketId: string
      bundleSubmissionId: string
      bytes: number
      spanCount: number
      blobUrl?: string
      blobDownloadUrl?: string
      blobPathname?: string
    }
  | {
      status: 'not_uploaded'
      reason: string
      bundleSubmissionId?: string
      bytes?: number
      spanCount?: number
    }

const LOCAL_HTTP_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function sanitizeCrashReportUrl(value: string, sanitizeString: (value: string) => string): string {
  try {
    const parsed = new URL(value)
    const allowed =
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && LOCAL_HTTP_HOSTNAMES.has(parsed.hostname))
    return allowed ? value : sanitizeString(value)
  } catch {
    return sanitizeString(value)
  }
}

export function appendDiagnosticBundleLines(
  lines: string[],
  diagnosticBundle: CrashReportDiagnosticBundle | undefined,
  sanitizeString: (value: string) => string
): void {
  if (!diagnosticBundle) {
    return
  }
  lines.push('', 'Diagnostic log:')
  if (diagnosticBundle.status === 'uploaded') {
    lines.push(
      '- Status: uploaded',
      `- Ticket ID: ${sanitizeString(diagnosticBundle.ticketId)}`,
      `- Bundle submission ID: ${sanitizeString(diagnosticBundle.bundleSubmissionId)}`,
      `- Spans: ${diagnosticBundle.spanCount}`,
      `- Bytes: ${diagnosticBundle.bytes}`
    )
    if (diagnosticBundle.blobUrl) {
      lines.push(`- Blob URL: ${sanitizeCrashReportUrl(diagnosticBundle.blobUrl, sanitizeString)}`)
    }
    if (diagnosticBundle.blobDownloadUrl) {
      lines.push(
        `- Blob download URL: ${sanitizeCrashReportUrl(diagnosticBundle.blobDownloadUrl, sanitizeString)}`
      )
    }
    if (diagnosticBundle.blobPathname) {
      lines.push(`- Blob path: ${sanitizeString(diagnosticBundle.blobPathname)}`)
    }
    return
  }
  lines.push('- Status: not uploaded', `- Reason: ${sanitizeString(diagnosticBundle.reason)}`)
  if (diagnosticBundle.bundleSubmissionId) {
    lines.push(`- Bundle submission ID: ${sanitizeString(diagnosticBundle.bundleSubmissionId)}`)
  }
  if (typeof diagnosticBundle.spanCount === 'number') {
    lines.push(`- Spans: ${diagnosticBundle.spanCount}`)
  }
  if (typeof diagnosticBundle.bytes === 'number') {
    lines.push(`- Bytes: ${diagnosticBundle.bytes}`)
  }
}
