import { parseEnterpriseUrl, type Credentials } from './api'

/**
 * Optional `?ent=...` query param that prefills the Enterprise URL field
 * in the connect form. Accepts either:
 *
 *   - a bare slug (`?ent=acme`) → normalized to
 *     `https://github.com/enterprises/acme`, or
 *   - a full URL (`?ent=https://github.com/enterprises/acme` or
 *     `?ent=https://customer.ghe.com/enterprises/acme`) → used
 *     as-is after validation. GHE.com tenants share their pre-fill
 *     link in this form.
 *
 * Invalid values (garbage, unparseable URLs, slugs with disallowed
 * characters, non-GitHub hosts) return `null` so the caller can fall
 * back to its default.
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

  // If it looks like a URL, validate it directly. `parseEnterpriseUrl`
  // enforces the same host allowlist used by the API base sanitizer,
  // so we don't need a separate host check here.
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

/**
 * Build a shareable link that pre-fills the Enterprise URL on the
 * connect form. Returns `null` for demo credentials (nothing real to
 * share) or when the API base can't be parsed.
 *
 * github.com tenants get the short `?ent=<slug>` form; GHE.com tenants
 * get the full-URL form so the recipient lands on the right host even
 * without a `?host=` companion.
 */
export function buildShareableEnterpriseUrl(
  credentials: Credentials,
  origin: string,
  pathname: string,
): string | null {
  if (credentials.base === 'demo://') return null
  let host: string
  try {
    host = new URL(credentials.base).host
  } catch {
    return null
  }
  // API bases are `api.<webhost>`; strip the prefix to recover the
  // user-facing host (`github.com` or `<tenant>.ghe.com`).
  const webHost = host.startsWith('api.') ? host.slice(4) : host
  const entValue =
    webHost === 'github.com'
      ? credentials.ent
      : `https://${webHost}/enterprises/${credentials.ent}`
  return `${origin}${pathname}?ent=${encodeURIComponent(entValue)}`
}
