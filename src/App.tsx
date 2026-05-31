import { useMemo, useRef, useState } from 'react'
import { Plus, Gauge, Moon, Sun, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Toaster, toast } from 'sonner'
import { useTheme } from 'next-themes'
import { useCredentials } from '@/hooks/use-credentials'
import { ImportPanel } from '@/components/ImportPanel'
import { SummaryCards } from '@/components/SummaryCards'
import { UtilizationHistogram } from '@/components/UtilizationHistogram'
import { BudgetsTable, EMPTY_FILTERS, type TableFilters } from '@/components/BudgetsTable'
import { EditBudgetDialog } from '@/components/EditBudgetDialog'
import { CreateBudgetDialog } from '@/components/CreateBudgetDialog'
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog'
import { BulkUnblockDialog } from '@/components/BulkUnblockDialog'
import { RevertBulkDialog } from '@/components/RevertBulkDialog'
import { Button } from '@/components/ui/button'
import { summarize } from '@/lib/status'
import { createUserBudget as apiCreateUserBudget, deleteUserBudget as apiDeleteUserBudget, patchUserBudget as apiPatchUserBudget, type UserBudget } from '@/lib/api'
import { runBatch, type BatchProgress } from '@/lib/batch'
import { clearSnapshot, endOfMonth, loadSnapshot, saveSnapshot, type BulkApplySnapshot } from '@/lib/snapshot'

