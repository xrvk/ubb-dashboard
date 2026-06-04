/**
 * Typed error taxonomy for the GitHub Enterprise Billing API.
 *
 * Every fetch-layer failure becomes one of the classes below (all extending
 * `ApiError`). UI callers branch on `kind` to decide what to render, whether
 * to retry, and what to suggest. The transport layer handles construction;
 * callers should not `instanceof` against the subclasses except where strictly
 * needed — prefer `describeError(err)` which centralizes the messaging.
 *
 * Notes:
 *  - `ApiError` stays the existing public type so existing `instanceof ApiError`
 *    checks (batch runner, tests) keep working.
 *  - Headers (`Retry-After`, `X-RateLimit-*`) are captured on the error so the
 *    batch runner can read them without the response object.
 *  - `NetworkError` covers `fetch` rejecting outright (offline, DNS, TLS).
 *    It has no HTTP status; we use 0.
 *  - `AbortedError` is reused by the batch runner; we re-export the existing
 *    one from there if you import it from this module.
 */

import { logDebug } from '@/lib/debugLog'

export type ErrorKind =
  | 'auth' // 401
  | 'scope' // 403 (insufficient PAT scope)
  | 'not_found' // 404
  | 'validation' // 422
  | 'rate_limit' // 429 (or secondary abuse detection)
  | 'server' // 5xx
  | 'network' // fetch rejected (offline, DNS, TLS, CORS)
  | 'aborted' // AbortSignal fired
  | 'unknown'

/**
 * Base API error. Carries response status, body excerpt, and selected headers.
 * Existing call sites that `instanceof ApiError` keep working.
 */
export class ApiError extends Error {
  readonly kind: ErrorKind
  readonly status: number
  readonly body: string
  /** Lower-cased header names → values, captured at throw time. */
  readonly headers: Readonly<Record<string, string>>

  constructor(
    status: number,
    body: string,
    opts: {
      kind?: ErrorKind
      headers?: Record<string, string>
      message?: string
    } = {},
  ) {
    super(opts.message ?? defaultMessage(status, body))
    this.name = 'ApiError'
    this.status = status
    this.body = body
    this.headers = Object.freeze(opts.headers ?? {})
    this.kind = opts.kind ?? kindFromStatus(status)
  }
}

export class AuthError extends ApiError {
  constructor(body: string, headers: Record<string, string> = {}) {
    super(401, body, { kind: 'auth', headers, message: 'Unauthorized (401): token is missing, invalid, or expired.' })
    this.name = 'AuthError'
  }
}

export class ScopeError extends ApiError {
  constructor(body: string, headers: Record<string, string> = {}) {
    super(403, body, {
      kind: 'scope',
      headers,
      message: 'Forbidden (403): your PAT does not have permission for this resource.',
    })
    this.name = 'ScopeError'
  }
}

export class NotFoundError extends ApiError {
  constructor(body: string, headers: Record<string, string> = {}) {
    super(404, body, { kind: 'not_found', headers, message: 'Not found (404).' })
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends ApiError {
  constructor(status: number, body: string, headers: Record<string, string> = {}) {
    super(status, body, {
      kind: 'validation',
      headers,
      message: `Validation error (${status}): the request was rejected as invalid.`,
    })
    this.name = 'ValidationError'
  }
}

export class RateLimitError extends ApiError {
  constructor(body: string, headers: Record<string, string> = {}) {
    super(429, body, {
      kind: 'rate_limit',
      headers,
      message: 'Rate limited (429): too many requests.',
    })
    this.name = 'RateLimitError'
  }
  /** Seconds to wait before retry, parsed from `Retry-After` or body, or null. */
  get retryAfterSeconds(): number | null {
    return retryAfterSecondsFromError(this)
  }
}

export class ServerError extends ApiError {
  constructor(status: number, body: string, headers: Record<string, string> = {}) {
    super(status, body, {
      kind: 'server',
      headers,
      message: `Server error (${status}): GitHub returned a transient failure.`,
    })
    this.name = 'ServerError'
  }
}

export class NetworkError extends ApiError {
  /** Original error from `fetch` (TypeError typically). */
  readonly cause: unknown
  constructor(cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    super(0, '', { kind: 'network', message: `Network error: ${msg}` })
    this.name = 'NetworkError'
    this.cause = cause
  }
}

export class AbortedError extends ApiError {
  constructor() {
    super(0, '', { kind: 'aborted', message: 'Request aborted.' })
    this.name = 'AbortedError'
  }
}

// --- Construction helpers ---

function defaultMessage(status: number, body: string): string {
  return `API error ${status}: ${body.slice(0, 200)}`
}

export function kindFromStatus(status: number): ErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'scope'
  if (status === 404) return 'not_found'
  if (status === 422) return 'validation'
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'server'
  if (status === 0) return 'unknown'
  return 'unknown'
}

/**
 * Build the right subclass from raw fetch outputs. Used by `createApiFetch`
 * so every non-2xx maps to a typed error in one place.
 */
export function apiErrorFromResponse(
  status: number,
  body: string,
  headers: Record<string, string>,
): ApiError {
  switch (kindFromStatus(status)) {
    case 'auth':
      return new AuthError(body, headers)
    case 'scope':
      return new ScopeError(body, headers)
    case 'not_found':
      return new NotFoundError(body, headers)
    case 'validation':
      return new ValidationError(status, body, headers)
    case 'rate_limit':
      return new RateLimitError(body, headers)
    case 'server':
      return new ServerError(status, body, headers)
    default:
      return new ApiError(status, body, { headers })
  }
}

// --- Retry-After parsing ---

/**
 * Read `Retry-After` from headers (preferred) or fall back to scanning the
 * response body (some GitHub error payloads embed `retry_after` in JSON).
 * Returns seconds, or `null` if absent / unparseable.
 */
export function retryAfterSecondsFromError(err: ApiError): number | null {
  const headerVal = err.headers['retry-after']
  if (headerVal) {
    const n = Number(headerVal)
    if (Number.isFinite(n) && n >= 0) return n
    // RFC HTTP-date form
    const t = Date.parse(headerVal)
    if (Number.isFinite(t)) {
      const diff = Math.max(0, Math.round((t - Date.now()) / 1000))
      return diff
    }
  }
  const m = err.body.match(/retry[-_ ]after[^0-9]*([0-9]+)/i)
  if (m) {
    const n = Number(m[1])
    if (Number.isFinite(n)) return n
  }
  return null
}

// --- Predicates used by the transport retry layer ---

export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.kind === 'rate_limit') return true
  if (err.kind === 'server') return true
  if (err.kind === 'network') return true
  return false
}

