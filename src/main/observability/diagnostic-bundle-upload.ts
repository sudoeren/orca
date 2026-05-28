import { URL } from 'node:url'
import { MAX_BUNDLE_BYTES } from './diagnostic-bundle-limits'
import { postBodyForJson, postJsonForJson } from './diagnostic-upload-http'

const TOKEN_REQUEST_TIMEOUT_MS = 10_000
const UPLOAD_TIMEOUT_MS = 30_000

export type UploadBundleOptions = {
  /** Server endpoint that issues short-lived tokens. From a build-time
   *  constant or a user-set env var (developer mode). */
  readonly tokenEndpoint: string
  /** Already-collected payload bytes retained by main after preview. */
  readonly payload: string
  readonly bundleSubmissionId: string
}

export type UploadBundleResult = {
  readonly ticketId: string
  readonly blobUrl?: string
  readonly blobDownloadUrl?: string
  readonly blobPathname?: string
}

export type DeleteBundleOptions = {
  readonly tokenEndpoint: string
  readonly ticketId: string
}

type TokenResponse = {
  readonly token: string
  readonly expires_at: string
  readonly upload_url: string
  readonly max_bytes: number
}

type UploadResponse = {
  readonly ticket_id: string
  readonly blob_url?: unknown
  readonly blob_download_url?: unknown
  readonly blob_pathname?: unknown
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

function optionalTrustedDiagnosticUrl(value: unknown, tokenEndpoint: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }
  try {
    const parsed = new URL(value)
    const token = new URL(tokenEndpoint)
    if (parsed.host !== token.host) {
      return undefined
    }
    if (token.protocol === 'https:') {
      return parsed.protocol === 'https:' ? value : undefined
    }
    if (token.protocol === 'http:') {
      return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) ? value : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Two-step upload through a short-lived token. Failures throw an Error
 * with a human-readable message; the IPC handler in `ipc/diagnostics.ts`
 * surfaces them in the renderer toast.
 */
export async function uploadBundle(opts: UploadBundleOptions): Promise<UploadBundleResult> {
  const bytes = Buffer.byteLength(opts.payload)
  if (bytes > MAX_BUNDLE_BYTES) {
    throw new Error(`bundle exceeds 4 MiB cap (${bytes} bytes)`)
  }

  // (1) Request a token. The token endpoint is rate-limited per IP at the
  // edge (10/hour). A failure here typically means the user has hit the
  // rate limit or the network is offline.
  const tokenRes = (await postJsonForJson(
    opts.tokenEndpoint,
    {
      bundle_submission_id: opts.bundleSubmissionId,
      bytes
    },
    TOKEN_REQUEST_TIMEOUT_MS
  )) as TokenResponse
  if (
    typeof tokenRes.token !== 'string' ||
    typeof tokenRes.upload_url !== 'string' ||
    typeof tokenRes.max_bytes !== 'number'
  ) {
    throw new Error('malformed token response')
  }
  if (bytes > tokenRes.max_bytes) {
    throw new Error(`bundle exceeds server-issued cap (${bytes} > ${tokenRes.max_bytes})`)
  }

  // Validate `upload_url` BEFORE we send the bearer token + user data to it.
  // A misconfigured or compromised token endpoint could otherwise redirect
  // the upload (with the bearer token and the user's NDJSON payload) to an
  // attacker-controlled host. Require https in production and only relax to
  // http when the configured tokenEndpoint is itself non-https for local dev.
  validateUploadUrl(tokenRes.upload_url, opts.tokenEndpoint)

  // (2) Upload using the bearer token. The server only accepts NDJSON uploads
  // for this route and rejects other content-types at the edge.
  const uploadRes = (await postBodyForJson({
    url: tokenRes.upload_url,
    body: opts.payload,
    headers: {
      authorization: `Bearer ${tokenRes.token}`,
      'content-type': 'application/x-ndjson',
      'content-length': String(bytes)
    },
    timeoutMs: UPLOAD_TIMEOUT_MS
  })) as UploadResponse

  if (typeof uploadRes.ticket_id !== 'string' || uploadRes.ticket_id.length === 0) {
    throw new Error('malformed upload response: missing ticket_id')
  }
  const blobUrl = optionalTrustedDiagnosticUrl(uploadRes.blob_url, opts.tokenEndpoint)
  const blobDownloadUrl = optionalTrustedDiagnosticUrl(
    uploadRes.blob_download_url,
    opts.tokenEndpoint
  )
  const blobPathname = optionalString(uploadRes.blob_pathname)
  return {
    ticketId: uploadRes.ticket_id,
    ...(blobUrl ? { blobUrl } : {}),
    ...(blobDownloadUrl ? { blobDownloadUrl } : {}),
    ...(blobPathname ? { blobPathname } : {})
  }
}

export async function deleteBundle(opts: DeleteBundleOptions): Promise<void> {
  const endpoint = resolveDeleteEndpoint(opts.tokenEndpoint, opts.ticketId)
  await postJsonForJson(endpoint, {}, TOKEN_REQUEST_TIMEOUT_MS)
}

/**
 * Reject an `upload_url` returned by the token endpoint that we can't safely
 * POST a bearer token + the user's diagnostic payload to. Exists because the
 * upload destination is chosen by the server response, not pinned at build
 * time — without this gate, a misconfigured or compromised token endpoint
 * could exfiltrate bundles to an attacker-controlled host.
 */
export function validateUploadUrl(uploadUrl: string, tokenEndpoint: string): void {
  let parsedUpload: URL
  try {
    parsedUpload = new URL(uploadUrl)
  } catch {
    throw new Error('invalid upload_url from token endpoint')
  }
  let parsedToken: URL
  try {
    parsedToken = new URL(tokenEndpoint)
  } catch {
    throw new Error('invalid tokenEndpoint configuration')
  }
  const tokenIsHttps = parsedToken.protocol === 'https:'
  if (tokenIsHttps && parsedUpload.protocol !== 'https:') {
    throw new Error('upload_url must use https when tokenEndpoint is https')
  }
  if (parsedUpload.protocol !== 'https:' && parsedUpload.protocol !== 'http:') {
    throw new Error('upload_url must use http(s)')
  }
  // Same-origin host pin. Defends against a compromised token endpoint that
  // returns a valid-https upload_url pointing at an attacker-controlled host.
  if (parsedUpload.host !== parsedToken.host) {
    throw new Error('upload_url host must match tokenEndpoint host')
  }
}

function resolveDeleteEndpoint(tokenEndpoint: string, ticketId: string): string {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(ticketId)) {
    throw new Error('ticketId has invalid format')
  }
  let parsedToken: URL
  try {
    parsedToken = new URL(tokenEndpoint)
  } catch {
    throw new Error('invalid tokenEndpoint configuration')
  }
  return new URL(`/diagnostics/delete/${encodeURIComponent(ticketId)}`, parsedToken).toString()
}
