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
  /**
   * Not returned on enterprise- or cost_center-scope budgets in practice
   * (only user-scope). Treat as optional.
   */
  consumed_amount?: number
  user?: string
  /**
   * Only present on `budget_scope === 'enterprise'` budgets. Controls whether
   * cost-center spend rolls up into the enterprise pool (umbrella, default)
   * or is tracked independently (when true). See docs/budget-constraints.md.
   */
  exclude_cost_center_usage?: boolean
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
 * We intentionally only match `BundlePricing / ai_credits`. The enterprise can
 * also have parallel `SkuPricing / copilot_ai_credit` budgets — that's a
 * different pricing track and is out of scope here. See
 * docs/budget-constraints.md ("SKU drift") for context.
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
 * Internal: page through ALL budgets across the enterprise account (every
 * scope, type, and SKU). Used by every higher-level fetcher to avoid making
 * multiple full scans of the budgets endpoint.
 *
 * Note: the enterprise billing budgets endpoint historically ignored
 * `per_page` and returned ~10 items per page; recent versions honor it.
 * Either way the safety loop handles both. We cap at 1500 pages to support
 * enterprises at the platform cap (~10k budgets).
 */
async function paginateAllBudgets(
  apiFetch: ApiFetch,
  onProgress?: (loaded: number, totalCount: number | undefined) => void,
): Promise<{ budgets: RawBudget[]; totalCount: number }> {
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
  return { budgets: all, totalCount: totalCount ?? all.length }
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

// --- Enterprise + cost-center budgets (envelope for the constraint check) ---
// See docs/budget-constraints.md for the constraint model these power.

/**
 * The enterprise-scope `ai_credits` budget. There is at most one we care
 * about (filter is `BundlePricing/ai_credits`); if multiple are returned we
 * take the first and warn.
 */
export interface EnterpriseBudget {
  id: string
  budgetAmount: number
  /** `false` (default) = umbrella mode, `true` = independent mode. */
  excludeCostCenterUsage: boolean
  preventFurtherUsage: boolean
  willAlert: boolean
  alertRecipients: string[]
}

function toEnterpriseBudget(b: RawBudget): EnterpriseBudget {
  return {
    id: b.id,
    budgetAmount: b.budget_amount,
    excludeCostCenterUsage: b.exclude_cost_center_usage ?? false,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Fetch the enterprise's ai_credits enterprise-scope budget, if any. Returns
 * `null` if none exists.
 */
export async function fetchEnterpriseBudget(apiFetch: ApiFetch): Promise<EnterpriseBudget | null> {
  const { budgets } = await paginateAllBudgets(apiFetch)
  return pickEnterpriseBudget(budgets)
}

function pickEnterpriseBudget(budgets: RawBudget[]): EnterpriseBudget | null {
  const matches = budgets.filter(b => b.budget_scope === 'enterprise' && isCopilotBudget(b))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    console.warn(
      `[ind-ulb-dashboard] Multiple enterprise-scope ai_credits budgets found (${matches.length}); using the first.`,
    )
  }
  return toEnterpriseBudget(matches[0])
}

/**
 * One cost-center-scope `ai_credits` budget. Keyed by the cost center NAME
 * (which is what `budget_entity_name` carries — verified empirically against
 * the live API, not the CC's UUID).
 */
export interface CostCenterBudget {
  id: string
  costCenterName: string
  budgetAmount: number
  preventFurtherUsage: boolean
  willAlert: boolean
  alertRecipients: string[]
}

function toCostCenterBudget(b: RawBudget): CostCenterBudget {
  return {
    id: b.id,
    costCenterName: b.budget_entity_name,
    budgetAmount: b.budget_amount,
    preventFurtherUsage: b.prevent_further_usage,
    willAlert: b.budget_alerting?.will_alert ?? false,
    alertRecipients: b.budget_alerting?.alert_recipients ?? [],
  }
}

/**
 * Fetch every cost-center-scope ai_credits budget, keyed by lowercased CC
 * name. Use this with `fetchCostCenters` and join on `cc.name` (lowercased).
 */
export async function fetchCostCenterBudgets(
  apiFetch: ApiFetch,
): Promise<Map<string, CostCenterBudget>> {
  const { budgets } = await paginateAllBudgets(apiFetch)
  return buildCostCenterBudgetMap(budgets)
}

function buildCostCenterBudgetMap(budgets: RawBudget[]): Map<string, CostCenterBudget> {
  const map = new Map<string, CostCenterBudget>()
  for (const b of budgets) {
    if (b.budget_scope !== 'cost_center' || !isCopilotBudget(b)) continue
    const key = b.budget_entity_name.toLowerCase()
    if (map.has(key)) {
      console.warn(
        `[ind-ulb-dashboard] Multiple cost-center budgets target name "${b.budget_entity_name}"; using the first.`,
      )
      continue
    }
    map.set(key, toCostCenterBudget(b))
  }
  return map
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
  enterprise: EnterpriseBudget | null
  universal: UniversalUlb | null
  costCenterBudgetsByName: Map<string, CostCenterBudget>
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
    enterprise: pickEnterpriseBudget(budgets),
    universal: universalRaw ? toUniversalUlb(universalRaw) : null,
    costCenterBudgetsByName: buildCostCenterBudgetMap(budgets),
    userBudgets: budgets.filter(b => b.budget_scope === 'user' && isCopilotBudget(b)).map(toUserBudget),
    totalBudgetCount: totalCount,
  }
}

/**
 * Patch fields for an enterprise- or cost-center-scope `ai_credits` budget.
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

/** Update an existing enterprise-scope ai_credits budget. */
export async function patchEnterpriseBudget(
  apiFetch: ApiFetch,
  budgetId: string,
  patch: BudgetPatch | number,
): Promise<void> {
  const normalized: BudgetPatch = typeof patch === 'number' ? { budgetAmount: patch } : patch
  await patchBudgetFields(apiFetch, budgetId, normalized)
}

/** Update an existing cost-center-scope ai_credits budget. */
export async function patchCostCenterBudget(
  apiFetch: ApiFetch,
  budgetId: string,
  patch: BudgetPatch | number,
): Promise<void> {
  const normalized: BudgetPatch = typeof patch === 'number' ? { budgetAmount: patch } : patch
  await patchBudgetFields(apiFetch, budgetId, normalized)
}

/**
 * Create a new ai_credits budget for an existing cost center.
 *
 * `costCenterEntityName` is what gets sent as `budget_entity_name`. Our read
 * path (see `buildCostCenterBudgetMap`) treats `budget_entity_name` as the CC
 * NAME — verified empirically against the live API — so we send the name
 * here too. Alerts are off by default; admins configure them via the GHEC
 * budget edit page (see `budgetEditUrl`).
 */
export async function createCostCenterBudget(
  apiFetch: ApiFetch,
  args: {
    costCenterEntityName: string
    budgetAmount: number
    preventFurtherUsage: boolean
  },
): Promise<void> {
  await apiFetch(`/budgets`, {
    method: 'POST',
    body: JSON.stringify({
      budget_type: 'BundlePricing',
      budget_product_sku: 'ai_credits',
      budget_scope: 'cost_center',
      budget_entity_name: args.costCenterEntityName,
      budget_amount: args.budgetAmount,
      prevent_further_usage: args.preventFurtherUsage,
      budget_alerting: { will_alert: false, alert_recipients: [] },
    }),
  })
}

// --- GHEC web UI deep-links (alerts are managed in the GHEC UI, not the API) ---

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
  enterprise?: string
  costCenter?: { id: string; name: string }
  product?: string
  usageItems?: RawUsageItem[]
}

