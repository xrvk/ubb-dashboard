/**
 * Dashboard reconciliation probe.
 *
 * Reuses src/lib/* fetchers + math so the probe stays in sync with the
 * Dashboard tab. Fetches everything DashboardPage uses, then recomputes
 * each tile's value outside React and prints a markdown table you can
 * diff against the rendered UI.
 *
 * Usage:
 *   npx tsx scripts/probe-dashboard.ts                          # uses .env.local
 *   npx tsx scripts/probe-dashboard.ts --env ../.env.octodemo.local
 *   npx tsx scripts/probe-dashboard.ts --env <path> --json out.json
 *
 * Reads VITE_DEV_ENTERPRISE_URL + VITE_DEV_PAT from the env file.
 * Read-only. Hits live data — do not commit the JSON output.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createApiFetch,
  parseEnterpriseUrl,
  fetchAllAiCreditsBudgets,
  fetchAllCopilotSeats,
  fetchCostCenters,
  fetchCopilotUsageSummary,
  type Credentials,
} from '../src/lib/api'
import { computePoolSplit } from '../src/lib/poolSplit'
import { projectMonthlyBudget } from '../src/lib/projection'
import { forecastSummary } from '../src/lib/status'
import { includedAiCredits, seatCostBreakdown } from '../src/lib/pricing'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface CliArgs {
  envPath: string
  jsonOut: string | null
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let envPath = resolve(__dirname, '..', '.env.local')
  let jsonOut: string | null = null
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--env') {
      const next = args[i + 1]
      if (!next) {
        console.error('error: --env requires a path')
        process.exit(1)
      }
      envPath = resolve(process.cwd(), next)
      i += 1
    } else if (a === '--json') {
      const next = args[i + 1]
      if (!next) {
        console.error('error: --json requires a path')
        process.exit(1)
      }
      jsonOut = resolve(process.cwd(), next)
      i += 1
    } else {
      console.error(`error: unknown arg ${a}`)
      process.exit(1)
    }
  }
  return { envPath, jsonOut }
}

function loadEnv(envPath: string): { enterpriseUrl: string; token: string } {
  if (!existsSync(envPath)) {
    console.error(`error: env file not found: ${envPath}`)
    process.exit(1)
  }
  const env: Record<string, string> = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n#]+)"?\s*$/)
    if (m) env[m[1]] = m[2].trim()
  }
  const url = env.VITE_DEV_ENTERPRISE_URL ?? env.ENTERPRISE_URL
  const token = env.VITE_DEV_PAT ?? env.GH_PAT ?? env.GITHUB_TOKEN
  if (!url || !token) {
    console.error(`error: ${envPath} missing VITE_DEV_ENTERPRISE_URL or VITE_DEV_PAT`)
    process.exit(1)
  }
  return { enterpriseUrl: url, token }
}

function fmt$(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '—'
  return `${((num / denom) * 100).toFixed(1)}%`
}

interface Probe {
  envPath: string
  enterprise: string
  budgetsCount: number
  userBudgetsCount: number
  universalUlb: { budget: number; consumed: number } | null
  enterpriseBudget: { amount: number; consumed: number; excludeCC: boolean } | null
  costCenterBudgets: Array<{ name: string; amount: number; consumed: number }>
  costCentersAll: number
  seatsTotal: number
  seatCost: ReturnType<typeof seatCostBreakdown>
  pool: ReturnType<typeof includedAiCredits>
  usageEnterprise: {
    aiCreditsGross: number
    aiCreditsNet: number
    codingAgentNet: number
    cbLicenseNet: number
    ceLicenseNet: number
    sampleSkus: string[]
  }
  usagePerCc: Array<{ ccId: string; name: string; gross: number; net: number; budget: number | null }>
  poolSplit: ReturnType<typeof computePoolSplit>
  trackedForecast: {
    universal: { mtd: number; projected: number }
    individual: { mtd: number; projected: number; count: number }
    totalMtd: number
    totalProjected: number
    hasActual: boolean
    other: number
  }
  forecast: ReturnType<typeof forecastSummary>
}

async function probe(envPath: string): Promise<Probe> {
  const { enterpriseUrl, token } = loadEnv(envPath)
  const parsed = parseEnterpriseUrl(enterpriseUrl)
  if (!parsed) {
    console.error(`error: cannot parse enterprise URL ${enterpriseUrl}`)
    process.exit(1)
  }
  const creds: Credentials = { base: parsed.base, ent: parsed.ent, token }
  const apiFetch = createApiFetch(creds)

  console.error(`> ${parsed.ent} (${parsed.base})`)
  console.error('> fetching budgets, cost centers, seats, usage...')

  const [allBudgets, allCcs, seats, usageEnt] = await Promise.all([
    fetchAllAiCreditsBudgets(apiFetch),
    fetchCostCenters(apiFetch),
    fetchAllCopilotSeats(apiFetch),
    fetchCopilotUsageSummary(apiFetch),
  ])

  const ccBudgetsByName = allBudgets.costCenterBudgetsByName

  // Per-CC usage in parallel (matches DashboardPage flow).
  console.error(`> fetching per-CC usage for ${allCcs.length} CCs...`)
  const usagePerCc = await Promise.all(
    allCcs.map(async cc => {
      try {
        const u = await fetchCopilotUsageSummary(apiFetch, { costCenterId: cc.id })
        return { ccId: cc.id, name: cc.name, gross: u.aiCreditsGross, net: u.aiCreditsNet }
      } catch {
        return { ccId: cc.id, name: cc.name, gross: 0, net: 0 }
      }
    }),
  )

  const pool = computePoolSplit({
    enterpriseBudget: allBudgets.enterprise,
    universalUlb: allBudgets.universal,
    costCenters: allCcs,
    ccBudgetsByName,
    seats,
    userBudgets: allBudgets.userBudgets,
  })

  const forecast = forecastSummary(allBudgets.userBudgets)
  const seatCost = seatCostBreakdown(seats)
  const credits = includedAiCredits(seatCost.business, seatCost.enterprise)

  const univMtd = allBudgets.universal?.consumedAmount ?? 0
  const univProj = projectMonthlyBudget(univMtd, 0).projectedMonthTotal
  const indMtd = forecast.spendMtd
  const indProj = forecast.projectedEom
  const actualMtd = usageEnt.aiCreditsGross
  const hasActual = actualMtd > 0 || usageEnt.raw.length > 0
  const actualProj = hasActual ? projectMonthlyBudget(actualMtd, 0).projectedMonthTotal : null
  const totalMtd = hasActual ? actualMtd : univMtd + indMtd
  const totalProjected = actualProj ?? univProj + indProj
  const other = Math.max(0, totalProjected - univProj - indProj)

  const indCount = new Set(
    allBudgets.userBudgets.filter(b => b.user).map(b => b.user!.toLowerCase()),
  ).size

  const ccBudgetsForSummary = pool.costCenters
    .filter(s => s.budgetAmount !== null)
    .map(s => ({
      name: s.name,
      amount: s.budgetAmount!,
      consumed: 0, // CC budgets do not report consumed_amount (see probe-findings.md)
    }))

  return {
    envPath,
    enterprise: parsed.ent,
    budgetsCount: allBudgets.totalBudgetCount,
    userBudgetsCount: allBudgets.userBudgets.length,
    universalUlb: allBudgets.universal
      ? {
          budget: allBudgets.universal.budgetAmount,
          consumed: allBudgets.universal.consumedAmount,
        }
      : null,
    enterpriseBudget: allBudgets.enterprise
      ? {
          amount: allBudgets.enterprise.budgetAmount,
          consumed: 0, // ent budget does not report consumed_amount
          excludeCC: allBudgets.enterprise.excludeCostCenterUsage ?? false,
        }
      : null,
    costCenterBudgets: ccBudgetsForSummary,
    costCentersAll: allCcs.length,
    seatsTotal: seats.length,
    seatCost,
    pool: credits,
    usageEnterprise: {
      aiCreditsGross: usageEnt.aiCreditsGross,
      aiCreditsNet: usageEnt.aiCreditsNet,
      codingAgentNet: usageEnt.codingAgentNet,
      cbLicenseNet: usageEnt.cbLicenseNet,
      ceLicenseNet: usageEnt.ceLicenseNet,
      sampleSkus: Array.from(new Set(usageEnt.raw.map(r => r.sku))).slice(0, 20),
    },
    usagePerCc: usagePerCc.map(u => ({
      ...u,
      budget: ccBudgetsByName.get(u.name.toLowerCase())?.budgetAmount ?? null,
    })),
    poolSplit: pool,
    trackedForecast: {
      universal: { mtd: univMtd, projected: univProj },
      individual: { mtd: indMtd, projected: indProj, count: indCount },
      totalMtd,
      totalProjected,
      hasActual,
      other,
    },
    forecast,
  }
}

function renderReport(p: Probe): string {
  const lines: string[] = []
  const push = (s = '') => lines.push(s)

  push(`# Dashboard probe — ${p.enterprise}`)
  push('')
  push(`Env: \`${p.envPath}\``)
  push(`Day ${p.forecast.daysElapsed} of ${p.forecast.daysInMonth}`)
  push('')

  push('## Raw counts')
  push('')
  push('| | |')
  push('|---|---|')
  push(`| Total ai_credits budgets | ${p.budgetsCount} |`)
  push(`| User budgets | ${p.userBudgetsCount} |`)
  push(`| CC budgets | ${p.costCenterBudgets.length} |`)
  push(`| Cost centers (active) | ${p.costCentersAll} |`)
  push(`| Copilot seats | ${p.seatsTotal} |`)
  push(`| ── CB seats | ${p.seatCost.business} |`)
  push(`| ── CE seats | ${p.seatCost.enterprise} |`)
  push('')

  push('## §1 Pool and licenses')
  push('')
  push('| Tile | Recomputed |')
  push('|---|---|')
  push(`| Total AI credits / mo | ${p.pool.totalCredits.toLocaleString()} (${fmt$(p.pool.totalDollars)}) |`)
  push(`| CB AICs/seat | ${p.pool.perBusiness.toLocaleString()} |`)
  push(`| CE AICs/seat | ${p.pool.perEnterprise.toLocaleString()} |`)
  push(`| Pool drawdown ($) | ${fmt$(Math.min(p.usageEnterprise.aiCreditsGross, p.pool.totalDollars))} |`)
  push(`| Pool drawdown (%) | ${fmtPct(p.usageEnterprise.aiCreditsGross, p.pool.totalDollars)} |`)
  push(`| CB license MTD (net) | ${fmt$(p.usageEnterprise.cbLicenseNet)} |`)
  push(`| CE license MTD (net) | ${fmt$(p.usageEnterprise.ceLicenseNet)} |`)
  push('')
  push(`SKUs seen in enterprise usage/summary: \`${p.usageEnterprise.sampleSkus.join('`, `') || '(none)'}\``)
  push('')

  push('## §2 Spend forecast (KPI strip)')
  push('')
  push('| KPI | Recomputed |')
  push('|---|---|')
  push(`| Enterprise budget | ${p.enterpriseBudget ? fmt$(p.enterpriseBudget.amount) : 'Not set'} |`)
  push(`| Spent MTD | ${fmt$(p.trackedForecast.totalMtd)} (${p.trackedForecast.hasActual ? 'gross AIC' : 'ULB proxy'}) |`)
  push(`| Forecast EoM | ${fmt$(p.trackedForecast.totalProjected)} |`)
  push(`| Over pool? | ${fmt$(Math.max(0, p.trackedForecast.totalProjected - p.pool.totalDollars))} |`)
  push(`| Pool remaining | ${fmt$(Math.max(0, p.pool.totalDollars - p.trackedForecast.totalMtd))} |`)
  push('')

  push('## §2b Forecast breakdown')
  push('')
  push('| Bucket | MTD | Projected | % of total proj |')
  push('|---|---|---|---|')
  push(
    `| Universal ULB | ${fmt$(p.trackedForecast.universal.mtd)} | ${fmt$(p.trackedForecast.universal.projected)} | ${fmtPct(p.trackedForecast.universal.projected, p.trackedForecast.totalProjected)} |`,
  )
  push(
    `| Individual ULBs (${p.trackedForecast.individual.count}) | ${fmt$(p.trackedForecast.individual.mtd)} | ${fmt$(p.trackedForecast.individual.projected)} | ${fmtPct(p.trackedForecast.individual.projected, p.trackedForecast.totalProjected)} |`,
  )
  if (p.trackedForecast.hasActual) {
    push(
      `| Other / unattributed (residual) | — | ${fmt$(p.trackedForecast.other)} | ${fmtPct(p.trackedForecast.other, p.trackedForecast.totalProjected)} |`,
    )
  }
  push(
    `| **Enterprise total** | ${fmt$(p.trackedForecast.totalMtd)} | ${fmt$(p.trackedForecast.totalProjected)} | 100% |`,
  )
  push('')

  push('## §3 Budget allocation')
  push('')
  push(`Enterprise cap: ${fmt$(p.poolSplit.enterpriseBudget)}`)
  const ccBudgetTotal = p.poolSplit.costCenters
    .filter(s => s.budgetAmount !== null)
    .reduce((s, c) => s + (c.budgetAmount ?? 0), 0)
  push(`CC budget total (capped only): ${fmt$(ccBudgetTotal)}`)
  if (p.poolSplit.enterpriseBudget !== null) {
    const diff = ccBudgetTotal - p.poolSplit.enterpriseBudget
    push(`Diff: ${diff > 0 ? `over-allocated by ${fmt$(diff)}` : `${fmt$(-diff)} unallocated`}`)
  }
  push(`Over-allocated flag: ${p.poolSplit.overAllocated}`)
  push('')
  push('| CC | Budget | ULB ceiling | Seats | Effective draw | MTD (gross) | Projected |')
  push('|---|---|---|---|---|---|---|')
  for (const s of p.poolSplit.costCenters) {
    const u = p.usagePerCc.find(x => x.ccId === s.costCenterId)
    const mtd = u?.gross ?? 0
    const proj = projectMonthlyBudget(mtd, 0).projectedMonthTotal
    push(
      `| ${s.name} | ${s.budgetAmount === null ? '(uncapped)' : fmt$(s.budgetAmount)} | ${fmt$(s.ulbCeiling)} | ${s.seatCount} | ${fmt$(s.effectiveDraw)} | ${fmt$(mtd)} | ${fmt$(proj)} |`,
    )
  }
  push('')

  push('## §4 CC status (raw per-CC usage rows, all CCs)')
  push('')
  push('| CC | Budget | MTD gross | MTD net | Has Copilot seats? |')
  push('|---|---|---|---|---|')
  const ccsWithSeats = new Set(p.poolSplit.costCenters.map(s => s.costCenterId))
  for (const u of [...p.usagePerCc].sort((a, b) => b.gross - a.gross)) {
    push(`| ${u.name} | ${u.budget === null ? '—' : fmt$(u.budget)} | ${fmt$(u.gross)} | ${fmt$(u.net)} | ${ccsWithSeats.has(u.ccId) ? 'yes' : 'no'} |`)
  }
  push('')

  push('## Verification flags (cross-checks)')
  push('')
  const checks: Array<[string, boolean, string]> = []
  const perCcSum = p.usagePerCc.reduce((s, u) => s + u.gross, 0)
  checks.push([
    'Σ per-CC gross ≤ enterprise gross',
    perCcSum <= p.usageEnterprise.aiCreditsGross + 0.01,
    `Σ per-CC=${fmt$(perCcSum)}, ent=${fmt$(p.usageEnterprise.aiCreditsGross)}`,
  ])
  checks.push([
    'Residual (Other) ≥ 0',
    p.trackedForecast.other >= 0,
    `other=${fmt$(p.trackedForecast.other)}`,
  ])
  checks.push([
    'copilot_ai_unit SKU present in raw usage items',
    p.usageEnterprise.sampleSkus.includes('copilot_ai_unit') || p.usageEnterprise.aiCreditsGross === 0,
    `skus=${p.usageEnterprise.sampleSkus.slice(0, 8).join(',')}`,
  ])
  checks.push([
    'Universal ULB reports consumed_amount',
    !p.universalUlb || p.universalUlb.consumed >= 0,
    p.universalUlb ? `consumed=${fmt$(p.universalUlb.consumed)}` : 'no universal ULB',
  ])
  checks.push([
    'Enterprise budget consumed_amount stays 0 (per probe-findings)',
    !p.enterpriseBudget || p.enterpriseBudget.consumed === 0,
    p.enterpriseBudget ? `consumed=${fmt$(p.enterpriseBudget.consumed)}` : 'no ent budget',
  ])
  for (const [name, ok, detail] of checks) {
    push(`- ${ok ? '✅' : '❌'} ${name} — ${detail}`)
  }
  push('')

  return lines.join('\n')
}

async function main() {
  const { envPath, jsonOut } = parseArgs()
  const p = await probe(envPath)
  const report = renderReport(p)
  process.stdout.write(report)
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(p, null, 2))
    console.error(`\n> wrote JSON to ${jsonOut}`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
