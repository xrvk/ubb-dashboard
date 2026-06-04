import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useCredentials } from '@/hooks/use-credentials'
import { FilterChips } from '@/components/FilterChips'
import { ForecastHero } from '@/components/ForecastHero'
import { UtilizationHistogram } from '@/components/UtilizationHistogram'
import { BudgetsTable, EMPTY_FILTERS, type TableFilters } from '@/components/BudgetsTable'
import { EditBudgetDialog } from '@/components/EditBudgetDialog'
import { CreateBudgetDialog } from '@/components/CreateBudgetDialog'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { BulkUnblockDialog } from '@/components/BulkUnblockDialog'
import { RevertBulkDialog } from '@/components/RevertBulkDialog'
import { FailedItemsDialog } from '@/components/FailedItemsDialog'
import { Button } from '@/components/ui/button'
import { describeError } from '@/lib/errors'
import { summarize, forecastSummary } from '@/lib/status'
import { getEffectiveDemoAsof } from '@/lib/demo'
import { openExternal } from '@/lib/utils'
import type { NavToIndividualTask } from '@/lib/navEvents'
import {
  createUserBudget as apiCreateUserBudget,
  deleteUserBudget as apiDeleteUserBudget,
  patchUserBudget as apiPatchUserBudget,
  type UserBudget,
} from '@/lib/api'
import { runBatch, type BatchOutcome, type BatchProgress } from '@/lib/batch'
import {
  clearSnapshot,
  endOfMonth,
  loadSnapshot,
  saveSnapshot,
  type BulkApplySnapshot,
} from '@/lib/snapshot'

interface Props {
  creating: boolean
  onCreatingChange: (open: boolean) => void
  /** Hook to expose the active snapshot up to the header revert button. */
  onSnapshotChange?: (snap: BulkApplySnapshot | null) => void
  pendingRevert: BulkApplySnapshot | null
  onPendingRevertChange: (snap: BulkApplySnapshot | null) => void
  /**
   * Optional initial filter to apply on mount or when it changes.
   * Set by App.tsx when something elsewhere (e.g. ConstraintsBanner)
   * deep-links to this page already filtered to a specific cost center.
   */
  pendingFilter?: TableFilters | null
  /** Called after pendingFilter has been applied so the parent can clear it. */
  onPendingFilterConsumed?: () => void
  /** Active task that brought the user to this page (renders a contextual banner). */
  activeTask?: NavToIndividualTask | null
  /** Called when the user dismisses the task banner or clears the related filter. */
  onTaskDismiss?: () => void
}

