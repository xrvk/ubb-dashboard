/**
 * GitHub Enterprise Billing API client.
 *
 * All calls go to `{base}/enterprises/{ent}/settings/billing/...`.
 * apiFetch automatically adds Authorization, Accept, and X-GitHub-Api-Version headers.
 */

const API_VERSION = '2026-03-10'

export interface Credentials {
  base: string
  ent: string
  token: string
}

export class ApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string, message?: string) {
    super(message ?? `API error ${status}: ${body.slice(0, 200)}`)
    this.status = status
    this.body = body
  }
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<unknown>

export function createApiFetch(creds: Credentials): ApiFetch {
  return async (path: string, init?: RequestInit) => {
    const url = `${creds.base}/enterprises/${creds.ent}/settings/billing${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${creds.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const text = await res.text()
    if (!res.ok) {
      throw new ApiError(res.status, text)
    }
    return text ? JSON.parse(text) : null
  }
}

/**
 * Parse an enterprise URL like `https://your-host.example.com/enterprises/your-slug`
 * into `{ base, ent }`. Also accepts `https://github.com/enterprises/foo`.
 */
export function parseEnterpriseUrl(url: string): { base: string; ent: string } | null {
  try {
    const u = new URL(url.trim())
    const m = u.pathname.match(/\/enterprises\/([^/]+)/)
    if (!m) return null
    const ent = m[1]
    // api subdomain: api.<host> for GHE.com, api.github.com for github.com
    let host = u.host
    if (host === 'github.com') host = 'api.github.com'
    else if (!host.startsWith('api.')) host = `api.${host}`
    return { base: `${u.protocol}//${host}`, ent }
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
  consumed_amount: number
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
export function isCopilotBudget(b: RawBudget): boolean {
  return b.budget_product_sku === 'ai_credits'
}

export function toUserBudget(b: RawBudget): UserBudget {
  return {
    id: b.id,
    user: b.user ?? b.budget_entity_name,
    budgetAmount: b.budget_amount,
    consumedAmount: b.consumed_amount,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Fetch all Copilot user-scope budgets, paginated.
 *
 * Note: the enterprise billing budgets endpoint ignores `per_page` and returns
 * ~10 items per page in practice. There is no server-side `budget_scope`
 * filter (it is ignored). We therefore page through every budget and filter
 * client-side. The safety limit is set to support enterprises at the platform
 * cap (~10k budgets ≈ 1000 pages at 10 / page); we cap at 1500 to be safe.
 */
export async function fetchUserBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<UserBudget[]> {
  const PAGE_SAFETY_LIMIT = 1500
  const all: RawBudget[] = []
  let page = 1
  let totalCount: number | undefined
  while (page <= PAGE_SAFETY_LIMIT) {
    const data = (await apiFetch(`/budgets?per_page=100&page=${page}`)) as BudgetsResponse | RawBudget[]
    const list = Array.isArray(data) ? data : (data?.budgets ?? [])
    if (!Array.isArray(data) && typeof data?.total_count === 'number') {
      totalCount = data.total_count
    }
    if (list.length === 0) break
    all.push(...list)
    onProgress?.(all.length, totalCount)
    if (totalCount !== undefined && all.length >= totalCount) break
    page += 1
  }
  if (page > PAGE_SAFETY_LIMIT) {
    console.warn(
      `[ind-ulb-dashboard] Pagination safety limit hit at ${PAGE_SAFETY_LIMIT} pages; ` +
        `loaded ${all.length} budgets but total_count was ${totalCount ?? 'unknown'}.`,
    )
  }
  return all.filter(b => b.budget_scope === 'user' && isCopilotBudget(b)).map(toUserBudget)
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