export function isAborted(err: unknown): boolean {
  return err instanceof AbortedError ||
    (err instanceof Error && err.name === 'AbortError')
}

// --- UI-facing description ---

export interface ErrorDescription {
  /** Short headline (≤80 chars) suitable for a toast title / banner header. */
  title: string
  /** One-sentence explanation, capped ~200 chars, safe to render in a toast. */
  body: string
  /** Whether the user can reasonably retry (vs. needs to change PAT/URL). */
  recoverable: boolean
  /** Suggested next action, if any. */
  suggestedAction?: string
}

const BODY_MAX = 200

function clipBody(s: string, max = BODY_MAX): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

/**
 * Map any error to a human-readable description. Always logs the full error
 * to the debug ring buffer (one line per call) so the toast stays short while
 * we keep diagnostic context available via "Copy error log".
 */
export function describeError(err: unknown, source = 'app'): ErrorDescription {
  // Log first so even unknown errors are captured.
  logErrorOnce(err, source)

  if (err instanceof AbortedError) {
    return { title: 'Cancelled', body: 'Operation was cancelled.', recoverable: true }
  }
  if (err instanceof NetworkError) {
    return {
      title: 'Network error',
      body: 'Could not reach the GitHub API. Check your connection and try again.',
      recoverable: true,
      suggestedAction: 'Retry',
    }
  }
  if (err instanceof AuthError) {
    return {
      title: 'Token rejected',
      body: 'Your personal access token is missing, invalid, or expired.',
      recoverable: false,
      suggestedAction: 'Reconnect with a new PAT',
    }
  }
  if (err instanceof ScopeError) {
    return {
      title: 'Insufficient scope',
      body:
        'Your PAT lacks the required permission for this resource. Classic PATs need `admin:org` (the full parent scope, not the `read:org`/`write:org` sub-scopes).',
      recoverable: false,
      suggestedAction: 'Reconnect with an upgraded PAT',
    }
  }
  if (err instanceof NotFoundError) {
    return {
      title: 'Not found',
      body: 'The resource was not found. It may have been deleted, or your PAT may not see it.',
      recoverable: false,
    }
  }
  if (err instanceof ValidationError) {
    return {
      title: 'Invalid request',
      body: clipBody(extractApiMessage(err.body) ?? err.message),
      recoverable: false,
    }
  }
  if (err instanceof RateLimitError) {
    const waitS = err.retryAfterSeconds
    const body = waitS != null
      ? `GitHub asked us to wait ${waitS}s before retrying.`
      : 'GitHub is rate-limiting requests. Try again in a minute.'
    return {
      title: 'Rate limited',
      body,
      recoverable: true,
      suggestedAction: 'Retry shortly',
    }
  }
  if (err instanceof ServerError) {
    return {
      title: `GitHub error (${err.status})`,
      body: 'GitHub returned a transient server error. It usually clears within a few minutes.',
      recoverable: true,
      suggestedAction: 'Retry',
    }
  }
  if (err instanceof ApiError) {
    return {
      title: `Error ${err.status}`,
      body: clipBody(extractApiMessage(err.body) ?? err.message),
      recoverable: false,
    }
  }
  if (err instanceof Error) {
    return { title: 'Error', body: clipBody(err.message), recoverable: false }
  }
  return { title: 'Error', body: clipBody(String(err)), recoverable: false }
}

/** Best-effort: pull the `message` field out of a GitHub JSON error body. */
function extractApiMessage(body: string): string | null {
  if (!body) return null
  try {
    const obj = JSON.parse(body) as { message?: unknown; errors?: unknown }
    if (typeof obj.message === 'string') return obj.message
  } catch {
    /* not JSON */
  }
  return null
}

/**
 * Log once. We intentionally don't dedupe across calls — the ring buffer is
 * small enough that repeats are useful signal about how often something is
 * happening. Tokens are never put on errors so the body is safe to log.
 */
function logErrorOnce(err: unknown, source: string): void {
  if (err instanceof ApiError) {
    logDebug('error', source, err.message, {
      kind: err.kind,
      status: err.status,
      headers: err.headers,
      body: err.body ? err.body.slice(0, 500) : undefined,
    })
    return
  }
  if (err instanceof Error) {
    logDebug('error', source, err.message, { name: err.name, stack: err.stack?.slice(0, 1000) })
    return
  }
  logDebug('error', source, String(err))
}
