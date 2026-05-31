import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PencilSimple, Coins, ChartLine, Users } from '@phosphor-icons/react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCredentials } from '@/hooks/use-credentials'
import {
  createUniversalULB,
  createUserBudget as apiCreateUserBudget,
  fetchUniversalULB,
  patchUniversalULB,
} from '@/lib/api'
import { formatCurrency, formatPercent } from '@/lib/utils'
import { loadCachedReport, type CachedReport } from '@/lib/reportCache'
import { monthKey as toMonthKey } from '@/lib/usageReport'
import { runBatch } from '@/lib/batch'
import { EditUniversalUlbDialog } from '@/components/EditUniversalUlbDialog'
import { ReportPanel } from '@/components/ReportPanel'
import { UniversalUlbTable } from '@/components/UniversalUlbTable'

/**
 * Surface for tracking universal-ULB-covered users. Lets admins:
 *  - view & edit the enterprise-wide cap
 *  - ingest a billing usage report to see per-user AI-credit consumption
 *  - bulk-convert users into individual ULBs once a cap is approaching
 */
export function UniversalUlbPage() {
  const {
    credentials,
    apiFetch,
    budgets,
    seats,
    costCenters,
    loginToCostCenter,
    universalUlb,
    setUniversalUlb,
  } = useCredentials()

  const [editing, setEditing] = useState(false)
  // Default to the current month in UTC (matters near month boundaries
  // where local time and UTC can disagree on which month we're in).
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))
  })
  // Bump this when ReportPanel ingests a new file so the cache memo re-reads.
  const [cacheBust, setCacheBust] = useState(0)
  // Cache lookup derived from current ent + month — pure read, no effect needed.
  const cached = useMemo<CachedReport | null>(
    () => (credentials ? loadCachedReport(credentials.ent, toMonthKey(month)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [credentials, month, cacheBust],
  )

  // Bulk-convert dialog state.
  const [bulkConvert, setBulkConvert] = useState<string[] | null>(null)
  const [bulkAmount, setBulkAmount] = useState('100')
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  // Refresh cache whenever enterprise or month changes.

  // Seats not covered by an individual ULB. Universal ULB applies to everyone
  // else — cost-center-assigned users are included per the plan decision.
  const indUlbLogins = useMemo(
    () => new Set(budgets.map(b => b.user.toLowerCase())),
    [budgets],
  )
  const eligibleSeats = useMemo(
    () => seats.filter(s => !indUlbLogins.has(s.login.toLowerCase())),
    [seats, indUlbLogins],
  )

  // Aggregate usage across only the universal-ULB-covered users so the
  // "total consumed" tile matches the table totals (it would otherwise count
  // ind-ULB users too, which is misleading).
  const eligibleLoginSet = useMemo(
    () => new Set(eligibleSeats.map(s => s.login.toLowerCase())),
    [eligibleSeats],
  )
  const filteredUsage = useMemo(
    () => (cached?.rows ?? []).filter(r => eligibleLoginSet.has(r.username.toLowerCase())),
    [cached, eligibleLoginSet],
  )

  const totals = useMemo(() => {
    let aic = 0
    let gross = 0
    for (const r of filteredUsage) {
      aic += r.aicConsumed
      gross += r.grossAmount
    }
    return { aic, gross }
  }, [filteredUsage])

  const cap = universalUlb?.budgetAmount ?? 0

  const handleEditCap = async (newAmount: number) => {
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would set universal ULB to $${newAmount}`)
      return
    }
    if (!apiFetch) return
    if (universalUlb) {
      await patchUniversalULB(apiFetch, universalUlb.id, newAmount)
    } else {
      await createUniversalULB(apiFetch, newAmount)
    }
    const fresh = await fetchUniversalULB(apiFetch)
    setUniversalUlb(fresh)
    toast.success(`Universal ULB set to ${formatCurrency(newAmount)}`)
  }

  const handleBulkConvertSubmit = async () => {
    if (!bulkConvert) return
    const amount = Number(bulkAmount)
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error('Enter a non-negative amount.')
      return
    }
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would create ${bulkConvert.length} individual ULBs at $${amount}`)
      setBulkConvert(null)
      return
    }
    if (!apiFetch) return
    setBulkProgress({ done: 0, total: bulkConvert.length })
    const results = await runBatch(
      bulkConvert.map(login => ({ login })),
      async item => {
        await apiCreateUserBudget(apiFetch, item.login, amount)
      },
      {
        concurrency: 5,
        perTaskDelayMs: 50,
        maxRetriesOn429: 2,
        defaultRetryAfterMs: 60_000,
        onProgress: p => setBulkProgress({ done: p.completed, total: p.total }),
      },
    )
    const failed = results.filter(r => !r.ok).length
    const ok = results.length - failed
    if (failed === 0) toast.success(`Created ${ok.toLocaleString()} individual ULBs.`)
    else if (ok === 0) toast.error(`Failed to create ${failed.toLocaleString()} ULBs.`)
    else toast.warning(`Created ${ok.toLocaleString()}, failed ${failed.toLocaleString()}.`)
    setBulkConvert(null)
    setBulkProgress(null)
  }

  const aggregatePctOfCap = cap > 0 ? totals.gross / cap : 0

  return (
    <div className="grid gap-6">
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Universal ULB cap</div>
              <div className="text-2xl font-semibold mt-1">
                {universalUlb ? formatCurrency(cap) : <span className="text-neutral-400">not set</span>}
              </div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setEditing(true)}>
                <PencilSimple size={14} weight="duotone" />
                {universalUlb ? 'Edit cap' : 'Set cap'}
              </Button>
            </div>
            <Coins size={22} weight="duotone" className="text-neutral-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Consumed (from report)</div>
              <div className="text-2xl font-semibold mt-1">{formatCurrency(totals.gross)}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {totals.aic.toFixed(2)} AI credits
                {cap > 0 ? ` · ${formatPercent(aggregatePctOfCap)} of cap` : ''}
              </div>
            </div>
            <ChartLine size={22} weight="duotone" className="text-neutral-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Covered users</div>
              <div className="text-2xl font-semibold mt-1">{eligibleSeats.length.toLocaleString()}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {filteredUsage.length.toLocaleString()} with report data
              </div>
            </div>
            <Users size={22} weight="duotone" className="text-neutral-400" />
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-neutral-500">Billing month</label>
        <input
          type="month"
          value={`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`}
          onChange={e => {
            const [y, m] = e.target.value.split('-').map(Number)
            if (!Number.isFinite(y) || !Number.isFinite(m)) return
            setMonth(new Date(Date.UTC(y, m - 1, 1)))
          }}
          className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs"
        />
      </div>

      <ReportPanel month={month} cached={cached} onIngested={() => setCacheBust(n => n + 1)} />

      <UniversalUlbTable
        seats={eligibleSeats}
        usage={filteredUsage}
        cap={cap}
        costCenters={costCenters}
        loginToCostCenter={loginToCostCenter}
        onBulkConvert={logins => {
          setBulkConvert(logins)
          setBulkAmount('100')
        }}
        onCreateOne={login => setBulkConvert([login])}
      />

      <EditUniversalUlbDialog
        universalUlb={universalUlb}
        open={editing}
        onOpenChange={setEditing}
        onSubmit={handleEditCap}
      />

      {/* Inline bulk-convert dialog — light, since the only input is one number. */}
      {bulkConvert ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            if (!bulkProgress) setBulkConvert(null)
          }}
        >
          <div
            className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800 max-w-md w-full p-5 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold">Convert to individual ULB</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-400 mt-1">
              Create a new individual ULB for{' '}
              <strong>{bulkConvert.length.toLocaleString()}</strong>{' '}
              user{bulkConvert.length === 1 ? '' : 's'} at the cap below.
            </p>
            <label className="grid gap-1 mt-3 text-sm">
              <span className="text-neutral-600 dark:text-neutral-400">Cap per user (USD)</span>
              <Input
                type="number"
                min={0}
                step="1"
                value={bulkAmount}
                onChange={e => setBulkAmount(e.target.value)}
                disabled={bulkProgress !== null}
                autoFocus
              />
            </label>
            {bulkProgress ? (
              <div className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
                {bulkProgress.done.toLocaleString()} of {bulkProgress.total.toLocaleString()} done…
              </div>
            ) : null}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="ghost" onClick={() => setBulkConvert(null)} disabled={bulkProgress !== null}>
                Cancel
              </Button>
              <Button onClick={handleBulkConvertSubmit} disabled={bulkProgress !== null}>
                {bulkProgress ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
