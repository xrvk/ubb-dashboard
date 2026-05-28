import { useMemo, useRef, useState } from 'react'
import { Plus, Gauge, Moon, Sun } from '@phosphor-icons/react'
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
import { Button } from '@/components/ui/button'
import { summarize } from '@/lib/status'
import {
  createUserBudget as apiCreateUserBudget,
  deleteUserBudget as apiDeleteUserBudget,
  patchUserBudget as apiPatchUserBudget,
  type UserBudget,
} from '@/lib/api'

export function App() {
  const { credentials, budgets, loading, loadProgress, apiFetch, refresh } = useCredentials()
  const { theme, setTheme } = useTheme()

  const [editing, setEditing] = useState<UserBudget | null>(null)
  const [deleting, setDeleting] = useState<UserBudget | null>(null)
  const [creating, setCreating] = useState(false)
  const [bulkUnblock, setBulkUnblock] = useState<UserBudget[] | null>(null)
  const [filters, setFilters] = useState<TableFilters>(EMPTY_FILTERS)
  const tableRef = useRef<HTMLDivElement | null>(null)

  const summary = useMemo(() => summarize(budgets), [budgets])

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
  ) => {
    if (credentials?.base === 'demo://') {
      toast.info(`Demo mode: would update ${updates.length} budgets`)
      return
    }
    if (!apiFetch) return
    const results = await Promise.allSettled(
      updates.map(u => apiPatchUserBudget(apiFetch, u.id, u.newAmount)),
    )
    const failed = results
      .map((r, i) => ({ r, u: updates[i] }))
      .filter(x => x.r.status === 'rejected')
    if (failed.length === 0) {
      toast.success(`Unblocked ${updates.length} user${updates.length === 1 ? '' : 's'}`)
    } else if (failed.length === updates.length) {
      toast.error(`Failed to update ${failed.length} user${failed.length === 1 ? '' : 's'}`)
      const first = failed[0].r as PromiseRejectedResult
      throw first.reason
    } else {
      toast.warning(`Updated ${updates.length - failed.length}, failed ${failed.length}`)
    }
    await refresh()
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
              <Button onClick={() => setCreating(true)} size="sm">
                <Plus size={16} weight="bold" />
                Add ULB
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
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
    </div>
  )
}