export function App() {
  const { credentials, budgets, totalBudgetCount, seats, costCenters, loginToCostCenter, loading, loadProgress, apiFetch, refresh } = useCredentials()
  const { resolvedTheme, setTheme } = useTheme()

  const [editing, setEditing] = useState<UserBudget | null>(null)
  const [deleting, setDeleting] = useState<UserBudget | null>(null)
  const [creating, setCreating] = useState(false)
  const [bulkUnblock, setBulkUnblock] = useState<UserBudget[] | null>(null)
  const [revertCandidate, setRevertCandidate] = useState<BulkApplySnapshot | null>(null)
  const [snapshot, setSnapshot] = useState<BulkApplySnapshot | null>(null)
  const [filters, setFilters] = useState<TableFilters>(EMPTY_FILTERS)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const summary = useMemo(() => summarize(budgets), [budgets])
  const existingUsernames = useMemo(() => new Set(budgets.map(b => b.user)), [budgets])

  // Load the most recent snapshot for the connected enterprise.
  // State-during-render keyed on credentials so we don't need useEffect.
  const [snapshotFor, setSnapshotFor] = useState<string | null>(null)
  const currentEnt = credentials?.ent ?? null
  if (snapshotFor !== currentEnt) {
    setSnapshotFor(currentEnt)
    setSnapshot(currentEnt ? loadSnapshot(currentEnt) : null)
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

  const handleBulkUnblock = async (
    updates: Array<{ id: string; user: string; newAmount: number }>,
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
        })
      }
      toast.info(`Demo mode: would update ${updates.length.toLocaleString()} budgets`)
      return
    }
    if (!apiFetch || !credentials) return

    // Capture pre-apply state so admin can revert after cycle reset.
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

    const results = await runBatch(
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
    const failed = results.filter(r => !r.ok).length
    const ok = results.length - failed
    if (failed === 0) {
      toast.success(`Unblocked ${ok.toLocaleString()} users`)
    } else if (ok === 0) {
      toast.error(`Failed to update ${failed.toLocaleString()} users`)
    } else {
      toast.warning(`Updated ${ok.toLocaleString()}, failed ${failed.toLocaleString()}`)
    }

    // Persist a snapshot of the successfully-applied updates.
    const succeededIds = new Set(
      results.filter(r => r.ok).map(r => (r.item as { id: string }).id),
    )
    const succeededEntries = snapshotEntries.filter(e => succeededIds.has(e.budgetId))
    if (succeededEntries.length > 0) {
      const snap: BulkApplySnapshot = {
        id: `snap-${Date.now()}`,
        enterprise: credentials.ent,
        appliedAt: Date.now(),
        cycleEndsAt: endOfMonth().getTime(),
        entries: succeededEntries,
      }
      saveSnapshot(snap)
      setSnapshot(snap)
    }

    await refresh()
  }

  const handleRevert = async (snap: BulkApplySnapshot) => {
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would revert ${snap.entries.length.toLocaleString()} budgets`)
      clearSnapshot()
      setSnapshot(null)
      setRevertCandidate(null)
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
      const failed = results.filter(r => !r.ok).length
      toast.dismiss(t)
      if (failed === 0) {
        toast.success(`Reverted ${snap.entries.length.toLocaleString()} budgets`)
        clearSnapshot()
        setSnapshot(null)
      } else {
        toast.warning(`Reverted ${snap.entries.length - failed}, failed ${failed}`)
      }
      setRevertCandidate(null)
      await refresh()
    } catch (e) {
      toast.dismiss(t)
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="min-h-screen">
      <Toaster richColors position="bottom-right" />
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Gauge size={26} weight="duotone" className="text-emerald-600" />
            <div>
              <h1 className="text-base font-semibold leading-tight">Individual ULB Dashboard</h1>
              <p className="text-xs text-neutral-500 leading-tight">
                Monitor per-user Copilot budgets across your enterprise
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {credentials ? (
              <>
                {snapshot ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRevertCandidate(snapshot)}
                    title={`Revert the most recent bulk apply (${snapshot.entries.length} budgets)`}
                  >
                    <ArrowCounterClockwise size={14} weight="duotone" />
                    Revert ({snapshot.entries.length.toLocaleString()})
                  </Button>
                ) : null}
                <Button
                  onClick={() => setCreating(true)}
                  size="sm"
                  disabled={totalBudgetCount >= 10000}
                  title={totalBudgetCount >= 10000 ? 'Budget limit of 10,000 reached for this enterprise' : undefined}
                >
                  <Plus size={16} weight="bold" />
                  Add ULB
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6">
        <ImportPanel />

        {credentials ? (
          loading && budgets.length === 0 ? (
            <div className="text-center text-sm text-neutral-500 py-12">
              {loadProgress
                ? loadProgress.total
                  ? `Loading budgets… ${loadProgress.loaded} of ${loadProgress.total}`
                  : `Loading budgets… ${loadProgress.loaded}`
                : 'Loading budgets…'}
            </div>
          ) : (
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
                  {totalBudgetCount.toLocaleString()} of 10,000 budgets used across this
                  enterprise (all types).{' '}
                  {totalBudgetCount >= 10000
                    ? 'New budgets cannot be created until existing ones are removed.'
                    : `${(10000 - totalBudgetCount).toLocaleString()} remaining.`}{' '}
                  <a
                    href="https://docs.github.com/en/billing/concepts/budgets-and-alerts#budget-limitation"
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-2 hover:no-underline"
                  >
                    Learn more
                  </a>
                </div>
              ) : null}
              <SummaryCards
                summary={summary}
                onReset={() => setFiltersAndScroll(EMPTY_FILTERS)}
                onSelectOver={() => setFiltersAndScroll({ ...EMPTY_FILTERS, status: 'over' })}
                onSelectNear={() => setFiltersAndScroll({ ...EMPTY_FILTERS, status: 'near' })}
              />
              {budgets.length > 0 ? (
                <>
                  <UtilizationHistogram
                    budgets={budgets}
                    selectedBucketId={filters.bucketId}
                    onSelectBucket={id =>
                      setFiltersAndScroll({ ...filters, bucketId: id, status: 'all' })
                    }
                  />
                  <div ref={tableRef}>
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
                  <p className="text-sm text-neutral-500">
                    No individual ULBs found for this enterprise.
                  </p>
                  <Button className="mt-4" onClick={() => setCreating(true)}>
                    <Plus size={16} weight="bold" />
                    Add the first one
                  </Button>
                </div>
              )}
            </>
          )
        ) : null}
      </main>

      <EditBudgetDialog
        budget={editing}
        open={editing !== null}
        onOpenChange={open => !open && setEditing(null)}
        onSubmit={handleEdit}
      />
      <CreateBudgetDialog
        open={creating}
        onOpenChange={setCreating}
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
        snapshot={revertCandidate}
        onCancel={() => setRevertCandidate(null)}
        onConfirm={() => {
          if (revertCandidate) return handleRevert(revertCandidate)
        }}
        onDiscard={() => {
          clearSnapshot()
          setSnapshot(null)
          setRevertCandidate(null)
          toast.info('Snapshot discarded')
        }}
      />

      <footer className="border-t border-neutral-200 dark:border-neutral-800 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-3 text-center text-xs text-neutral-500">
          <p className="leading-relaxed">
            This is an independent, personal project by a GitHub Solutions Engineer.
            It is not an official GitHub product and does not represent GitHub's views.
            Provided "as is" for planning purposes only; not financial or billing advice.
            Past usage patterns may not predict future usage. Always verify against{' '}
            <a
              href="https://docs.github.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
            >
              GitHub's official documentation
            </a>{' '}
            before applying changes.
          </p>
          <p>
            Developed by{' '}
            <a
              href="https://github.com/xrvk"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline underline-offset-2 transition-colors"
            >
              @xrvk
            </a>
            {' · '}
            <a
              href="https://github.com/xrvk/ind-ulb-dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline underline-offset-2 transition-colors"
            >
              Source
            </a>
          </p>
        </div>
      </footer>
    </div>
  )
}