export function IndividualUlbPage({
  creating,
  onCreatingChange,
  onSnapshotChange,
  pendingRevert,
  onPendingRevertChange,
  pendingFilter,
  onPendingFilterConsumed,
  activeTask,
  onTaskDismiss,
}: Props) {
  const {
    credentials,
    budgets,
    totalBudgetCount,
    seats,
    costCenters,
    loginToCostCenter,
    loading,
    apiFetch,
    refresh,
  } = useCredentials()

  type BulkUpdate = { id: string; user: string; newAmount: number }
  type RevertEntry = BulkApplySnapshot['entries'][number]

  const [editing, setEditing] = useState<UserBudget | null>(null)
  const [deleting, setDeleting] = useState<UserBudget | null>(null)
  const [bulkUnblock, setBulkUnblock] = useState<UserBudget[] | null>(null)
  const [bulkFailures, setBulkFailures] = useState<BatchOutcome<BulkUpdate>[] | null>(null)
  const [revertFailures, setRevertFailures] = useState<BatchOutcome<RevertEntry>[] | null>(null)
  /**
   * AbortController for an in-flight "retry failures" run. Hoisted so the
   * dialog's close handler can abort the request — otherwise the retry
   * keeps running invisibly and the late `refresh()` would yank data
   * underneath whatever the user navigated to next.
   */
  const retryCtrlRef = useRef<AbortController | null>(null)
  const [, setSnapshot] = useState<BulkApplySnapshot | null>(null)
  const [filters, setFilters] = useState<TableFilters>(EMPTY_FILTERS)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const summary = useMemo(() => summarize(budgets), [budgets])
  const demoAsof = useMemo(() => getEffectiveDemoAsof() ?? undefined, [])
  const forecast = useMemo(() => forecastSummary(budgets, demoAsof), [budgets, demoAsof])
  const existingUsernames = useMemo(() => new Set(budgets.map(b => b.user)), [budgets])

  // Load the most recent snapshot for the connected enterprise.
  const [snapshotFor, setSnapshotFor] = useState<string | null>(null)
  const currentEnt = credentials?.ent ?? null
  if (snapshotFor !== currentEnt) {
    setSnapshotFor(currentEnt)
    const next = currentEnt ? loadSnapshot(currentEnt) : null
    setSnapshot(next)
    onSnapshotChange?.(next)
  }

  const scrollToTable = () => {
    requestAnimationFrame(() => {
      tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const setFiltersAndScroll = (next: TableFilters) => {
    setFilters(next)
    scrollToTable()
  }

  // Apply a deep-link filter requested by another page (e.g. ConstraintsBanner
  // sending the user here pre-filtered to a failing CC's members). Consume on
  // apply so subsequent renders don't keep re-applying the same filter. The
  // setState-in-effect is intentional: this IS the synchronization with the
  // external nav-event state owned by App.tsx.
  useEffect(() => {
    if (!pendingFilter) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters(pendingFilter)
    scrollToTable()
    onPendingFilterConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFilter])

  const updateSnapshot = (s: BulkApplySnapshot | null) => {
    setSnapshot(s)
    onSnapshotChange?.(s)
  }

  // Live recompute of the active task's progress so the contextual banner
  // updates as the user lowers ULBs on this page. The banner itself now
  // lives in App.tsx so it persists above the page scroll; we keep just the
  // filter-mismatch dismiss effect below.

  // If the user clears the cost-center filter that brought them here, also
  // clear the task so the banner doesn't linger over an unrelated view.
  // Guard with a ref so we don't dismiss before the deep-link pendingFilter
  // has had a chance to apply on first mount (otherwise activeTask gets nuked
  // immediately because filters.costCenter is still "" while activeTask just
  // arrived from App.tsx).
  const taskMatchedOnceRef = useRef(false)
  useEffect(() => {
    if (!activeTask) {
      taskMatchedOnceRef.current = false
      return
    }
    if (filters.costCenter === activeTask.costCenterId) {
      taskMatchedOnceRef.current = true
      return
    }
    if (taskMatchedOnceRef.current) {
      onTaskDismiss?.()
    }
  }, [activeTask, filters.costCenter, onTaskDismiss])

  const handleEdit = async (newAmount: number) => {
    if (!editing) return
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would update ${editing.user} to $${newAmount}`)
      return
    }
    if (!apiFetch) return
    await apiPatchUserBudget(apiFetch, editing.id, newAmount)
    toast.success(`Updated ${editing.user} to $${newAmount}`)
    await refresh()
  }

  const handleCreate = async (username: string, amount: number) => {
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would create budget for ${username}`)
      return
    }
    if (!apiFetch) return
    await apiCreateUserBudget(apiFetch, username, amount)
    toast.success(`Created budget for ${username}`)
    await refresh()
  }

  const handleDelete = async () => {
    if (!deleting) return
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would delete budget for ${deleting.user}`)
      return
    }
    if (!apiFetch) return
    await apiDeleteUserBudget(apiFetch, deleting.id)
    toast.success(`Deleted budget for ${deleting.user}`)
    await refresh()
  }

  const runBulkApply = async (
    updates: BulkUpdate[],
    handle: { signal: AbortSignal; onProgress: (p: BatchProgress) => void },
  ): Promise<BatchOutcome<BulkUpdate>[]> => {
    if (!apiFetch) return []
    return runBatch(
      updates,
      async u => {
        await apiPatchUserBudget(apiFetch, u.id, u.newAmount)
      },
      {
        concurrency: 5,
        perTaskDelayMs: 50,
        maxRetriesOn429: 2,
        defaultRetryAfterMs: 60_000,
        signal: handle.signal,
        onProgress: handle.onProgress,
      },
    )
  }

  const handleBulkUnblock = async (
    updates: BulkUpdate[],
    handle: { signal: AbortSignal; onProgress: (p: BatchProgress) => void },
  ) => {
    if (credentials?.base === 'demo://') {
      let done = 0
      for (let i = 0; i < updates.length; i += 1) {
        if (handle.signal.aborted) break
        await new Promise(r => setTimeout(r, 8))
        done += 1
        handle.onProgress({
          total: updates.length,
          completed: done,
          succeeded: done,
          failed: 0,
          inFlight: 0,
          retrying: 0,
          startedAt: Date.now() - done * 8,
          rateLimitExhausted: null,
        })
      }
      toast.info(`Demo mode: would update ${updates.length.toLocaleString()} budgets`)
      return
    }
    if (!apiFetch || !credentials) return

    const previousById = new Map(budgets.map(b => [b.id, b]))
    const snapshotEntries = updates
      .map(u => {
        const prev = previousById.get(u.id)
        if (!prev) return null
        return {
          budgetId: u.id,
          user: u.user,
          previousAmount: prev.budgetAmount,
          newAmount: u.newAmount,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

    const results = await runBulkApply(updates, handle)
    const failedOutcomes = results.filter(r => !r.ok)
    const failed = failedOutcomes.length
    const ok = results.length - failed
    if (failed === 0) toast.success(`Unblocked ${ok.toLocaleString()} users`)
    else if (ok === 0) toast.error(`Failed to update ${failed.toLocaleString()} users — see details`)
    else toast.warning(`Updated ${ok.toLocaleString()}, ${failed.toLocaleString()} failed — see details`)

    if (failed > 0) setBulkFailures(results)

    const succeededIds = new Set(results.filter(r => r.ok).map(r => (r.item as { id: string }).id))
    const succeededEntries = snapshotEntries.filter(e => succeededIds.has(e.budgetId))
    if (succeededEntries.length > 0) {
      const snap: BulkApplySnapshot = {
        id: `snap-${Date.now()}`,
        enterprise: credentials.ent,
        appliedAt: Date.now(),
        cycleEndsAt: endOfMonth().getTime(),
        entries: succeededEntries,
      }
      const saveResult = saveSnapshot(snap)
      if (!saveResult.ok) {
        const reason =
          saveResult.reason === 'quota_exceeded'
            ? 'browser storage is full'
            : saveResult.reason === 'storage_unavailable'
              ? 'browser storage is unavailable'
              : 'an unknown storage error occurred'
        toast.warning(
          `Could not save revert snapshot — ${reason}. The revert button will not be available for this batch.`,
        )
      }
      updateSnapshot(snap)
    }

    await refresh()
  }

  const handleRetryBulkFailures = async (failedOutcomes: BatchOutcome<BulkUpdate>[]) => {
    const subset = failedOutcomes.map(o => o.item)
    if (subset.length === 0) return
    // Abort any prior retry that's somehow still in flight.
    retryCtrlRef.current?.abort()
    const ctrl = new AbortController()
    retryCtrlRef.current = ctrl
    const t = toast.loading(`Retrying ${subset.length.toLocaleString()} failures…`)
    let results: BatchOutcome<BulkUpdate>[]
    try {
      results = await runBulkApply(subset, {
        signal: ctrl.signal,
        onProgress: () => {},
      })
    } finally {
      toast.dismiss(t)
      if (retryCtrlRef.current === ctrl) retryCtrlRef.current = null
    }
    // If the user closed the dialog mid-retry, don't surface any results.
    if (ctrl.signal.aborted) return
    const stillFailed = results.filter(r => !r.ok)
    if (stillFailed.length === 0) {
      toast.success(`Retried ${subset.length.toLocaleString()} updates successfully`)
      setBulkFailures(null)
    } else {
      toast.warning(
        `Retried ${subset.length - stillFailed.length}, ${stillFailed.length} still failed`,
      )
      setBulkFailures(results)
    }
    await refresh()
  }

  const handleRevert = async (snap: BulkApplySnapshot) => {
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would revert ${snap.entries.length.toLocaleString()} budgets`)
      clearSnapshot()
      updateSnapshot(null)
      onPendingRevertChange(null)
      return
    }
    if (!apiFetch) return
    const t = toast.loading(`Reverting ${snap.entries.length.toLocaleString()} budgets…`)
    try {
      const results = await runBatch(
        snap.entries,
        async e => {
          await apiPatchUserBudget(apiFetch, e.budgetId, e.previousAmount)
        },
        { concurrency: 5, perTaskDelayMs: 50 },
      )
      const failedOutcomes = results.filter(r => !r.ok)
      const failed = failedOutcomes.length
      toast.dismiss(t)
      if (failed === 0) {
        toast.success(`Reverted ${snap.entries.length.toLocaleString()} budgets`)
        clearSnapshot()
        updateSnapshot(null)
      } else {
        toast.warning(`Reverted ${snap.entries.length - failed}, ${failed} failed — see details`)
        setRevertFailures(results)
      }
      onPendingRevertChange(null)
      await refresh()
    } catch (e) {
      toast.dismiss(t)
      toast.error(describeError(e, 'bulk-revert').body)
    }
  }

  if (loading && budgets.length === 0) {
    return (
      <div className="text-center text-sm text-neutral-500 py-12">
        Loading budgets…
      </div>
    )
  }

  return (
    <>
      {totalBudgetCount >= 9500 ? (
        <div
          role="alert"
          className={
            totalBudgetCount >= 10000
              ? 'rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-200'
              : 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
          }
        >
          <strong className="font-medium">
            {totalBudgetCount >= 10000 ? 'Budget limit reached:' : 'Approaching budget limit:'}
          </strong>{' '}
          {totalBudgetCount.toLocaleString()} of 10,000 budgets used across this enterprise (all types).{' '}
          {totalBudgetCount >= 10000
            ? 'New budgets cannot be created until existing ones are removed.'
            : `${(10000 - totalBudgetCount).toLocaleString()} remaining.`}{' '}
          <a
            href="https://docs.github.com/en/billing/concepts/budgets-and-alerts#budget-limitation"
            target="_blank"
            rel="noreferrer"
            onClick={openExternal('https://docs.github.com/en/billing/concepts/budgets-and-alerts#budget-limitation')}
            className="underline underline-offset-2 hover:no-underline"
          >
            Learn more
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Live utilization for users with an individual ULB. Forecasts project end of month at the current burn rate.
        </p>
      </div>
      <ForecastHero
        forecast={forecast}
        onSelectProjectedOver={() =>
          setFiltersAndScroll({ ...EMPTY_FILTERS, atRiskByEom: true })
        }
      />
      <FilterChips
        summary={summary}
        active={
          filters.atRiskByEom
            ? 'all'
            : filters.status === 'over'
              ? 'over'
              : filters.status === 'near'
                ? 'near'
                : 'all'
        }
        onSelectAll={() => setFiltersAndScroll(EMPTY_FILTERS)}
        onSelectOver={() => setFiltersAndScroll({ ...EMPTY_FILTERS, status: 'over' })}
        onSelectNear={() => setFiltersAndScroll({ ...EMPTY_FILTERS, status: 'near' })}
      />
      {budgets.length > 0 ? (
        <>
          <UtilizationHistogram
            budgets={budgets}
            selectedBucketId={
              filters.bucketIds && filters.bucketIds.length === 1 ? filters.bucketIds[0] : null
            }
            onSelectBucket={id =>
              setFiltersAndScroll({ ...filters, bucketIds: id ? [id] : null, status: 'all' })
            }
          />
          <div ref={tableRef} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                Individual ULBs
                <span className="ml-2 text-xs font-normal text-neutral-500">
                  {totalBudgetCount.toLocaleString()} total
                </span>
              </h2>
              <Button
                onClick={() => onCreatingChange(true)}
                size="sm"
                disabled={totalBudgetCount >= 10000}
                title={totalBudgetCount >= 10000 ? 'Budget limit of 10,000 reached for this enterprise' : undefined}
              >
                <Plus size={16} weight="bold" />
                Add ULB
              </Button>
            </div>
            <BudgetsTable
              budgets={budgets}
              filters={filters}
              onFiltersChange={setFilters}
              onEdit={setEditing}
              onDelete={setDeleting}
              onBulkUnblock={items => setBulkUnblock(items)}
              costCenters={costCenters}
              loginToCostCenter={loginToCostCenter}
            />
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-12 text-center">
          <p className="text-sm text-neutral-500">No individual ULBs found for this enterprise.</p>
          <Button className="mt-4" onClick={() => onCreatingChange(true)}>
            <Plus size={16} weight="bold" />
            Add the first one
          </Button>
        </div>
      )}

      <EditBudgetDialog
        budget={editing}
        open={editing !== null}
        onOpenChange={open => !open && setEditing(null)}
        onSubmit={handleEdit}
      />
      <CreateBudgetDialog
        open={creating}
        onOpenChange={onCreatingChange}
        onSubmit={handleCreate}
        seats={seats}
        existingUsernames={existingUsernames}
      />
      <DeleteConfirmDialog
        budget={deleting}
        open={deleting !== null}
        onOpenChange={open => !open && setDeleting(null)}
        onConfirm={handleDelete}
      />
      <BulkUnblockDialog
        open={bulkUnblock !== null}
        onOpenChange={open => !open && setBulkUnblock(null)}
        selected={bulkUnblock ?? []}
        onApply={handleBulkUnblock}
      />
      <RevertBulkDialog
        snapshot={pendingRevert}
        onCancel={() => onPendingRevertChange(null)}
        onConfirm={() => {
          if (pendingRevert) return handleRevert(pendingRevert)
        }}
        onDiscard={() => {
          clearSnapshot()
          updateSnapshot(null)
          onPendingRevertChange(null)
          toast.info('Snapshot discarded')
        }}
      />
      <FailedItemsDialog
        open={bulkFailures !== null}
        onOpenChange={open => {
          if (!open) {
            // Abort any in-flight retry so it stops issuing API calls and
            // doesn't trigger a late refresh.
            retryCtrlRef.current?.abort()
            retryCtrlRef.current = null
            setBulkFailures(null)
          }
        }}
        title="Bulk update — failed items"
        outcomes={bulkFailures ?? []}
        getLabel={u => u.user}
        onRetry={handleRetryBulkFailures}
        csvFilename="bulk-update-failures"
      />
      <FailedItemsDialog
        open={revertFailures !== null}
        onOpenChange={open => !open && setRevertFailures(null)}
        title="Bulk revert — failed items"
        outcomes={revertFailures ?? []}
        getLabel={e => e.user}
        csvFilename="bulk-revert-failures"
      />
    </>
  )
}

/** Re-expose snapshot to the header outside the component. */
export type { BulkApplySnapshot }
