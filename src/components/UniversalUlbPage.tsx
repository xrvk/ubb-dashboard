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
import { formatCurrency } from '@/lib/utils'
import {
  loadAllCachedReports,
  aggregateMaxMonth,
  type CachedReport,
} from '@/lib/reportCache'
import { runBatch } from '@/lib/batch'
import {
  calcThreshold,
  toCsvUserUsage,
  type ThresholdMode,
} from '@/lib/consumptionAnalysis'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog'
import { EditUniversalUlbDialog } from '@/components/EditUniversalUlbDialog'
import { UsageCsvImport } from '@/components/UsageCsvImport'
import { ConsumptionCurve } from '@/components/ConsumptionCurve'

// 100 AICs = $1.00 in GitHub billing (1 AIC = $0.01).
const AICS_PER_USD = 100
const OUTLIER_BUFFER_PCT = 0.1

const MODE_LABELS: Record<ThresholdMode, string> = {
  'top-10': 'Top 10%',
  'top-20': 'Top 20%',
  'top-30': 'Top 30%',
  custom: 'Custom',
}

/**
 * Universal-ULB planner.
 *
 * Three-step workflow:
 *   1. Ingest one or more monthly usage-report CSVs (UsageCsvImport).
 *   2. Drag the ConsumptionCurve threshold + ULB lines to pick a cap and
 *      classify outliers ("power users") that need individual ULBs.
 *   3. Apply the chosen universal ULB and optionally batch-create per-outlier
 *      individual ULBs (suggested at user.maxAICs × 1.10).
 */
