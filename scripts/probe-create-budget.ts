/**
 * Live validation for the user-scope budget POST/PATCH/DELETE round-trip.
 *
 * Runs the SHIPPED request bodies (mirrors src/lib/api.ts) against a real
 * enterprise so we know the wire contract we send still works. Hits live
 * billing data: pick a small dollar amount and an unbudgeted seat, and the
 * probe deletes the budget at the end.
 *
 * Usage:
 *   npx tsx scripts/probe-create-budget.ts <env-suffix>
 *     env-suffix is the bit between `.env.` and `.local`, e.g. `octodemo`.
 *     Default: octodemo.
 *
 * Side effects: creates and deletes one user-scope $1 budget on the target
 * enterprise. Also captures one intentional 400 with the old `target_entity`
 * shape so we have a dated artifact of the API rejecting it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')

const API_VERSION = '2026-03-10'

interface Env { enterpriseUrl: string; token: string }

function loadEnv(suffix: string): Env {
  const candidates = [`.env.${suffix}.local`, '.env.local', '.env']
  for (const c of candidates) {
    const p = resolve(REPO_ROOT, c)
    if (!existsSync(p)) continue
    const env: Record<string, string> = {}
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]+)"?\s*$/)
      if (m) env[m[1]] = m[2].trim()
    }
    const url = env.VITE_DEV_ENTERPRISE_URL ?? env.ENTERPRISE_URL
    const token = env.VITE_DEV_PAT ?? env.GH_PAT ?? env.GITHUB_TOKEN
    if (url && token) {
      console.error(`loaded creds from ${c}`)
      return { enterpriseUrl: url, token }
    }
  }
  console.error(`error: no creds found (looked in ${candidates.join(', ')})`)
  process.exit(1)
}

function parseEntUrl(url: string): { base: string; ent: string } {
  const u = new URL(url.trim())
  const m = u.pathname.match(/\/enterprises\/([^/]+)/)
  if (!m) { console.error(`error: cannot parse enterprise from ${url}`); process.exit(1) }
  let host = u.host
  if (host === 'github.com') host = 'api.github.com'
  else if (!host.startsWith('api.')) host = `api.${host}`
  return { base: `${u.protocol}//${host}`, ent: m[1] }
}

interface RawBudget {
  id: string
  budget_scope: string
  budget_product_sku: string
  budget_amount: number
  budget_entity_name?: string
  user?: string
}

interface ApiCallResult {
  status: number
  ok: boolean
  body: unknown
}

async function call(
  base: string,
  ent: string,
  path: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiCallResult> {
  const url = `${base}/enterprises/${ent}/settings/billing${path}`
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': API_VERSION,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let body: unknown = text
  try { body = text ? JSON.parse(text) : null } catch { /* leave as text */ }
  return { status: res.status, ok: res.ok, body }
}

async function fetchAllBudgets(base: string, ent: string, token: string): Promise<RawBudget[]> {
  const all: RawBudget[] = []
  let page = 1
  while (page <= 1500) {
    const r = await call(base, ent, `/budgets?per_page=100&page=${page}`, token)
    if (!r.ok) throw new Error(`GET /budgets page ${page}: ${r.status} ${JSON.stringify(r.body).slice(0, 400)}`)
    const data = r.body as { budgets?: RawBudget[]; total_count?: number } | RawBudget[]
    const list = Array.isArray(data) ? data : (data?.budgets ?? [])
    if (list.length === 0) break
    all.push(...list)
    const total = !Array.isArray(data) ? data?.total_count : undefined
    if (total !== undefined && all.length >= total) break
    page += 1
  }
  return all
}

interface Seat { login: string }

async function fetchOneCopilotSeat(base: string, ent: string, token: string, skip: Set<string>): Promise<string | null> {
  let page = 1
  while (page <= 50) {
    const url = `${base}/enterprises/${ent}/copilot/billing/seats?per_page=100&page=${page}`
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
      },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`GET seats page ${page}: ${res.status} ${text.slice(0, 400)}`)
    }
    const data = await res.json() as { seats?: Array<{ assignee?: Seat | null }>; total_seats?: number }
    const seats = data.seats ?? []
    if (seats.length === 0) return null
    for (const s of seats) {
      const login = s.assignee?.login
      if (login && !skip.has(login.toLowerCase())) return login
    }
    if (data.total_seats !== undefined && page * 100 >= data.total_seats) return null
    page += 1
  }
  return null
}

