import { parseEnterpriseUrl } from './api'

/**
 * Optional `?ent=...` query param that prefills the Enterprise URL field
 * in the connect form. Accepts either:
 *
 *   - a bare slug (`?ent=octodemo`) → normalized to
 *     `https://github.com/enterprises/octodemo`, or
 *   - a full URL (`?ent=https://github.com/enterprises/octodemo`) → used
 *     as-is after validation.
 *
 * Invalid values (garbage, unparseable URLs, slugs with disallowed
 * characters) return `null` so the caller can fall back to its default.
 *
 * Note: only the URL is read from query params — the PAT is always
 * entered manually to avoid leakage via history, referrer, or server
 * logs.
 */
export function readEnterpriseUrlFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('ent')
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  // If it looks like a URL, validate it directly.
  if (/^https?:\/\//i.test(trimmed)) {
    return parseEnterpriseUrl(trimmed) ? trimmed : null
  }

  // Otherwise treat it as a bare slug. Restrict to a conservative
  // character set that matches what GitHub allows in enterprise slugs;
  // this also rules out path traversal / query / fragment injection.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null
  const candidate = `https://github.com/enterprises/${trimmed}`
  return parseEnterpriseUrl(candidate) ? candidate : null
}
