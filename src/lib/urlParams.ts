import { parseOrgUrl, type Credentials } from './api'

/**
 * Optional `?org=...` query param that prefills the Organization URL field
 * in the connect form. Accepts either:
 *
 *   - a bare org slug (`?org=acme`) → normalized to
 *     `https://github.com/acme`, or
 *   - a full URL (`?org=https://github.com/acme`) → used
 *     as-is after validation.
 *
 * Invalid values (garbage, unparseable URLs, slugs with disallowed
 * characters, non-GitHub hosts) return `null` so the caller can fall
 * back to its default.
 *
 * Note: only the URL is read from query params — the PAT is always
 * entered manually to avoid leakage via history, referrer, or server
 * logs.
 */
export function readOrgUrlFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('org')
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // If it looks like a URL, validate it directly. `parseOrgUrl` enforces the
  // github.com host restriction so we don't need a separate host check.
  if (/^https?:\/\//i.test(trimmed)) {
    return parseOrgUrl(trimmed) ? trimmed : null
  }

  // Otherwise treat it as a bare slug.
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(trimmed)) return null
  const candidate = `https://github.com/${trimmed}`
  return parseOrgUrl(candidate) ? candidate : null
}

/**
 * Build a shareable link that pre-fills the Organization URL on the
 * connect form. Returns `null` for demo credentials (nothing real to
 * share) or when the API base can't be parsed.
 *
 * Always emits the short `?org=<slug>` form since this variant is
 * github.com-only.
 */
export function buildShareableOrgUrl(
  credentials: Credentials,
  origin: string,
  pathname: string,
): string | null {
  if (credentials.base === 'demo://') return null
  return `${origin}${pathname}?org=${encodeURIComponent(credentials.org)}`
}