export interface CopilotUsageSummary {
  year: number
  month: number
  /** `null` when this summary is enterprise-wide (no cost_center_id filter). */
  costCenterId: string | null
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
 * billing month. Optionally filter by `costCenterId` — pass the literal
 * string `'none'` to get usage NOT attributed to any cost center
 * (a.k.a. the universal/default pool from a billing perspective).
 */
export async function fetchCopilotUsageSummary(
  apiFetch: ApiFetch,
  opts: { costCenterId?: string | 'none'; year?: number; month?: number } = {},
): Promise<CopilotUsageSummary> {
  const params = new URLSearchParams()
  params.set('product', 'Copilot')
  if (opts.year) params.set('year', String(opts.year))
  if (opts.month) params.set('month', String(opts.month))
  if (opts.costCenterId) params.set('cost_center_id', opts.costCenterId)
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
    costCenterId: opts.costCenterId ?? null,
    aiCreditsNet: sumNet('copilot_ai_unit'),
    aiCreditsGross: sumGross('copilot_ai_unit'),
    codingAgentNet: sumNet('coding_agent_ai_unit'),
    cbLicenseNet: sumNet('copilot_for_business'),
    ceLicenseNet: sumNet('copilot_enterprise'),
    raw: items,
  }
}

/** GHEC edit page for a specific budget — admins configure alert thresholds + recipients here. */
export function budgetEditUrl(apiBase: string, ent: string, budgetId: string): string {
  return `${apiBaseToWebBase(apiBase)}/enterprises/${ent}/billing/budgets/${budgetId}/edit`
}