export function UniversalUlbPage() {
  const {
    credentials,
    apiFetch,
    budgets,
    seats,
    universalUlb,
    setUniversalUlb,
    loginToCostCenter,
  } = useCredentials()

  const [editing, setEditing] = useState(false)
  const [cacheBust, setCacheBust] = useState(0)
  const [thresholdMode, setThresholdMode] = useState<ThresholdMode>('top-20')
  // Overrides are tagged with a session signature derived from the current
  // dataset; when the dataset changes (new CSV ingested, ent switched) the
  // tag no longer matches and the override naturally falls away. Lets us
  // reset overrides without a setState-in-effect.
  const [customThresholdEntry, setCustomThresholdEntry] = useState<{ sig: string; value: number } | null>(null)
  const [ulbOverrideEntry, setUlbOverrideEntry] = useState<{ sig: string; value: number } | null>(null)
  /** Logins the admin explicitly UNCHECKED. All outliers are selected by default. */
  const [deselectedOutliers, setDeselectedOutliers] = useState<Set<string>>(new Set())
  /** Per-outlier ULB override in dollars. Logins in this map are treated as
   * "manually configured" — they're excluded from the select-all toggle and
   * their value is used directly instead of the suggested formula. */
  const [editedOutlierUlbsEntry, setEditedOutlierUlbsEntry] = useState<
    { sig: string; map: Record<string, number> } | null
  >(null)
  const [applying, setApplying] = useState(false)
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null)
  const [outlierPage, setOutlierPage] = useState(0)
  const [confirmCreateOpen, setConfirmCreateOpen] = useState(false)
  /** Cost-center filter for the outliers table.
   *  null = all, '' = unassigned (no CC), otherwise CC id. */
  const [costCenterFilter, setCostCenterFilter] = useState<string | null>(null)
  const OUTLIERS_PER_PAGE = 25

  // Reload cached months whenever import changes them.
  const cachedMonths = useMemo<CachedReport[]>(
    () => (credentials ? loadAllCachedReports(credentials.ent) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [credentials, cacheBust],
  )

  // Users already covered by an individual ULB are excluded from sizing —
  // we're sizing the cap for users who fall under the universal ULB.
  const indUlbLogins = useMemo(
    () => new Set(budgets.map(b => b.user.toLowerCase())),
    [budgets],
  )

  // Per-user max-month AICs across all ingested months. Drives the curve.
  const csvUsers = useMemo(() => {
    if (cachedMonths.length === 0) return []
    const merged = aggregateMaxMonth(cachedMonths.map(c => c.rows))
    return merged
      .filter(u => !indUlbLogins.has(u.username.toLowerCase()))
      .map(toCsvUserUsage)
  }, [cachedMonths, indUlbLogins])

  // Dataset signature — invalidates overrides when the input data changes.
  const datasetSig = `${credentials?.ent ?? ''}:${csvUsers.length}`
  const customPct =
    customThresholdEntry?.sig === datasetSig ? customThresholdEntry.value : null
  const ulbOverrideAICs =
    ulbOverrideEntry?.sig === datasetSig ? ulbOverrideEntry.value : null
  const editedOutlierUlbs = useMemo(
    () =>
      editedOutlierUlbsEntry?.sig === datasetSig
        ? editedOutlierUlbsEntry.map
        : ({} as Record<string, number>),
    [editedOutlierUlbsEntry, datasetSig],
  )
  const editedOutlierLogins = useMemo(
    () => new Set(Object.keys(editedOutlierUlbs)),
    [editedOutlierUlbs],
  )

  const setEditedOutlierUlb = (login: string, amount: number | null) => {
    setEditedOutlierUlbsEntry(prev => {
      const base = prev?.sig === datasetSig ? { ...prev.map } : {}
      if (amount === null) delete base[login]
      else base[login] = amount
      return Object.keys(base).length > 0 ? { sig: datasetSig, map: base } : null
    })
  }

  // Apply threshold mode → power user split.
  const threshold = useMemo(
    () => calcThreshold(csvUsers, thresholdMode, customPct ?? undefined),
    [csvUsers, thresholdMode, customPct],
  )

  // ULB to display on the chart, in AICs.
  // Priority: explicit drag override → suggested P95 from the current threshold.
  // The currently saved universal ULB is shown separately in the header tile;
  // we deliberately don't anchor the chart line to it so clicking to move the
  // threshold always re-snaps the line to the fresh P95.
  const ulbAICs = ulbOverrideAICs !== null ? ulbOverrideAICs : threshold.suggestedULB
  const ulbIsOverridden = ulbOverrideAICs !== null

  // Coverage: how many regular users fit under the chosen ULB?
  const coverage = useMemo(() => {
    if (threshold.regularUsers.length === 0) return { covered: 0, total: 0, pct: 0 }
    const covered = threshold.regularUsers.filter(u => u.totalAICs <= ulbAICs).length
    return {
      covered,
      total: threshold.regularUsers.length,
      pct: covered / threshold.regularUsers.length,
    }
  }, [threshold.regularUsers, ulbAICs])

  // Eligible seats = seats not currently on an individual ULB.
  const eligibleSeatCount = useMemo(
    () => seats.filter(s => !indUlbLogins.has(s.login.toLowerCase())).length,
    [seats, indUlbLogins],
  )

  // Default-selected outliers, derived: every power user except those the
  // admin explicitly unchecked.
  const selectedOutliers = useMemo(
    () => new Set(threshold.powerUsers.map(u => u.login).filter(l => !deselectedOutliers.has(l))),
    [threshold.powerUsers, deselectedOutliers],
  )

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

  /** Convert the chart's ULB (AICs) → USD and write to the enterprise. */
  const handleApplyUniversalULB = async () => {
    const newUsd = Math.max(1, Math.ceil(ulbAICs / AICS_PER_USD))
    setApplying(true)
    try {
      await handleEditCap(newUsd)
      setUlbOverrideEntry(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setApplying(false)
    }
  }

  /** Create individual ULBs for selected outliers at ceil(maxAICs/100 × 1.10),
   * or at the admin's edited amount if they've customized the row. */
  const handleCreateOutlierUlbs = async () => {
    if (!apiFetch) return
    const targets = outlierTargets
    if (targets.length === 0) {
      toast.error('Select at least one outlier.')
      return
    }
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would create ${targets.length} individual ULBs.`)
      return
    }
    setBatchProgress({ done: 0, total: targets.length })
    try {
      const results = await runBatch(
        targets,
        async item => {
          await apiCreateUserBudget(apiFetch, item.login, item.amount)
        },
        {
          concurrency: 5,
          perTaskDelayMs: 50,
          maxRetriesOn429: 2,
          defaultRetryAfterMs: 60_000,
          onProgress: p => setBatchProgress({ done: p.completed, total: p.total }),
        },
      )
      const failed = results.filter(r => !r.ok).length
      const ok = results.length - failed
      if (failed === 0) toast.success(`Created ${ok.toLocaleString()} individual ULBs.`)
      else if (ok === 0) toast.error(`Failed to create ${failed.toLocaleString()} ULBs.`)
      else toast.warning(`Created ${ok.toLocaleString()}, failed ${failed.toLocaleString()}.`)
    } finally {
      setBatchProgress(null)
    }
  }

  // Resolved create-targets (selected outliers + their final $ amounts).
  // Computed every render so the confirm dialog and the create call share
  // the exact same numbers shown to the user. (React Compiler memoizes.)
  const outlierTargets = threshold.powerUsers
    .filter(u => selectedOutliers.has(u.login))
    .map(u => {
      const suggested = Math.max(
        1,
        Math.ceil((u.totalAICs / AICS_PER_USD) * (1 + OUTLIER_BUFFER_PCT)),
      )
      const edited = editedOutlierUlbs[u.login]
      return {
        login: u.login,
        amount: edited ?? suggested,
        isEdited: edited !== undefined,
      }
    })

  const outlierTotalDollars = outlierTargets.reduce((sum, t) => sum + t.amount, 0)
  const editedTargetCount = outlierTargets.filter(t => t.isEdited).length

  const toggleOutlier = (login: string) => {
    setDeselectedOutliers(prev => {
      const next = new Set(prev)
      // Selected → moving to deselected, and vice-versa.
      if (selectedOutliers.has(login)) next.add(login)
      else next.delete(login)
      return next
    })
  }

  // CC resolution helpers. `loginToCostCenter` is keyed by lowercased login.
  const getCC = (login: string) => loginToCostCenter.get(login.toLowerCase()) ?? null

  // Cost centers that any outlier resolves to (used to populate the filter
  // dropdown). Deduped by id, alphabetized by name.
  const outlierCostCenters = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>()
    for (const u of threshold.powerUsers) {
      const res = getCC(u.login)
      if (res) byId.set(res.cc.id, { id: res.cc.id, name: res.cc.name })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold.powerUsers, loginToCostCenter])

  const hasAnyOutlierUnassigned = useMemo(
    () => threshold.powerUsers.some(u => !getCC(u.login)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threshold.powerUsers, loginToCostCenter],
  )

  // Rows actually shown after applying the cost-center filter.
  const filteredPowerUsers = useMemo(() => {
    if (costCenterFilter === null) return threshold.powerUsers
    return threshold.powerUsers.filter(u => {
      const res = getCC(u.login)
      if (costCenterFilter === '') return !res
      return res?.cc.id === costCenterFilter
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threshold.powerUsers, costCenterFilter, loginToCostCenter])

  // Edited rows are treated as already configured — they're not toggled by
  // "select all" and don't affect the all/none counter. Select-all also
  // respects the current cost-center filter (only toggles visible rows).
  const unmodifiedPowerUsers = useMemo(
    () => filteredPowerUsers.filter(u => !editedOutlierLogins.has(u.login)),
    [filteredPowerUsers, editedOutlierLogins],
  )
  const allSelected =
    unmodifiedPowerUsers.length > 0 &&
    unmodifiedPowerUsers.every(u => selectedOutliers.has(u.login))
  const toggleAll = () => {
    if (allSelected) {
      // Deselect all unmodified; leave edited rows' state untouched.
      setDeselectedOutliers(prev => {
        const next = new Set(prev)
        for (const u of unmodifiedPowerUsers) next.add(u.login)
        return next
      })
    } else {
      // Select all unmodified; leave edited rows' state untouched.
      setDeselectedOutliers(prev => {
        const next = new Set(prev)
        for (const u of unmodifiedPowerUsers) next.delete(u.login)
        return next
      })
    }
  }

  const hasData = csvUsers.length > 0
  const ulbDeltaUsd = Math.ceil(ulbAICs / AICS_PER_USD)

  return (
    <div className="grid gap-6">
      {/* Header tiles */}
      <div className="grid gap-3 grid-cols-1 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Universal ULB cap</div>
              <div className="text-2xl font-semibold mt-1">
                {universalUlb ? formatCurrency(universalUlb.budgetAmount) : (
                  <span className="text-neutral-400">not set</span>
                )}
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
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Months ingested</div>
              <div className="text-2xl font-semibold mt-1">{cachedMonths.length.toLocaleString()}</div>
              <div className="text-xs text-neutral-500 mt-1">
                {csvUsers.length.toLocaleString()} eligible users sized
              </div>
            </div>
            <ChartLine size={22} weight="duotone" className="text-neutral-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">Universal-ULB coverage</div>
              <div className="text-2xl font-semibold mt-1">{eligibleSeatCount.toLocaleString()}</div>
              <div className="text-xs text-neutral-500 mt-1">
                seats not on an individual ULB
              </div>
            </div>
            <Users size={22} weight="duotone" className="text-neutral-400" />
          </CardContent>
        </Card>
      </div>

      {/* Step 1: import */}
      <Card>
        <CardContent className="grid gap-3">
          <div>
            <h2 className="text-sm font-semibold">Step 1 · Upload historical usage</h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
              Download the detailed billing usage report from GitHub for one or more recent months,
              then upload the CSV(s) below. Sizing uses each user's biggest single month across
              everything you load.
            </p>
          </div>
          {credentials ? (
            <UsageCsvImport
              enterprise={credentials.ent}
              months={cachedMonths}
              onChanged={() => setCacheBust(n => n + 1)}
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Step 2: pick threshold + ULB */}
      <Card>
        <CardContent className="grid gap-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Step 2 · Choose your universal ULB</h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Drag the threshold line to split regular users from outliers, then drag the dashed
                ULB line to set the cap. Outliers get individual ULBs in step 3.
              </p>
            </div>
            {hasData ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {(['top-10', 'top-20', 'top-30', 'custom'] as ThresholdMode[]).map(mode => (
                  <Button
                    key={mode}
                    size="sm"
                    variant={thresholdMode === mode ? 'primary' : 'outline'}
                    onClick={() => {
                      setThresholdMode(mode)
                      if (mode !== 'custom') setCustomThresholdEntry(null)
                      // Snap ULB back to P95 for the new regular cohort.
                      setUlbOverrideEntry(null)
                    }}
                  >
                    {MODE_LABELS[mode]}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>

          <ConsumptionCurve
            sortedUsers={[...csvUsers].sort((a, b) => b.totalAICs - a.totalAICs)}
            thresholdAICs={threshold.thresholdAICs}
            powerUserCount={threshold.powerUsers.length}
            ulbAICs={ulbAICs}
            ulbIsOverridden={ulbIsOverridden}
            onUlbChange={
              hasData
                ? aics =>
                    setUlbOverrideEntry(
                      aics === null ? null : { sig: datasetSig, value: aics },
                    )
                : undefined
            }
            onSetCutoff={
              hasData
                ? aics => {
                    // Convert clicked AIC value to top-N% rank.
                    const sorted = [...csvUsers]
                      .map(u => u.totalAICs)
                      .sort((a, b) => b - a)
                    const rank = sorted.findIndex(v => v < aics)
                    const count = rank === -1 ? sorted.length : Math.max(1, rank)
                    const pct = Math.max(
                      1,
                      Math.min(100, Math.round((count / sorted.length) * 100)),
                    )
                    setThresholdMode('custom')
                    setCustomThresholdEntry({ sig: datasetSig, value: pct })
                    // Snap ULB back to the recomputed P95 of regulars by
                    // clearing any manual y override.
                    setUlbOverrideEntry(null)
                  }
                : undefined
            }
          />

          {hasData ? (
            <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-xs grid gap-1.5 sm:grid-cols-3">
              <div>
                <div className="text-neutral-500 dark:text-neutral-400">Suggested ULB (P95 of regulars)</div>
                <div className="font-semibold text-sm">
                  ${Math.ceil(threshold.suggestedULB / AICS_PER_USD).toLocaleString()}
                  <span className="text-neutral-500 font-normal"> · ~{threshold.suggestedULB.toLocaleString()} AICs</span>
                </div>
              </div>
              <div>
                <div className="text-neutral-500 dark:text-neutral-400">Chart ULB</div>
                <div className="font-semibold text-sm">
                  ${ulbDeltaUsd.toLocaleString()}
                  <span className="text-neutral-500 font-normal"> · ~{Math.round(ulbAICs).toLocaleString()} AICs</span>
                </div>
              </div>
              <div>
                <div className="text-neutral-500 dark:text-neutral-400">Coverage of regulars</div>
                <div className="font-semibold text-sm">
                  {coverage.covered.toLocaleString()} / {coverage.total.toLocaleString()}
                  <span className="text-neutral-500 font-normal"> · {Math.round(coverage.pct * 100)}%</span>
                </div>
              </div>
            </div>
          ) : null}

          {thresholdMode === 'custom' && hasData ? (
            <div className="flex items-center gap-2 text-xs">
              <label className="text-neutral-600 dark:text-neutral-400">Top</label>
              <Input
                type="number"
                min={1}
                max={100}
                step="1"
                value={customPct ?? ''}
                onChange={e => {
                  const n = Number(e.target.value)
                  setCustomThresholdEntry(
                    Number.isFinite(n)
                      ? { sig: datasetSig, value: Math.max(1, Math.min(100, Math.round(n))) }
                      : null,
                  )
                }}
                className="h-7 w-20"
              />
              <span className="text-neutral-600 dark:text-neutral-400">% are outliers</span>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              onClick={handleApplyUniversalULB}
              disabled={!hasData || applying || ulbAICs <= 0}
              title={!hasData ? 'Upload a CSV first' : undefined}
            >
              {applying ? 'Applying…' : `Apply universal ULB ($${ulbDeltaUsd})`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Step 3: outliers */}
      <Card>
        <CardContent className="grid gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                Step 3 · Outliers ({threshold.powerUsers.length.toLocaleString()})
              </h2>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                Suggested individual ULB = max-month AICs ÷ 100 × 1.10 (10% buffer).
              </p>
            </div>
            {threshold.powerUsers.length > 0 && (
              <Button
                onClick={() => setConfirmCreateOpen(true)}
                disabled={selectedOutliers.size === 0 || batchProgress !== null}
              >
                {batchProgress ? 'Creating…' : `Checkout (${selectedOutliers.size.toLocaleString()})`}
              </Button>
            )}
          </div>

          {threshold.powerUsers.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 dark:border-neutral-700 p-4 text-center text-xs text-neutral-500">
              {hasData ? 'No outliers at the current threshold.' : 'Upload a CSV to identify outliers.'}
            </div>
          ) : (
            (() => {
              const totalPages = Math.max(1, Math.ceil(filteredPowerUsers.length / OUTLIERS_PER_PAGE))
              const safePage = Math.min(outlierPage, totalPages - 1)
              const pageStart = safePage * OUTLIERS_PER_PAGE
              const pageRows = filteredPowerUsers.slice(pageStart, pageStart + OUTLIERS_PER_PAGE)
              return (
                <>
                  {(outlierCostCenters.length > 0 || hasAnyOutlierUnassigned) && (
                    <div className="flex items-center gap-2 text-xs">
                      <label className="text-neutral-600 dark:text-neutral-400" htmlFor="cc-filter">
                        Cost center:
                      </label>
                      <select
                        id="cc-filter"
                        value={costCenterFilter === null ? '__all__' : costCenterFilter === '' ? '__unassigned__' : costCenterFilter}
                        onChange={e => {
                          const v = e.target.value
                          setCostCenterFilter(v === '__all__' ? null : v === '__unassigned__' ? '' : v)
                          setOutlierPage(0)
                        }}
                        className="h-7 rounded border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2"
                      >
                        <option value="__all__">All ({threshold.powerUsers.length.toLocaleString()})</option>
                        {hasAnyOutlierUnassigned && (
                          <option value="__unassigned__">
                            Unassigned ({threshold.powerUsers.filter(u => !getCC(u.login)).length.toLocaleString()})
                          </option>
                        )}
                        {outlierCostCenters.map(cc => {
                          const count = threshold.powerUsers.filter(u => getCC(u.login)?.cc.id === cc.id).length
                          return (
                            <option key={cc.id} value={cc.id}>
                              {cc.name} ({count.toLocaleString()})
                            </option>
                          )
                        })}
                      </select>
                      {costCenterFilter !== null && (
                        <button
                          type="button"
                          onClick={() => { setCostCenterFilter(null); setOutlierPage(0) }}
                          className="text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline"
                        >
                          clear
                        </button>
                      )}
                      <div className="ml-auto text-neutral-500">
                        Showing {filteredPowerUsers.length.toLocaleString()} of {threshold.powerUsers.length.toLocaleString()}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all unedited outliers"
                      />
                      <span className="text-neutral-700 dark:text-neutral-300">
                        Select all ({unmodifiedPowerUsers.length.toLocaleString()})
                      </span>
                      {editedOutlierLogins.size > 0 && (
                        <span className="text-neutral-500 dark:text-neutral-400">
                          · {editedOutlierLogins.size.toLocaleString()} edited (skipped)
                        </span>
                      )}
                    </label>
                    <div className="text-neutral-500">
                      {selectedOutliers.size.toLocaleString()} selected
                      {batchProgress
                        ? ` · ${batchProgress.done.toLocaleString()} / ${batchProgress.total.toLocaleString()} done…`
                        : ''}
                    </div>
                  </div>

                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left">
                        <tr>
                          <th className="px-3 py-2 w-8" aria-label="Select" />
                          <th className="px-3 py-2 font-medium">User</th>
                          <th className="px-3 py-2 font-medium">Cost center</th>
                          <th className="px-3 py-2 text-right font-medium">Max-month AICs</th>
                          <th className="px-3 py-2 text-right font-medium">Gross $</th>
                          <th className="px-3 py-2 text-right font-medium">Suggested ULB</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.map(u => {
                          const suggested = Math.max(
                            1,
                            Math.ceil((u.totalAICs / AICS_PER_USD) * (1 + OUTLIER_BUFFER_PCT)),
                          )
                          const isEdited = editedOutlierLogins.has(u.login)
                          const value = isEdited ? editedOutlierUlbs[u.login] : suggested
                          return (
                            <tr
                              key={u.login}
                              className="border-t border-neutral-100 dark:border-neutral-800/50"
                            >
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={selectedOutliers.has(u.login)}
                                  onChange={() => toggleOutlier(u.login)}
                                  aria-label={`Select ${u.login}`}
                                />
                              </td>
                              <td className="px-3 py-2 font-medium">{u.login}</td>
                              <td className="px-3 py-2 text-xs">
                                {(() => {
                                  const res = getCC(u.login)
                                  if (!res) return <span className="text-neutral-400">—</span>
                                  return (
                                    <span title={`via ${res.via}`}>
                                      {res.cc.name}
                                      {res.via === 'org' && (
                                        <span className="ml-1 text-neutral-400">(org)</span>
                                      )}
                                    </span>
                                  )
                                })()}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {Math.round(u.totalAICs).toLocaleString()}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                {formatCurrency(u.grossAmount)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums">
                                <div className="inline-flex items-center justify-end gap-1">
                                  <span className="text-neutral-400">$</span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={value}
                                    onChange={e => {
                                      const raw = e.target.value
                                      if (raw === '') {
                                        setEditedOutlierUlb(u.login, null)
                                        return
                                      }
                                      const n = Math.max(1, Math.round(Number(raw)))
                                      if (!Number.isFinite(n)) return
                                      if (n === suggested) setEditedOutlierUlb(u.login, null)
                                      else setEditedOutlierUlb(u.login, n)
                                    }}
                                    aria-label={`ULB for ${u.login}`}
                                    className={`w-24 h-7 rounded border px-1.5 text-right tabular-nums bg-white dark:bg-neutral-900 ${
                                      isEdited
                                        ? 'border-amber-500 dark:border-amber-400 font-semibold'
                                        : 'border-neutral-300 dark:border-neutral-700'
                                    }`}
                                  />
                                  {isEdited ? (
                                    <button
                                      type="button"
                                      onClick={() => setEditedOutlierUlb(u.login, null)}
                                      title={`Reset to suggested ($${suggested})`}
                                      className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 text-xs px-1"
                                    >
                                      ↺
                                    </button>
                                  ) : (
                                    <span className="w-4" />
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <div className="text-neutral-500">
                        Showing {(pageStart + 1).toLocaleString()}–
                        {Math.min(pageStart + OUTLIERS_PER_PAGE, threshold.powerUsers.length).toLocaleString()}
                        {' '}of {threshold.powerUsers.length.toLocaleString()}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setOutlierPage(p => Math.max(0, p - 1))}
                          disabled={safePage === 0}
                          className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 disabled:opacity-40 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          ‹ Prev
                        </button>
                        <span className="px-2 text-neutral-600 dark:text-neutral-400 tabular-nums">
                          Page {safePage + 1} / {totalPages}
                        </span>
                        <button
                          type="button"
                          onClick={() => setOutlierPage(p => Math.min(totalPages - 1, p + 1))}
                          disabled={safePage >= totalPages - 1}
                          className="px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 disabled:opacity-40 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Next ›
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )
            })()
          )}
        </CardContent>
      </Card>

      <EditUniversalUlbDialog
        universalUlb={universalUlb}
        open={editing}
        onOpenChange={setEditing}
        onSubmit={handleEditCap}
      />

      <Dialog open={confirmCreateOpen} onOpenChange={setConfirmCreateOpen}>
        <DialogContent>
          <DialogTitle>Create {outlierTargets.length.toLocaleString()} individual ULB{outlierTargets.length === 1 ? '' : 's'}?</DialogTitle>
          <DialogDescription>
            This will create or update an individual ULB for each selected user.
            Existing ULBs for these users would be overwritten.
          </DialogDescription>

          <div className="rounded-md border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 mb-3">
            Heads up: this total only reflects individual ULBs. It does not account
            for other budgets (enterprise or cost centers) that may also apply to
            these users.
          </div>

          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-xs grid gap-1.5 sm:grid-cols-2 mb-3">
            <div>
              <div className="text-neutral-500 dark:text-neutral-400">Total monthly cap</div>
              <div className="font-semibold text-sm">
                ${outlierTotalDollars.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-neutral-500 dark:text-neutral-400">Users</div>
              <div className="font-semibold text-sm">
                {outlierTargets.length.toLocaleString()}
                {editedTargetCount > 0 && (
                  <span className="text-neutral-500 font-normal">
                    {' '}· {editedTargetCount.toLocaleString()} edited
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 max-h-56 overflow-y-auto text-xs">
            <table className="w-full">
              <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left sticky top-0">
                <tr>
                  <th className="px-3 py-1.5 font-medium">User</th>
                  <th className="px-3 py-1.5 text-right font-medium">ULB</th>
                </tr>
              </thead>
              <tbody>
                {outlierTargets.map(t => (
                  <tr key={t.login} className="border-t border-neutral-100 dark:border-neutral-800/50">
                    <td className="px-3 py-1 font-medium">{t.login}</td>
                    <td className="px-3 py-1 text-right tabular-nums">
                      ${t.amount.toLocaleString()}
                      {t.isEdited && (
                        <span className="ml-1 text-amber-700 dark:text-amber-400" title="Edited">●</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={batchProgress !== null}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              disabled={batchProgress !== null || outlierTargets.length === 0}
              onClick={async () => {
                setConfirmCreateOpen(false)
                await handleCreateOutlierUlbs()
              }}
            >
              {batchProgress
                ? 'Creating…'
                : `Create ${outlierTargets.length.toLocaleString()} ULBs · $${outlierTotalDollars.toLocaleString()}/mo`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
