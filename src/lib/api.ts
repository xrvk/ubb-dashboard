/**
 * GitHub Copilot Organization Billing API client.
 *
 * All calls go to `{base}/orgs/{org}/settings/billing/...`.
 * apiFetch automatically adds Authorization, Accept, and X-GitHub-Api-Version headers.
 *
 * github.com only — this client deliberately does not support GHE.com or GHES
 * hosts. The org-level Copilot AI-credit budgets API is a github.com-only
 * surface today. If you need an enterprise variant, see xrvk/ind-ulb-dashboard.
 */

import {
  ApiError,
  AbortedError,
  NetworkError,
  apiErrorFromResponse,
  isAborted,
  isRetryable,
  retryAfterSecondsFromError,
} from '@/lib/errors'

const API_VERSION = '2026-03-10'

export interface Credentials {
  base: string
  org: string
  token: string
}

// Re-export the typed error surface so existing callers that import from
// `@/lib/api` keep working. New code should import from `@/lib/errors`.
export { ApiError } from '@/lib/errors'
export type { ErrorKind, ErrorDescription } from '@/lib/errors'
import { ApiError as _ApiError } from '@/lib/errors'

/**
 * Snapshot of the GitHub primary rate limit at the time of a response.
 * Parsed from `x-ratelimit-*` headers. `resetAt` is a unix-epoch ms timestamp.
 */
export interface RateLimitSnapshot {
  limit: number
  remaining: number
  resetAt: number
  resource: string | null
}

/**
 * GitHub returns `403 Forbidden` (not 429) when the primary 5,000 req/hr
 * limit is exhausted, with `x-ratelimit-remaining: 0`. Distinguishing this
 * from a permission 403 lets the batch runner abort cleanly instead of
 * retrying or sleeping for up to an hour.
 */
export function isPrimaryRateLimitExhausted(err: unknown): err is _ApiError {
  if (!(err instanceof _ApiError)) return false
  if (err.status !== 403) return false
  return err.headers['x-ratelimit-remaining'] === '0'
}

function parseRateLimitHeaders(headers: Headers): RateLimitSnapshot | null {
  const limit = headers.get('x-ratelimit-limit')
  const remaining = headers.get('x-ratelimit-remaining')
  const reset = headers.get('x-ratelimit-reset')
  if (!limit || !remaining || !reset) return null
  const limitNum = Number(limit)
  const remainingNum = Number(remaining)
  const resetSec = Number(reset)
  if (!Number.isFinite(limitNum) || !Number.isFinite(remainingNum) || !Number.isFinite(resetSec)) {
    return null
  }
  return {
    limit: limitNum,
    remaining: remainingNum,
    resetAt: Math.round(resetSec * 1000),
    resource: headers.get('x-ratelimit-resource'),
  }
}

let lastRateLimit: RateLimitSnapshot | null = null

export function getLastKnownRateLimit(): RateLimitSnapshot | null {
  return lastRateLimit
}

/** Test-only: reset module state between tests. */
export function _resetRateLimitCache(): void {
  lastRateLimit = null
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<unknown>

/**
 * Build a path under the org's billing API.
 * Most paths target `{base}/orgs/{org}/settings/billing/{path}`. For
 * non-billing org endpoints (e.g. `/copilot/billing/seats` which is rooted
 * at `/orgs/{org}/copilot/...`, NOT under `/settings/billing/`), prefix the
 * path with `org:` to skip the billing prefix.
 */
/**
 * Validate that a base URL points at api.github.com before we send a
 * bearer token to it. This is both a real defense-in-depth measure (a typo'd
 * `.env.local` or stored credential can't exfiltrate the token to a random
 * host) and a CodeQL sanitizer that breaks the `js/file-access-to-http` taint
 * flow from env-loaded credentials into `fetch`.
 *
 * Allowed:
 *   - https://api.github.com
 *
 * GHE.com / GHES hosts are deliberately rejected. See file header.
 */
const ALLOWED_API_HOST = /^api\.github\.com$/i

function assertTrustedApiBase(base: string): string {
  let host: string
  let protocol: string
  try {
    const u = new URL(base)
    host = u.host
    protocol = u.protocol
  } catch {
    throw new Error(`Invalid API base URL: ${base}`)
  }
  if (protocol !== 'https:') {
    throw new Error(`API base must use https: ${base}`)
  }
  if (!ALLOWED_API_HOST.test(host)) {
    throw new Error(`Refusing to send credentials to untrusted host: ${host}`)
  }
  return `${protocol}//${host}`
}

/**
 * Headers we care about on errors and rate-limit decisions. Captured into
 * the thrown error so the batch runner can read `Retry-After` without
 * needing the original Response.
 */
const CAPTURED_HEADERS = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
  'x-github-request-id',
] as const

function captureHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of CAPTURED_HEADERS) {
    const v = res.headers.get(name)
    if (v != null) out[name] = v
  }
  return out
}

/**
 * Bounded exponential backoff with jitter, capped so the UI thread is never
 * blocked on a single request for more than ~30s of retries. Used for GETs
 * only (writes are routed through the batch runner).
 */
const GET_RETRY_DEFAULTS = {
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
  totalBudgetMs: 30_000,
}

function jitter(ms: number): number {
  // Full jitter: random in [0, ms]
  return Math.round(Math.random() * ms)
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new AbortedError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createApiFetch(creds: Credentials): ApiFetch {
  const safeBase = assertTrustedApiBase(creds.base)
  const safeOrg = encodeURIComponent(creds.org)
  // Re-stringify the token through a primitive to drop any inherited taint
  // before it crosses the fetch boundary (host has already been allowlisted).
  const safeToken = String(creds.token)
  return async (path: string, init?: RequestInit) => {
    const useOrgRoot = path.startsWith('org:')
    const cleanPath = useOrgRoot ? path.slice('org:'.length) : path
    const url = useOrgRoot
      ? `${safeBase}/orgs/${safeOrg}${cleanPath}`
      : `${safeBase}/orgs/${safeOrg}/settings/billing${cleanPath}`
    const method = (init?.method ?? 'GET').toUpperCase()
    const isIdempotent = method === 'GET' || method === 'HEAD'

    const doOnce = async (): Promise<unknown> => {
      let res: Response
      try {
        res = await fetch(url, {
          ...init,
          headers: {
            Authorization: `Bearer ${safeToken}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': API_VERSION,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...(init?.headers ?? {}),
          },
        })
      } catch (cause) {
        // fetch rejected outright — offline, DNS, TLS, CORS, etc.
        if (isAborted(cause)) throw new AbortedError()
        throw new NetworkError(cause)
      }
      const text = await res.text()
      const snapshot = parseRateLimitHeaders(res.headers)
      if (snapshot) lastRateLimit = snapshot
      if (!res.ok) {
        throw apiErrorFromResponse(res.status, text, captureHeaders(res))
      }
      return text ? JSON.parse(text) : null
    }

    // Mutations are single-shot at the transport layer. The batch runner
    // owns retry policy for writes (it has dedupe context and per-item
    // failure tracking that the transport does not).
    if (!isIdempotent) {
      return doOnce()
    }

    const { maxRetries, baseDelayMs, maxDelayMs, totalBudgetMs } = GET_RETRY_DEFAULTS
    const startedAt = Date.now()
    let attempt = 0
    let lastErr: unknown
    while (attempt <= maxRetries) {
      try {
        return await doOnce()
      } catch (err) {
        lastErr = err
        if (isAborted(err)) throw err
        if (!isRetryable(err) || attempt >= maxRetries) throw err
        // Budget guards the *total* elapsed wallclock, including request
        // execution time — not just the sleep delays. A slow flaky request
        // (e.g. 25s 5xx) followed by even a small backoff could otherwise
        // sail past the cap.
        const elapsed = Date.now() - startedAt
        if (elapsed >= totalBudgetMs) throw err
        // For 429, honor Retry-After if it fits in our remaining budget.
        let waitMs: number
        if (err instanceof ApiError && err.kind === 'rate_limit') {
          const ra = retryAfterSecondsFromError(err)
          waitMs = ra != null ? ra * 1000 : Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
        } else {
          waitMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
        }
        waitMs += jitter(Math.min(500, waitMs))
        if (elapsed + waitMs > totalBudgetMs) throw err
        await delayWithAbort(waitMs, init?.signal ?? undefined)
        attempt += 1
      }
    }
    throw lastErr
  }
}

/**
 * Free pre-flight lookup of the caller's current rate-limit window. The
 * `/rate_limit` endpoint does not itself count against the limit, so it's
 * safe to poll before launching a large batch.
 */
export async function fetchRateLimit(creds: Credentials): Promise<RateLimitSnapshot | null> {
  const safeBase = assertTrustedApiBase(creds.base)
  const safeToken = String(creds.token)
  const res = await fetch(`${safeBase}/rate_limit`, {
    headers: {
      Authorization: `Bearer ${safeToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    },
  })
  if (!res.ok) return null
  const snapshot = parseRateLimitHeaders(res.headers)
  if (snapshot) lastRateLimit = snapshot
  return snapshot
}

/**
 * Parse an organization URL like `https://github.com/{org}` (the URL the
 * user pastes from their browser) into `{ base, org }`. Also accepts a bare
 * org slug for power users who don't want to copy a full URL. Returns null
 * for any input that doesn't match those two shapes or that targets a
 * non-github.com host.
 */
export function parseOrgUrl(url: string): { base: string; org: string } | null {
  const trimmed = url.trim()
  if (!trimmed) return null
  // Reserved single-segment names that look like org slugs but aren't.
  const reserved = new Set(['settings', 'orgs', 'organizations', 'enterprises', 'notifications', 'features', 'pricing', 'about'])
  // Bare slug fallback: a single segment of valid org-name characters.
  // GitHub org slugs are 1–39 chars, alphanumeric + hyphens, no leading hyphen.
  if (/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(trimmed)) {
    if (reserved.has(trimmed.toLowerCase())) return null
    return { base: 'https://api.github.com', org: trimmed }
  }
  try {
    const u = new URL(trimmed)
    if (u.host !== 'github.com') return null
    // Pathname is `/{org}` (optionally with trailing slash). Reject deeper
    // paths to avoid silently treating `/{org}/{repo}/...` as just `/{org}`.
    const segments = u.pathname.split('/').filter(Boolean)
    if (segments.length !== 1) return null
    const org = segments[0]
    if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/.test(org)) return null
    if (reserved.has(org.toLowerCase())) return null
    return { base: 'https://api.github.com', org }
  } catch {
    return null
  }
}

// --- Budget types ---

export interface BudgetAlerting {
  will_alert: boolean
  alert_recipients: string[]
}

export interface RawBudget {
  id: string
  budget_type: string
  budget_product_sku: string
  budget_scope: string
  budget_amount: number
  prevent_further_usage: boolean
  budget_entity_name: string
  budget_alerting: BudgetAlerting
  /**
   * Not returned on `organization`-scope budgets in practice (only user-scope
   * and multi_user_customer). Treat as optional.
   */
  consumed_amount?: number
  user?: string
}

export interface UserBudget {
  id: string
  user: string
  budgetAmount: number
  consumedAmount: number
  preventFurtherUsage: boolean
  willAlert: boolean
  alertRecipients: string[]
}

interface BudgetsResponse {
  budgets?: RawBudget[]
  total_count?: number
}
/**
 * Predicate for "this is a budget that our ULB constraint math should consider."
 *
 * We intentionally only match `BundlePricing / ai_credits`. The org may also
 * have parallel `SkuPricing / copilot_ai_credit` budgets — that's a different
 * pricing track and is out of scope here. See docs/budget-constraints.md
 * ("SKU drift") for context.
 */
export function isCopilotBudget(b: RawBudget): boolean {
  return b.budget_product_sku === 'ai_credits' && b.budget_type === 'BundlePricing'
}

export function toUserBudget(b: RawBudget): UserBudget {
  return {
    id: b.id,
    user: b.user ?? b.budget_entity_name,
    budgetAmount: b.budget_amount,
    consumedAmount: b.consumed_amount ?? 0,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Internal: fetch pages 2..N concurrently with a small concurrency cap.
 *
 * Used by paginated endpoints where page 1 already tells us the grand
 * total (so we know exactly how many more pages exist) and the upstream
 * API doesn't punish parallel reads. Replaces the previous
 * await-each-page loop, which was the dominant connect-time cost on
 * large enterprises (e.g. 14 seat pages × ~1s sequential).
 *
 * Concurrency is capped at 8 — well below GitHub's secondary rate-limit
 * threshold for read-only billing endpoints, and enough to hide all but
 * the first round-trip's latency for any realistic page count.
 *
 * Errors propagate: any rejected page rejects the whole batch (same
 * behavior as the old sequential loop, which would throw on the first
 * failure).
 */
const PARALLEL_PAGE_CONCURRENCY = 8

async function fetchPagesInParallel<T>(
  fetchPage: (page: number) => Promise<T[]>,
  pageNumbers: number[],
): Promise<T[][]> {
  const results: T[][] = new Array(pageNumbers.length)
  for (let i = 0; i < pageNumbers.length; i += PARALLEL_PAGE_CONCURRENCY) {
    const chunkStart = i
    const chunk = pageNumbers.slice(i, i + PARALLEL_PAGE_CONCURRENCY)
    await Promise.all(
      chunk.map(async (page, j) => {
        results[chunkStart + j] = await fetchPage(page)
      }),
    )
  }
  return results
}

/**
 * Internal: page through ALL budgets across the organization (every scope,
 * type, and SKU). Used by every higher-level fetcher to avoid making multiple
 * full scans of the budgets endpoint.
 *
 * Strategy: fetch page 1, then if `total_count` and the page-1 length tell
 * us more pages remain, fetch them all in parallel via
 * `fetchPagesInParallel`. Falls back to sequential when `total_count` is
 * missing (defensive — the budgets endpoint always returns it today, but
 * a server change shouldn't quietly truncate our results).
 *
 * Note: the organization billing budgets endpoint caps `per_page` at 10
 * (vs 100 on the enterprise variant), so even a modestly-sized list takes
 * several round-trips. The parallel-fetch path uses the actual page-1
 * length as the effective page size, so this is automatic. Capped at 1500
 * pages (~15k budgets) as a paranoia limit.
 */
// Shared safety limit for paginators. Picked to comfortably cover the platform
// caps (~10k budgets at 100/page, ~250–1k cost centers, large seat counts)
// without ever spinning forever on a bug where the server keeps returning
// non-empty pages. Hitting it is a signal something is wrong and produces a
// console.warn (caller never sees more than this many pages of data).
const PAGE_SAFETY_LIMIT = 1500

async function paginateAllBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<{ budgets: RawBudget[]; totalCount: number }> {
  const fetchBudgetPage = async (page: number): Promise<{ list: RawBudget[]; totalCount: number | undefined }> => {
    // Org budgets endpoint caps per_page at 10 (vs 100 enterprise).
    const data = (await apiFetch(`/budgets?per_page=10&page=${page}`)) as BudgetsResponse | RawBudget[]
    const list = Array.isArray(data) ? data : (data?.budgets ?? [])
    const totalCount = !Array.isArray(data) && typeof data?.total_count === 'number' ? data.total_count : undefined
    return { list, totalCount }
  }

  const first = await fetchBudgetPage(1)
  const all: RawBudget[] = [...first.list]
  const totalCount = first.totalCount
  onProgress?.(all.length, totalCount)

  // Stop early when page 1 already has everything (or we got nothing).
  if (first.list.length === 0 || (totalCount !== undefined && all.length >= totalCount)) {
    return { budgets: all, totalCount: totalCount ?? all.length }
  }

  if (totalCount !== undefined) {
    const pageSize = first.list.length
    const remaining = Math.ceil((totalCount - all.length) / pageSize)
    const capped = Math.min(remaining, PAGE_SAFETY_LIMIT - 1)
    if (capped < remaining) {
      console.warn(
        `[ubb-dashboard] Pagination safety limit hit at ${PAGE_SAFETY_LIMIT} pages; ` +
          `would have loaded ${remaining + 1} pages for total_count=${totalCount}.`,
      )
    }
    const pages = Array.from({ length: capped }, (_, i) => i + 2)
    const fetched = await fetchPagesInParallel(
      async page => (await fetchBudgetPage(page)).list,
      pages,
    )
    // Append in page order (results[i] is for pages[i]) so callers that
    // rely on a stable order see the same shape as the old sequential loop.
    for (const list of fetched) {
      all.push(...list)
    }
    onProgress?.(all.length, totalCount)
    return { budgets: all, totalCount }
  }

  // Defensive sequential fallback when total_count is missing.
  let page = 2
  while (page <= PAGE_SAFETY_LIMIT) {
    const { list } = await fetchBudgetPage(page)
    if (list.length === 0) break
    all.push(...list)
    onProgress?.(all.length, undefined)
    page += 1
  }
  if (page > PAGE_SAFETY_LIMIT) {
    console.warn(
      `[ubb-dashboard] Pagination safety limit hit at ${PAGE_SAFETY_LIMIT} pages (no total_count); ` +
        `loaded ${all.length} budgets.`,
    )
  }
  return { budgets: all, totalCount: all.length }
}

export interface FetchUserBudgetsResult {
  /** User-scope Copilot (ai_credits) budgets only. What this dashboard manages. */
  userBudgets: UserBudget[]
  /**
   * Total budgets across the whole organization (every type, scope, and SKU).
   * Used to surface the per-org 10,000 budget cap.
   * See https://docs.github.com/en/billing/concepts/budgets-and-alerts#budget-limitation
   */
  totalBudgetCount: number
}

/**
 * Fetch all Copilot user-scope budgets, paginated.
 *
 * Returns both the filtered user-scope Copilot budgets and the total count of
 * all budgets across the account (used for the 10k cap warning).
 */
export async function fetchUserBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<FetchUserBudgetsResult> {
  const { budgets, totalCount } = await paginateAllBudgets(apiFetch, onProgress)
  return {
    userBudgets: budgets.filter(b => b.budget_scope === 'user' && isCopilotBudget(b)).map(toUserBudget),
    totalBudgetCount: totalCount,
  }
}

/** Update an existing user budget's amount. Hard stop (prevent_further_usage) is always enforced. */
export async function patchUserBudget(
  apiFetch: ApiFetch,
  budgetId: string,
  budgetAmount: number,
): Promise<void> {
  await apiFetch(`/budgets/${budgetId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      budget_amount: budgetAmount,
      prevent_further_usage: true,
    }),
  })
}

/** Create a new user-scope ai_credits budget. */
export async function createUserBudget(
  apiFetch: ApiFetch,
  username: string,
  budgetAmount: number,
): Promise<void> {
  await apiFetch(`/budgets`, {
    method: 'POST',
    body: JSON.stringify({
      budget_type: 'BundlePricing',
      budget_product_sku: 'ai_credits',
      budget_scope: 'user',
      budget_amount: budgetAmount,
      prevent_further_usage: true,
      target_entity: { user: username },
    }),
  })
}

export async function deleteUserBudget(apiFetch: ApiFetch, budgetId: string): Promise<void> {
  await apiFetch(`/budgets/${budgetId}`, { method: 'DELETE' })
}

// --- Universal ULB (multi_user_customer scope) ---

/**
 * The "universal ULB" is the single `multi_user_customer`-scope `ai_credits`
 * budget that caps every enterprise user not covered by a more specific budget
 * (cost center or individual). Enterprises have at most one of these.
 */
export interface UniversalUlb {
  id: string
  budgetAmount: number
  consumedAmount: number
  preventFurtherUsage: boolean
  willAlert: boolean
  alertRecipients: string[]
}

function toUniversalUlb(b: RawBudget): UniversalUlb {
  return {
    id: b.id,
    budgetAmount: b.budget_amount,
    consumedAmount: b.consumed_amount ?? 0,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Fetch the enterprise's universal ULB (multi_user_customer scope, ai_credits SKU).
 * Returns null if one isn't configured.
 */
export async function fetchUniversalULB(apiFetch: ApiFetch): Promise<UniversalUlb | null> {
  const { budgets } = await paginateAllBudgets(apiFetch)
  const hit = budgets.find(b => b.budget_scope === 'multi_user_customer' && isCopilotBudget(b))
  return hit ? toUniversalUlb(hit) : null
}

/** Update the universal ULB's cap. Hard stop is always enforced. */
export async function patchUniversalULB(
  apiFetch: ApiFetch,
  budgetId: string,
  budgetAmount: number,
): Promise<void> {
  await apiFetch(`/budgets/${budgetId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      budget_amount: budgetAmount,
      prevent_further_usage: true,
    }),
  })
}

/** Create the universal ULB (only used if one doesn't exist yet). */
export async function createUniversalULB(
  apiFetch: ApiFetch,
  budgetAmount: number,
): Promise<void> {
  await apiFetch(`/budgets`, {
    method: 'POST',
    body: JSON.stringify({
      budget_type: 'BundlePricing',
      budget_product_sku: 'ai_credits',
      budget_scope: 'multi_user_customer',
      budget_amount: budgetAmount,
      prevent_further_usage: true,
      target_entity: {},
    }),
  })
}

// --- Org-scope budget (the top of the constraint envelope) ---
// See docs/budget-constraints.md for the constraint model these power.

/**
 * The org's single ai_credits budget (the org-level cap on Copilot AI-credit
 * spend). In the org variant there is at most one such budget — the API
 * tolerates multiples in theory, but the UI treats the first as authoritative
 * and logs a warning if it sees more than one.
 */
export interface OrgBudget {
  id: string
  budgetAmount: number
  preventFurtherUsage: boolean
  willAlert: boolean
  alertRecipients: string[]
}

function toOrgBudget(b: RawBudget): OrgBudget {
  return {
    id: b.id,
    budgetAmount: b.budget_amount,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Fetch the org's ai_credits org-scope budget, if any. Returns `null` if
 * none exists.
 */
export async function fetchOrgBudget(apiFetch: ApiFetch): Promise<OrgBudget | null> {
  const { budgets } = await paginateAllBudgets(apiFetch)
  return pickOrgBudget(budgets)
}

function pickOrgBudget(budgets: RawBudget[]): OrgBudget | null {
  const matches = budgets.filter(b => b.budget_scope === 'organization' && isCopilotBudget(b))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    console.warn(
      `[ubb-dashboard-org] Multiple organization-scope ai_credits budgets found (${matches.length}); using the first.`,
    )
  }
  return toOrgBudget(matches[0])
}

/**
 * Pull every envelope budget we need for constraint analysis in a single
 * paginated scan of `/budgets`. Use this in callers that need more than one
 * of these (e.g. the constraints banner) so we don't make N redundant scans.
 *
 * Each individual `fetch*` above remains exported for callers that only need
 * one piece. Internally they all share `paginateAllBudgets`.
 */
export interface AiCreditsBudgets {
  org: OrgBudget | null
  universal: UniversalUlb | null
  userBudgets: UserBudget[]
  totalBudgetCount: number
}

export async function fetchAllAiCreditsBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<AiCreditsBudgets> {
  const { budgets, totalCount } = await paginateAllBudgets(apiFetch, onProgress)
  const universalRaw = budgets.find(b => b.budget_scope === 'multi_user_customer' && isCopilotBudget(b))
  return {
    org: pickOrgBudget(budgets),
    universal: universalRaw ? toUniversalUlb(universalRaw) : null,
    userBudgets: budgets.filter(b => b.budget_scope === 'user' && isCopilotBudget(b)).map(toUserBudget),
    totalBudgetCount: totalCount,
  }
}

/**
 * Patch fields for an organization-scope `ai_credits` budget.
 *
 * Each field is independently optional; the API accepts partial updates. We
 * send one PATCH per defined field rather than batching, mirroring the
 * upstream `copilot-budget-command-calculator` pattern — this means a failure
 * on one flag doesn't leave the others uncommitted in a single round-trip,
 * and the server returns the actual updated subset for free.
 */
export interface BudgetPatch {
  budgetAmount?: number
  /** Hard cap (`true`) blocks usage past budget; soft cap (`false`) only alerts. */
  preventFurtherUsage?: boolean
}

async function patchBudgetFields(
  apiFetch: ApiFetch,
  budgetId: string,
  patch: BudgetPatch,
): Promise<void> {
  if (patch.budgetAmount !== undefined) {
    await apiFetch(`/budgets/${budgetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ budget_amount: patch.budgetAmount }),
    })
  }
  if (patch.preventFurtherUsage !== undefined) {
    await apiFetch(`/budgets/${budgetId}`, {
      method: 'PATCH',
      body: JSON.stringify({ prevent_further_usage: patch.preventFurtherUsage }),
    })
  }
}

/** Update an existing org-scope ai_credits budget. */
export async function patchOrgBudget(
  apiFetch: ApiFetch,
  budgetId: string,
  patch: BudgetPatch | number,
): Promise<void> {
  const normalized: BudgetPatch = typeof patch === 'number' ? { budgetAmount: patch } : patch
  await patchBudgetFields(apiFetch, budgetId, normalized)
}

/**
 * Create the organization's single ai_credits org-scope budget. Errors if
 * one already exists (the API will return 422). Alerts default to off;
 * admins configure them via the org budgets UI (see `budgetEditUrl`).
 */
export async function createOrgBudget(
  apiFetch: ApiFetch,
  args: {
    orgSlug: string
    budgetAmount: number
    preventFurtherUsage: boolean
  },
): Promise<void> {
  await apiFetch(`/budgets`, {
    method: 'POST',
    body: JSON.stringify({
      budget_type: 'BundlePricing',
      budget_product_sku: 'ai_credits',
      budget_scope: 'organization',
      budget_entity_name: args.orgSlug,
      budget_amount: args.budgetAmount,
      prevent_further_usage: args.preventFurtherUsage,
      budget_alerting: { will_alert: false, alert_recipients: [] },
    }),
  })
}

// --- Org-admin web UI deep-links (alerts are managed in the org UI, not the API) ---

/** Convert the API base host (e.g. `https://api.github.com`) to the web UI base (e.g. `https://github.com`). */
export function apiBaseToWebBase(apiBase: string): string {
  return apiBase.replace('https://api.', 'https://')
}

// ============================================================================
// Billing Usage Summary
// ============================================================================
//
// `GET /settings/billing/usage/summary` (preview, X-GitHub-Api-Version
// 2026-03-10) — the only public surface that reports actual consumed dollars
// for enterprise- and cost-center-scope spend. The budgets API only exposes
// `consumed_amount` on `user` and `multi_user_customer` scopes, so this is
// where total AIC burn + per-CC roll-ups come from.
//
// See: docs.github.com/en/enterprise-cloud@latest/rest/billing/usage
//
// SKUs we care about (Copilot product):
//   - copilot_ai_unit         → metered AIC spend (this is what AIC budgets cap)
//   - coding_agent_ai_unit    → coding-agent AIC spend (separate meter)
//   - copilot_for_business    → CB license prorated cost ($19/user-month list)
//   - copilot_enterprise      → CE license prorated cost ($39/user-month list)

export interface RawUsageItem {
  product: string
  sku: string
  unitType: string
  pricePerUnit: number
  grossQuantity: number
  grossAmount: number
  discountQuantity?: number
  discountAmount?: number
  netQuantity: number
  netAmount: number
}

interface RawUsageSummary {
  timePeriod?: { year?: number; month?: number; day?: number }
  organization?: string
  product?: string
  usageItems?: RawUsageItem[]
}

export interface CopilotUsageSummary {
  year: number
  month: number
  /** Net (post-discount) MTD spend, $. */
  aiCreditsNet: number
  /** Gross (pre-discount) MTD spend, $. Useful for "before discounts" framing. */
  aiCreditsGross: number
  /** Net MTD coding-agent AIC spend, $. Reported separately from copilot_ai_unit. */
  codingAgentNet: number
  /** Prorated net CB license cost MTD, $. */
  cbLicenseNet: number
  /** Prorated net CE license cost MTD, $. */
  ceLicenseNet: number
  /** Original items, in case a caller needs full fidelity. */
  raw: RawUsageItem[]
}

/**
 * Fetch the Copilot billing usage summary for the current (or specified)
 * billing month. The org variant has no cost-center dimension, so this is
 * always organization-wide.
 */
export async function fetchCopilotUsageSummary(
  apiFetch: ApiFetch,
  opts: { year?: number; month?: number } = {},
): Promise<CopilotUsageSummary> {
  const params = new URLSearchParams()
  params.set('product', 'Copilot')
  if (opts.year) params.set('year', String(opts.year))
  if (opts.month) params.set('month', String(opts.month))
  const data = (await apiFetch(`/usage/summary?${params.toString()}`)) as RawUsageSummary
  const items = data.usageItems ?? []
  const sumNet = (sku: string) =>
    items.filter(i => i.sku === sku).reduce((s, i) => s + (i.netAmount ?? 0), 0)
  const sumGross = (sku: string) =>
    items.filter(i => i.sku === sku).reduce((s, i) => s + (i.grossAmount ?? 0), 0)
  const now = new Date()
  return {
    year: data.timePeriod?.year ?? now.getFullYear(),
    month: data.timePeriod?.month ?? now.getMonth() + 1,
    aiCreditsNet: sumNet('copilot_ai_unit'),
    aiCreditsGross: sumGross('copilot_ai_unit'),
    codingAgentNet: sumNet('coding_agent_ai_unit'),
    cbLicenseNet: sumNet('copilot_for_business'),
    ceLicenseNet: sumNet('copilot_enterprise'),
    raw: items,
  }
}

/**
 * Admin edit page for a specific budget — admins configure cap, alert
 * thresholds, and recipients here. Org variant uses the
 * /organizations/{org}/settings/billing/budgets/{id} surface.
 */
export function budgetEditUrl(apiBase: string, org: string, budgetId: string): string {
  return `${apiBaseToWebBase(apiBase)}/organizations/${org}/settings/billing/budgets/${budgetId}/edit`
}

/** Admin Org Budgets list page. */
export function orgBudgetsUrl(apiBase: string, org: string): string {
  return `${apiBaseToWebBase(apiBase)}/organizations/${org}/settings/billing/budgets`
}

/** Admin Copilot AI Usage page (drives the "view AI usage" deep-link). */
export function orgAiUsageUrl(apiBase: string, org: string): string {
  return `${apiBaseToWebBase(apiBase)}/organizations/${org}/settings/billing/ai_usage?period=3&group=7&chart_selection=2&view=models`
}

/** Admin Copilot seats / access page for the org. */
export function orgCopilotSeatsUrl(apiBase: string, org: string): string {
  return `${apiBaseToWebBase(apiBase)}/organizations/${org}/settings/copilot`
}

// --- Copilot seats (used as the source of truth for "add ULB" autocomplete) ---

export interface CopilotSeat {
  login: string
  orgLogin: string | null
  lastActivityAt: string | null
  planType: string | null
}

interface RawSeat {
  assignee?: { login?: string }
  organization?: { login?: string }
  last_activity_at?: string | null
  plan_type?: string | null
}

interface SeatsResponse {
  total_seats?: number
  seats?: RawSeat[]
}


// --- Copilot seats: fetcher ---

/**
 * Fetch every Copilot seat in the org. Used to power the username
 * autocomplete in the "Add ULB" dialog so admins don't have to remember
 * GitHub handles.
 *
 * Note: on some orgs that DO have ai_credits budgets, the seats endpoint
 * may report `{total_seats: 0}` — treat seats as best-effort enrichment,
 * not authoritative.
 */
export async function fetchAllCopilotSeats(apiFetch: ApiFetch): Promise<CopilotSeat[]> {
  const fetchSeatPage = async (page: number): Promise<{ list: RawSeat[]; totalSeats: number | undefined }> => {
    const data = (await apiFetch(
      `org:/copilot/billing/seats?per_page=100&page=${page}`,
    )) as SeatsResponse
    const list = data?.seats ?? []
    const totalSeats = typeof data?.total_seats === 'number' ? data.total_seats : undefined
    return { list, totalSeats }
  }

  const first = await fetchSeatPage(1)
  const all: RawSeat[] = [...first.list]
  const totalSeats = first.totalSeats

  // When page 1 already has everything, or total_seats says we're done.
  const needsMore =
    first.list.length > 0 && (totalSeats === undefined || all.length < totalSeats)

  if (needsMore) {
    if (totalSeats !== undefined) {
      // Known total → fan out pages 2..N in parallel.
      const pageSize = first.list.length
      const remaining = Math.ceil((totalSeats - all.length) / pageSize)
      const capped = Math.min(remaining, PAGE_SAFETY_LIMIT - 1)
      const pages = Array.from({ length: capped }, (_, i) => i + 2)
      const fetched = await fetchPagesInParallel(
        async page => (await fetchSeatPage(page)).list,
        pages,
      )
      // Append in page order to keep the post-dedupe set stable.
      for (const list of fetched) {
        all.push(...list)
      }
    } else {
      // Defensive sequential fallback when total_seats is missing.
      let page = 2
      while (page <= PAGE_SAFETY_LIMIT) {
        const { list } = await fetchSeatPage(page)
        if (list.length === 0) break
        all.push(...list)
        page += 1
      }
    }
  }

  // Dedupe by login (the API can return the same user across multiple orgs)
  const seen = new Set<string>()
  const out: CopilotSeat[] = []
  for (const s of all) {
    const login = s.assignee?.login
    if (!login || seen.has(login)) continue
    seen.add(login)
    out.push({
      login,
      orgLogin: s.organization?.login ?? null,
      lastActivityAt: s.last_activity_at ?? null,
      planType: s.plan_type ?? null,
    })
  }
  return out
}
