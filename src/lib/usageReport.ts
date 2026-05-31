/**
 * GitHub Enterprise Billing Usage Reports (public preview, X-GitHub-Api-Version: 2026-03-10).
 *
 * Flow:
 *   1. POST /reports with {report_type, start_date, end_date?} → 202 with {id, status: 'processing'}
 *   2. Poll GET /reports/{id} until status === 'completed'; the response then
 *      includes `download_urls[]` (Azure blob SAS links, 1-hour expiry).
 *   3. The browser cannot fetch() the download URL — Azure blob has no CORS.
 *      We open the URL in a new tab (Content-Disposition: attachment → browser
 *      saves the file) and ask the user to upload it back via a file picker.
 *
 * `detailed` reports include per-row `username`, `quantity`, and `gross_amount`,
 * which lets us aggregate per-user AI-credit consumption client-side.
 *
 * Docs: https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage-reports
 */

import type { ApiFetch } from '@/lib/api'

export type ReportType = 'detailed' | 'summarized' | 'premium_request'
export type ReportStatus = 'processing' | 'completed' | 'failed' | string

export interface UsageReport {
  id: string
  report_type: ReportType
  start_date: string
  end_date: string
  status: ReportStatus
  created_at: string
  actor?: string
  download_urls?: string[]
}

interface ReportListResponse {
  reports?: UsageReport[]
}

export async function createReport(
  apiFetch: ApiFetch,
  body: { report_type: ReportType; start_date: string; end_date?: string },
): Promise<UsageReport> {
  return (await apiFetch(`/reports`, {
    method: 'POST',
    body: JSON.stringify(body),
  })) as UsageReport
}

export async function getReport(apiFetch: ApiFetch, reportId: string): Promise<UsageReport> {
  return (await apiFetch(`/reports/${reportId}`)) as UsageReport
}

/**
 * List usage reports, sorted newest-first by created_at. Used to surface the
 * latest report on mount and to enforce the once-per-hour generation guard.
 */
export async function listReports(apiFetch: ApiFetch): Promise<UsageReport[]> {
  const data = (await apiFetch(`/reports`)) as ReportListResponse | UsageReport[]
  const list = Array.isArray(data) ? data : (data?.reports ?? [])
  return [...list].sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
}

// --- CSV parsing ---

export interface UsageRow {
  date: string
  product: string
  sku: string
  quantity: number
  unit_type: string
  applied_cost_per_quantity: number
  gross_amount: number
  discount_amount: number
  net_amount: number
  username: string
  organization: string
  repository: string
  workflow_path: string
  cost_center_name: string
}

/**
 * Minimal CSV reader: strips the UTF-8 BOM, supports `"quoted, with commas"`
 * and `""` escaped quotes, trims trailing CR. Coerces every column listed in
 * NUMERIC_COLUMNS to a Number (NaN → 0).
 */
const NUMERIC_COLUMNS = new Set([
  'quantity',
  'applied_cost_per_quantity',
  'gross_amount',
  'discount_amount',
  'net_amount',
])

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else if (ch === '"') {
      inQuotes = true
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

export function parseUsageCsv(text: string): UsageRow[] {
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = cleaned.split(/\r?\n/).filter(l => l.length > 0)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]).map(h => h.trim())
  const rows: UsageRow[] = []
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i])
    const obj: Record<string, string | number> = {}
    for (let j = 0; j < headers.length; j += 1) {
      const key = headers[j]
      const raw = cells[j] ?? ''
      if (NUMERIC_COLUMNS.has(key)) {
        const n = Number(raw)
        obj[key] = Number.isFinite(n) ? n : 0
      } else {
        obj[key] = raw
      }
    }
    rows.push(obj as unknown as UsageRow)
  }
  return rows
}

/**
 * Aggregated per-user AI-credit consumption derived from a usage report.
 * `aicConsumed` is the sum of `quantity` (in AIC units) across `copilot_ai_credit`
 * and `coding_agent_ai_credit` SKUs — what the universal ULB caps.
 */
export interface UserAicAggregate {
  username: string
  aicConsumed: number
  grossAmount: number
  lastUsedDate: string | null
  /** AIC consumed by the standalone Copilot coding-agent SKU (subset of aicConsumed). */
  codingAgentAic: number
}

const AIC_SKUS = new Set(['copilot_ai_credit', 'coding_agent_ai_credit'])

export function aggregateAicByUser(rows: UsageRow[]): UserAicAggregate[] {
  const acc = new Map<string, UserAicAggregate>()
  for (const r of rows) {
    if (!AIC_SKUS.has(r.sku)) continue
    const user = r.username?.trim()
    if (!user) continue
    const cur = acc.get(user) ?? {
      username: user,
      aicConsumed: 0,
      grossAmount: 0,
      lastUsedDate: null,
      codingAgentAic: 0,
    }
    cur.aicConsumed += r.quantity
    cur.grossAmount += r.gross_amount
    if (r.sku === 'coding_agent_ai_credit') cur.codingAgentAic += r.quantity
    if (!cur.lastUsedDate || r.date > cur.lastUsedDate) cur.lastUsedDate = r.date
    acc.set(user, cur)
  }
  return Array.from(acc.values()).sort((a, b) => b.aicConsumed - a.aicConsumed)
}

// --- Date helpers ---

/** Returns YYYY-MM-DD for the first day of the given Date's month (UTC). */
export function startOfMonthISO(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}-01`
}

/**
 * Returns YYYY-MM-DD for the last day of the given Date's month (UTC),
 * capped at yesterday so the API doesn't reject "end_date cannot be in the future".
 * Billing data isn't available for the current UTC day, so we need to use the day before.
 */
export function endOfMonthISO(d: Date): string {
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  const last = new Date(Date.UTC(y, m + 1, 0))
  const now = new Date()
  // Yesterday in UTC — current day's usage isn't queryable yet.
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
  const capped = last.getTime() > yesterday.getTime() ? yesterday : last
  const yy = capped.getUTCFullYear()
  const mm = String(capped.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(capped.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

/** YYYY-MM key for a Date in UTC, used as the report cache key suffix. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
