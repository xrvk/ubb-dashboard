/**
 * Probe live enterprise budget + cost-center shapes from the GH billing API.
 *
 * Reads VITE_DEV_ENTERPRISE_URL + VITE_DEV_PAT from .env.local (symlinked across
 * worktrees). Dumps distinct (scope, type, sku) combos with samples, plus the
 * verbatim enterprise budget and CC budgets.
 *
 * Run: npx tsx scripts/probe-budgets.ts [output-path]
 * Output: prints to stdout + writes a JSON dump to the path passed as $1
 *         (defaults to ./probe-budgets-output.json — gitignored).
 *
 * IMPORTANT: This hits live data. Do not commit the output file.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

interface Env {
  enterpriseUrl: string
  token: string
}

function loadEnv(): Env {
  const candidates = ['.env.local', '.env']
  for (const c of candidates) {
    const p = resolve(REPO_ROOT, c)
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    const env: Record<string, string> = {}
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]+)"?\s*$/)
      if (m) env[m[1]] = m[2].trim()
    }
    const url = env.VITE_DEV_ENTERPRISE_URL ?? env.ENTERPRISE_URL
    const token = env.VITE_DEV_PAT ?? env.GH_PAT ?? env.GITHUB_TOKEN
    if (url && token) return { enterpriseUrl: url, token }
  }
  console.error('error: could not find VITE_DEV_ENTERPRISE_URL + VITE_DEV_PAT in .env.local or .env')
  process.exit(1)
}

function parseEntUrl(url: string): { base: string; ent: string } {
  const u = new URL(url.trim())
  const m = u.pathname.match(/\/enterprises\/([^/]+)/)
  if (!m) {
    console.error(`error: cannot parse enterprise from ${url}`)
    process.exit(1)
  }
  let host = u.host
  if (host === 'github.com') host = 'api.github.com'
  else if (!host.startsWith('api.')) host = `api.${host}`
  return { base: `${u.protocol}//${host}`, ent: m[1] }
}

const API_VERSION = '2026-03-10'

interface RawBudget {
  id: string
  budget_type: string
  budget_product_sku: string
  budget_scope: string
  budget_amount: number
  consumed_amount: number
  prevent_further_usage: boolean
  budget_entity_name: string
  exclude_cost_center_usage?: boolean
  budget_alerting?: { will_alert: boolean; alert_recipients: string[] }
  user?: string
  [k: string]: unknown
}

interface CostCenter {
  id: string
  name: string
  state: string
  resources: Array<{ type: string; name: string }>
  [k: string]: unknown
}

async function api<T = unknown>(
  base: string,
  ent: string,
  path: string,
  token: string,
  opts: { enterpriseRoot?: boolean } = {},
): Promise<T> {
  const url = opts.enterpriseRoot
    ? `${base}/enterprises/${ent}${path}`
    : `${base}/enterprises/${ent}/settings/billing${path}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`)
  }
  return text ? (JSON.parse(text) as T) : (null as T)
}

async function fetchAllBudgets(base: string, ent: string, token: string): Promise<RawBudget[]> {
  const all: RawBudget[] = []
  let page = 1
  while (page <= 1500) {
    const data = await api<{ budgets?: RawBudget[]; total_count?: number } | RawBudget[]>(
      base,
      ent,
      `/budgets?per_page=100&page=${page}`,
      token,
    )
    const list = Array.isArray(data) ? data : (data?.budgets ?? [])
    if (list.length === 0) break
    all.push(...list)
    const total = !Array.isArray(data) ? data?.total_count : undefined
    if (total !== undefined && all.length >= total) break
    page += 1
    if (page % 10 === 0) console.error(`  ...budgets page ${page}, loaded ${all.length}`)
  }
  return all
}

async function fetchAllCostCenters(base: string, ent: string, token: string): Promise<CostCenter[]> {
  const all: CostCenter[] = []
  let page = 1
  while (page <= 200) {
    const data = await api<{ costCenters?: CostCenter[]; cost_centers?: CostCenter[] } | CostCenter[]>(
      base,
      ent,
      `/settings/billing/cost-centers?state=active&per_page=100&page=${page}`,
      token,
      { enterpriseRoot: true },
    )
    const list = Array.isArray(data) ? data : (data?.costCenters ?? data?.cost_centers ?? [])
    if (list.length === 0) break
    all.push(...list)
    if (list.length < 100) break
    page += 1
  }
  return all
}

function pickSample<T>(arr: T[], n = 2): T[] {
  return arr.slice(0, n)
}

function summary(label: string, value: unknown): void {
  console.log(`\n## ${label}`)
  console.log(JSON.stringify(value, null, 2))
}

async function main() {
  const env = loadEnv()
  const { base, ent } = parseEntUrl(env.enterpriseUrl)
  const outPath = resolve(REPO_ROOT, process.argv[2] ?? 'probe-budgets-output.json')

  console.error(`probing ${ent} via ${base}`)

  console.error('fetching all budgets...')
  const budgets = await fetchAllBudgets(base, ent, env.token)
  console.error(`  got ${budgets.length} budgets`)

  console.error('fetching all cost centers...')
  const ccs = await fetchAllCostCenters(base, ent, env.token)
  console.error(`  got ${ccs.length} active cost centers`)

  // --- Distinct (scope, type, sku) combos with samples ---
  const combos = new Map<string, { count: number; sample: RawBudget }>()
  for (const b of budgets) {
    const k = `${b.budget_scope} / ${b.budget_type} / ${b.budget_product_sku}`
    const entry = combos.get(k)
    if (entry) entry.count += 1
    else combos.set(k, { count: 1, sample: b })
  }

  const comboTable = [...combos.entries()].map(([k, v]) => ({
    combo: k,
    count: v.count,
    sample_id: v.sample.id,
    sample_entity: v.sample.budget_entity_name,
    sample_amount: v.sample.budget_amount,
    has_exclude_flag: 'exclude_cost_center_usage' in v.sample,
    exclude_value: v.sample.exclude_cost_center_usage,
  }))
  summary('Distinct (scope/type/sku) combos', comboTable)

  // --- Enterprise-scope ai_credits budget(s) ---
  const entBudgets = budgets.filter(
    b => b.budget_scope === 'enterprise' && b.budget_product_sku === 'ai_credits',
  )
  summary('Enterprise-scope ai_credits budgets (verbatim)', entBudgets)

  // Also show all enterprise-scope budgets regardless of SKU (in case SKU naming differs).
  const entAll = budgets.filter(b => b.budget_scope === 'enterprise')
  summary('All enterprise-scope budgets (any SKU) — first 5', entAll.slice(0, 5))

  // --- Cost-center-scope budgets ---
  const ccBudgets = budgets.filter(b => b.budget_scope === 'cost_center')
  summary('Cost-center-scope budgets — count + first 5 verbatim', {
    total: ccBudgets.length,
    by_sku: ccBudgets.reduce<Record<string, number>>((acc, b) => {
      acc[b.budget_product_sku] = (acc[b.budget_product_sku] ?? 0) + 1
      return acc
    }, {}),
    samples: pickSample(ccBudgets, 5),
  })

  // --- Universal ULB ---
  const universal = budgets.filter(
    b => b.budget_scope === 'multi_user_customer' && b.budget_product_sku === 'ai_credits',
  )
  summary('Universal ULB (multi_user_customer / ai_credits)', universal)

  // --- User-scope ai_credits budgets ---
  const userBudgets = budgets.filter(
    b => b.budget_scope === 'user' && b.budget_product_sku === 'ai_credits',
  )
  summary('User-scope ai_credits budgets — count + sample', {
    total: userBudgets.length,
    sample: pickSample(userBudgets, 2),
  })

  // --- Cost centers: resource type breakdown ---
  const resourceTypeCounts: Record<string, number> = {}
  let ccsWithUsers = 0
  let ccsWithOrgs = 0
  for (const cc of ccs) {
    let hasUser = false
    let hasOrg = false
    for (const r of cc.resources ?? []) {
      resourceTypeCounts[r.type] = (resourceTypeCounts[r.type] ?? 0) + 1
      if (r.type === 'User') hasUser = true
      if (r.type === 'Org') hasOrg = true
    }
    if (hasUser) ccsWithUsers += 1
    if (hasOrg) ccsWithOrgs += 1
  }
  summary('Cost-center summary', {
    total_active: ccs.length,
    ccs_with_at_least_one_user: ccsWithUsers,
    ccs_with_at_least_one_org: ccsWithOrgs,
    resource_type_counts: resourceTypeCounts,
    sample_cc: ccs[0],
  })

  // --- Org collisions across ai-credits-budgeted CCs ---
  const ccIdsWithAiCredits = new Set(
    ccBudgets.filter(b => b.budget_product_sku === 'ai_credits').map(b => b.budget_entity_name),
  )
  const orgToCcs = new Map<string, string[]>()
  for (const cc of ccs) {
    if (!ccIdsWithAiCredits.has(cc.id)) continue
    for (const r of cc.resources ?? []) {
      if (r.type !== 'Org') continue
      const key = r.name.toLowerCase()
      if (!orgToCcs.has(key)) orgToCcs.set(key, [])
      orgToCcs.get(key)!.push(cc.name)
    }
  }
  const orgCollisions = [...orgToCcs.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([org, names]) => ({ org, ccs: names }))
  summary('Org-in-multiple-ai-credits-CCs collisions', {
    collision_count: orgCollisions.length,
    samples: orgCollisions.slice(0, 5),
  })

  // --- Dump everything to JSON ---
  const dump = {
    probed_at: new Date().toISOString(),
    enterprise: ent,
    counts: {
      total_budgets: budgets.length,
      enterprise_budgets: entAll.length,
      cost_center_budgets: ccBudgets.length,
      universal_ulb_count: universal.length,
      user_budgets: userBudgets.length,
      active_cost_centers: ccs.length,
    },
    combos: comboTable,
    enterprise_budgets_ai_credits: entBudgets,
    cost_center_budgets: ccBudgets,
    universal_ulb: universal,
    user_budgets_sample: userBudgets.slice(0, 10),
    cost_centers_sample: ccs.slice(0, 10),
    org_collisions_in_budgeted_ccs: orgCollisions,
    resource_type_counts: resourceTypeCounts,
  }
  writeFileSync(outPath, JSON.stringify(dump, null, 2))
  console.error(`\nwrote full dump to ${outPath}`)
}

main().catch(err => {
  console.error('probe failed:', err)
  process.exit(1)
})
