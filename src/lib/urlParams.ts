import { parseEnterpriseUrl } from './api'

/**
 * Allowlist of hosts the connect form will prefill against. Matches
 * `ALLOWED_API_HOST` in `api.ts` (minus the `api.` prefix that's added
 * when the URL is converted to an API base). Keeping these two regexes
 * in lockstep matters: if the prefill produces a value the API base
 * sanitizer would reject, connecting would fail with a confusing
 * "untrusted host" error.
 */
const ALLOWED_ENTERPRISE_HOST = /^(github\.com|[a-z0-9-]+\.ghe\.com)$/i

/**
 * Optional `?ent=...` query param that prefills the Enterprise URL field
 * in the connect form. Accepts either:
 *
 *   - a bare slug (`?ent=octodemo`) → normalized to
 *     `https://github.com/enterprises/octodemo`, or
 *   - a full URL (`?ent=https://github.com/enterprises/octodemo` or
 *     `?ent=https://customer.ghe.com/enterprises/octodemo`) → used as-is
 *     after validation.
 *
 * The companion `?host=...` param lets users target a specific GHE.com
 * tenant with a bare slug: `?ent=octodemo&host=customer.ghe.com`
 * resolves to `https://customer.ghe.com/enterprises/octodemo`. `?host`
 * is ignored when `?ent` is already a full URL, and falls back to
 * `github.com` when missing or pointed at an unsupported host.
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
  // does the host check via the same allowlist used by the API base
  // sanitizer, so a `?host=` companion would be redundant here.
  if (/^https?:\/\//i.test(trimmed)) {
    return parseEnterpriseUrl(trimmed) ? trimmed : null
  }

  // Otherwise treat it as a bare slug. Restrict to a conservative
  // character set that matches what GitHub allows in enterprise slugs;
  // this also rules out path traversal / query / fragment injection.
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null
  const host = readHostParam(params)
  // `host` is `false` when the user passed `?host=` with a bad value.
  // Reject the whole prefill in that case so we fall back to the env
  // default — silently swapping in github.com would be misleading.
  if (host === false) return null
  const candidate = `https://${host ?? 'github.com'}/enterprises/${trimmed}`
  return parseEnterpriseUrl(candidate) ? candidate : null
}

/**
 * Read and validate `?host=`. Returns:
 *   - `null` when the param is absent or empty (caller picks a default),
 *   - `false` when the param is present but points at a host we don't
 *     trust (caller should bail out entirely),
 *   - the normalized host string when valid.
 */
function readHostParam(params: URLSearchParams): string | false | null {
  const raw = params.get('host')
  if (raw === null) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  if (!ALLOWED_ENTERPRISE_HOST.test(trimmed)) return false
  return trimmed
}
