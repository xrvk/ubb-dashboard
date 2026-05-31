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

/**
 * Build a path under the enterprise. Paths starting with `/copilot` (or any
 * non-`settings/billing` enterprise endpoint) should pass `enterpriseScoped: true`
 * via the init.headers (we read it from a custom header below). For ergonomics,
 * a path can also start with `enterprise:` to skip the billing prefix.
 */
export function createApiFetch(creds: Credentials): ApiFetch {
  return async (path: string, init?: RequestInit) => {
    const useEnterpriseRoot = path.startsWith('enterprise:')
    const cleanPath = useEnterpriseRoot ? path.slice('enterprise:'.length) : path
    const url = useEnterpriseRoot
      ? `${creds.base}/enterprises/${creds.ent}${cleanPath}`
      : `${creds.base}/enterprises/${creds.ent}/settings/billing${cleanPath}`
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

export interface FetchUserBudgetsResult {
  /** User-scope Copilot (ai_credits) budgets only. What this dashboard manages. */
  userBudgets: UserBudget[]
  /**
   * Total budgets across the whole enterprise account (every type, scope, and SKU).
   * Used to surface the per-account 10,000 budget cap.
   * See https://docs.github.com/en/billing/concepts/budgets-and-alerts#budget-limitation
   */
  totalBudgetCount: number
}

/**
 * Fetch all Copilot user-scope budgets, paginated.
 *
 * Note: the enterprise billing budgets endpoint ignores `per_page` and returns
 * ~10 items per page in practice. There is no server-side `budget_scope`
 * filter (it is ignored). We therefore page through every budget and filter
 * client-side. The safety limit is set to support enterprises at the platform
 * cap (~10k budgets ≈ 1000 pages at 10 / page); we cap at 1500 to be safe.
 *
 * Returns both the filtered user-scope Copilot budgets and the total count of
 * all budgets across the account (used for the 10k cap warning).
 */
export async function fetchUserBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<FetchUserBudgetsResult> {
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
  return {
    userBudgets: all.filter(b => b.budget_scope === 'user' && isCopilotBudget(b)).map(toUserBudget),
    totalBudgetCount: totalCount ?? all.length,
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

// --- Cost centers ---

/**
 * A resource attached to a cost center. We care about `User` and `Org`
 * entries; `Repository` and any other future types are preserved on the type
 * but ignored by the resolver.
 */
export interface CostCenterResource {
  type: 'User' | 'Org' | 'Repository' | string
  name: string
}

export interface CostCenter {
  id: string
  name: string
  state: string
  resources: CostCenterResource[]
}

/**
 * How a user resolved to a cost center.
 * - `user`: the user's login is directly in the CC.
 * - `org`: the user's Copilot-license-granting org is in the CC.
 *
 * Per https://docs.github.com/en/billing/reference/cost-center-allocation
 * user-direct membership wins over org-inherited.
 */
export type CostCenterResolutionVia = 'user' | 'org'

export interface CostCenterResolution {
  cc: CostCenter
  via: CostCenterResolutionVia
  /** When via === 'org', the login slug of the org that contributed the CC. */
  viaOrg?: string
}

interface CostCentersResponse {
  costCenters?: CostCenter[]
  cost_centers?: CostCenter[]
}

/**
 * Fetch every active cost center in the enterprise.
 *
 * Uses page-based pagination (`?page=N&per_page=100`) and stops on the first
 * short or empty page, matching `fetchUserBudgets`. We accept both
 * `costCenters` (current shape) and `cost_centers` (snake_case) just in case
 * the API normalizes naming across hosts.
 *
 * Returns only `state === 'active'` entries since this dashboard only cares
 * about live attribution.
 */
export async function fetchCostCenters(apiFetch: ApiFetch): Promise<CostCenter[]> {
  const PAGE_SAFETY_LIMIT = 200
  const PER_PAGE = 100
  const all: CostCenter[] = []
  let page = 1
  while (page <= PAGE_SAFETY_LIMIT) {
    const data = (await apiFetch(
      `enterprise:/settings/billing/cost-centers?state=active&per_page=${PER_PAGE}&page=${page}`,
    )) as CostCentersResponse | CostCenter[]
    const list: CostCenter[] = Array.isArray(data)
      ? data
      : (data?.costCenters ?? data?.cost_centers ?? [])
    if (list.length === 0) break
    all.push(...list)
    if (list.length < PER_PAGE) break
    page += 1
  }
  if (page > PAGE_SAFETY_LIMIT) {
    console.warn(
      `[ind-ulb-dashboard] Cost-center pagination safety limit hit at ${PAGE_SAFETY_LIMIT} pages; loaded ${all.length}.`,
    )
  }
  return all.filter(cc => cc.state === 'active')
}

export interface CostCenterIndex {
  userToCC: Map<string, CostCenter>
  orgToCC: Map<string, CostCenter>
}

/**
 * Build lookup maps from a list of cost centers. Keys are lowercased logins
 * / org slugs. If the same login or org appears in multiple active CCs, the
 * first occurrence wins and we log a single console.warn per duplicate so
 * admins can clean it up.
 */
export function buildCostCenterIndex(costCenters: CostCenter[]): CostCenterIndex {
  const userToCC = new Map<string, CostCenter>()
  const orgToCC = new Map<string, CostCenter>()
  for (const cc of costCenters) {
    if (cc.state !== 'active') continue
    for (const r of cc.resources ?? []) {
      if (!r.name) continue
      const key = r.name.toLowerCase()
      if (r.type === 'User') {
        if (userToCC.has(key)) {
          console.warn(
            `[ind-ulb-dashboard] User "${r.name}" is in multiple active cost centers; using "${userToCC.get(key)!.name}".`,
          )
          continue
        }
        userToCC.set(key, cc)
      } else if (r.type === 'Org') {
        if (orgToCC.has(key)) {
          console.warn(
            `[ind-ulb-dashboard] Org "${r.name}" is in multiple active cost centers; using "${orgToCC.get(key)!.name}".`,
          )
          continue
        }
        orgToCC.set(key, cc)
      }
    }
  }
  return { userToCC, orgToCC }
}

/**
 * Resolve a user to their effective cost center for Copilot billing.
 *
 * Priority (per cost-center-allocation docs):
 *   1. Direct User membership
 *   2. Org membership (via the org that granted the user's Copilot license)
 *   3. null (enterprise default — surfaced as "Unassigned")
 */
export function resolveCostCenter(
  login: string,
  orgLogin: string | null | undefined,
  index: CostCenterIndex,
): CostCenterResolution | null {
  const userHit = index.userToCC.get(login.toLowerCase())
  if (userHit) return { cc: userHit, via: 'user' }
  if (orgLogin) {
    const orgHit = index.orgToCC.get(orgLogin.toLowerCase())
    if (orgHit) return { cc: orgHit, via: 'org', viaOrg: orgLogin }
  }
  return null
}

// --- Copilot seats: fetcher ---

/**
 * Fetch every Copilot seat in the enterprise. Used to power the username
 * autocomplete in the "Add ULB" dialog so admins don't have to remember
 * GitHub handles.
 */
export async function fetchAllCopilotSeats(apiFetch: ApiFetch): Promise<CopilotSeat[]> {
  const all: RawSeat[] = []
  let page = 1
  let totalSeats: number | undefined
  while (page <= 1500) {
    const data = (await apiFetch(`enterprise:/copilot/billing/seats?per_page=100&page=${page}`)) as SeatsResponse
    const list = data?.seats ?? []
    if (typeof data?.total_seats === 'number') totalSeats = data.total_seats
    if (list.length === 0) break
    all.push(...list)
    if (totalSeats !== undefined && all.length >= totalSeats) break
    page += 1
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