/** GHEC cost-centers list — useful when a CC has no budget yet (no ID to deep-link to). */
export function costCentersUrl(apiBase: string, ent: string): string {
  return `${apiBaseToWebBase(apiBase)}/enterprises/${ent}/billing/cost_centers`
}

/** GHEC single cost-center page — drill into a specific CC's resources & members. */
export function costCenterUrl(apiBase: string, ent: string, ccId: string): string {
  return `${apiBaseToWebBase(apiBase)}/enterprises/${ent}/billing/cost_centers/${ccId}`
}

/** GHEC enterprise members / Copilot seats page. */
export function enterpriseSeatsUrl(apiBase: string, ent: string): string {
  return `${apiBaseToWebBase(apiBase)}/enterprises/${ent}/people`
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
 *
 * TODO(team-cc-linkage, ~2 months): the GH platform plans to add `Team` as a
 * resource type (enterprise team → cost center binding). The type already
 * accepts it as a string fallthrough; `resolveCostCenter` will need a new
 * branch when that ships.
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
  /**
   * Orgs that appear in multiple ai-credits-budgeted CCs. Surface this as a
   * soft warning; the index itself uses first-wins-by-CC-id. Only populated
   * when `costCenterBudgetsByName` is passed.
   */
  orgBudgetedCollisions: Array<{ org: string; costCenterNames: string[] }>
}

/**
 * Build lookup maps from a list of cost centers. Keys are lowercased logins
 * / org slugs.
 *
 * - User resources: the API enforces uniqueness across active CCs, so we
 *   never collide. (Older code warned about User collisions; that branch was
 *   dead and has been removed.)
 * - Org resources: an org CAN be in multiple CCs. We use first-wins by CC ID
 *   (deterministic). We only flag collisions where BOTH colliding CCs have
 *   an ai_credits budget — that's the only case where ambiguity affects the
 *   constraint math (see docs/budget-constraints.md). Pass
 *   `costCenterBudgetsByName` (lowercased keys) from
 *   `fetchCostCenterBudgets()` to enable that check.
 */
export function buildCostCenterIndex(
  costCenters: CostCenter[],
  costCenterBudgetsByName?: ReadonlyMap<string, CostCenterBudget>,
): CostCenterIndex {
  const userToCC = new Map<string, CostCenter>()
  const orgToCC = new Map<string, CostCenter>()
  const orgToBudgetedCCs = new Map<string, CostCenter[]>()
  const sortedCCs = [...costCenters].sort((a, b) => a.id.localeCompare(b.id))
  for (const cc of sortedCCs) {
    if (cc.state !== 'active') continue
    const ccHasAiCreditsBudget = costCenterBudgetsByName?.has(cc.name.toLowerCase()) ?? false
    for (const r of cc.resources ?? []) {
      if (!r.name) continue
      const key = r.name.toLowerCase()
      if (r.type === 'User') {
        // API enforces uniqueness; no collision branch needed.
        userToCC.set(key, cc)
      } else if (r.type === 'Org') {
        if (!orgToCC.has(key)) orgToCC.set(key, cc)
        if (ccHasAiCreditsBudget) {
          const arr = orgToBudgetedCCs.get(key) ?? []
          arr.push(cc)
          orgToBudgetedCCs.set(key, arr)
        }
      }
    }
  }
  const orgBudgetedCollisions = [...orgToBudgetedCCs.entries()]
    .filter(([, ccs]) => ccs.length > 1)
    .map(([org, ccs]) => ({ org, costCenterNames: ccs.map(c => c.name) }))
  for (const c of orgBudgetedCollisions) {
    console.warn(
      `[ind-ulb-dashboard] Org "${c.org}" is in multiple ai-credits-budgeted cost centers (${c.costCenterNames.join(', ')}); using the first by CC id.`,
    )
  }
  return { userToCC, orgToCC, orgBudgetedCollisions }
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