function bodyForUserBudget(username: string, amount: number) {
  return {
    budget_type: 'BundlePricing',
    budget_product_sku: 'ai_credits',
    budget_scope: 'user',
    budget_amount: amount,
    prevent_further_usage: true,
    budget_entity_name: '',
    budget_alerting: { will_alert: false, alert_recipients: [] },
    user: username,
  }
}

function legacyBodyForUserBudget(username: string, amount: number) {
  return {
    budget_type: 'BundlePricing',
    budget_product_sku: 'ai_credits',
    budget_scope: 'user',
    budget_amount: amount,
    prevent_further_usage: true,
    target_entity: { user: username },
  }
}

async function main() {
  const suffix = process.argv[2] ?? 'octodemo'
  const env = loadEnv(suffix)
  const { base, ent } = parseEntUrl(env.enterpriseUrl)
  console.error(`probing ${ent} via ${base}`)

  console.error('\n[1/6] fetching existing budgets...')
  const budgets = await fetchAllBudgets(base, ent, env.token)
  const userBudgets = budgets.filter(b => b.budget_scope === 'user')
  const skip = new Set(userBudgets.map(b => (b.user ?? b.budget_entity_name ?? '').toLowerCase()).filter(Boolean))
  console.error(`  ${budgets.length} total, ${userBudgets.length} user-scope`)

  console.error('\n[2/6] picking an unbudgeted Copilot seat...')
  const target = await fetchOneCopilotSeat(base, ent, env.token, skip)
  if (!target) { console.error('  no eligible seat found; aborting'); process.exit(1) }
  console.error(`  target: ${target}`)

  console.error('\n[3/6] capturing 400 against the OLD shape (target_entity wrapper)...')
  const legacy = await call(base, ent, '/budgets', env.token, {
    method: 'POST', body: legacyBodyForUserBudget(target, 1),
  })
  console.error(`  status=${legacy.status} body=${JSON.stringify(legacy.body)}`)
  if (legacy.ok) console.error('  WARN: old shape unexpectedly succeeded; cleaning up below')

  console.error('\n[4/6] POST /budgets with the NEW shape...')
  const created = await call(base, ent, '/budgets', env.token, {
    method: 'POST', body: bodyForUserBudget(target, 1),
  })
  console.error(`  status=${created.status} body=${JSON.stringify(created.body)}`)
  if (!created.ok) { console.error('  FAIL'); process.exit(1) }
  const createdBudget = (created.body as { budget?: { id?: string } }).budget
  const newId = createdBudget?.id
  if (!newId) { console.error('  no id returned; aborting'); process.exit(1) }

  // If the legacy POST somehow created something too, find and delete it.
  let strayId: string | undefined
  if (legacy.ok) {
    const legacyBudget = (legacy.body as { budget?: { id?: string } }).budget
    strayId = legacyBudget?.id
  }

  try {
    console.error('\n[5/6] PATCH to $2...')
    const patched = await call(base, ent, `/budgets/${newId}`, env.token, {
      method: 'PATCH',
      body: { budget_amount: 2, prevent_further_usage: true },
    })
    console.error(`  status=${patched.status} body=${JSON.stringify(patched.body)}`)
    if (!patched.ok) throw new Error('PATCH failed')

    const verify = await call(base, ent, `/budgets/${newId}`, env.token)
    console.error(`  re-GET status=${verify.status} body=${JSON.stringify(verify.body)}`)
    const verifiedAmount = (verify.body as { budget_amount?: number }).budget_amount
    if (verifiedAmount !== 2) throw new Error(`expected budget_amount=2, got ${verifiedAmount}`)
    console.error('  PATCH verified ✓')
  } finally {
    console.error('\n[6/6] DELETE cleanup...')
    const del = await call(base, ent, `/budgets/${newId}`, env.token, { method: 'DELETE' })
    console.error(`  status=${del.status}`)
    if (strayId) {
      const del2 = await call(base, ent, `/budgets/${strayId}`, env.token, { method: 'DELETE' })
      console.error(`  legacy stray cleanup status=${del2.status}`)
    }
  }

  console.error('\nALL GREEN ✓')
}

main().catch(err => { console.error('probe failed:', err); process.exit(1) })
