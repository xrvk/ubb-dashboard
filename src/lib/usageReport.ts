/**
 * GitHub Enterprise Billing Usage Reports — CSV parsing.
 *
 * The async report-generation API (POST /reports + polling) was removed in
 * favor of a pure CSV-upload flow: admins download a detailed billing report
 * from GitHub themselves and feed it into UsageCsvImport.
 *
 * Docs: https://docs.github.com/en/enterprise-cloud@latest/billing/tutorials/automate-usage-reporting
 */

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
  /** Present only in the Premium Request Usage Report export. */
  aic_quantity?: number
  /** Present only in the Premium Request Usage Report export. */
  aic_gross_amount?: number
  /** Present only in the Premium Request Usage Report export. */
  model?: string
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
  'aic_quantity',
  'aic_gross_amount',
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
const PREMIUM_REQUEST_SKUS = new Set(['copilot_premium_request'])

/**
 * Aggregate AIC consumption per user from either:
 *  - the **Billing Usage Report** (one row per AIC SKU, AIC value in `quantity`), or
 *  - the **Premium Request Usage Report** (one row per request, AIC value in
 *    `aic_quantity` and USD in `aic_gross_amount`).
 *
 * Both formats are common GitHub Copilot CSV exports — pick whichever the
 * admin can pull. Coding-agent attribution is only available in the billing
 * format (no equivalent SKU surfaces in the premium-request export).
 */
export function aggregateAicByUser(rows: UsageRow[]): UserAicAggregate[] {
  const acc = new Map<string, UserAicAggregate>()
  for (const r of rows) {
    const isBillingAic = AIC_SKUS.has(r.sku)
    const isPremiumRequest = PREMIUM_REQUEST_SKUS.has(r.sku)
    if (!isBillingAic && !isPremiumRequest) continue

    const aicQty = isBillingAic ? r.quantity : (r.aic_quantity ?? 0)
    const aicGross = isBillingAic ? r.gross_amount : (r.aic_gross_amount ?? 0)
    if (aicQty === 0 && aicGross === 0) continue

    const user = r.username?.trim()
    if (!user) continue
    const cur = acc.get(user) ?? {
      username: user,
      aicConsumed: 0,
      grossAmount: 0,
      lastUsedDate: null,
      codingAgentAic: 0,
    }
    cur.aicConsumed += aicQty
    cur.grossAmount += aicGross
    if (r.sku === 'coding_agent_ai_credit') cur.codingAgentAic += aicQty
    if (!cur.lastUsedDate || r.date > cur.lastUsedDate) cur.lastUsedDate = r.date
    acc.set(user, cur)
  }
  return Array.from(acc.values()).sort((a, b) => b.aicConsumed - a.aicConsumed)
}
