import { useEffect, useState } from 'react'
import { Gauge, Moon, Sun, ArrowCounterClockwise, BookOpen } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import { useTheme } from 'next-themes'
import { useCredentials } from '@/hooks/use-credentials'
import { ConnectionMenu } from '@/components/ConnectionMenu'
import { ImportPanel } from '@/components/ImportPanel'
import { IndividualUlbPage } from '@/components/IndividualUlbPage'
import { IndividualUlbTaskBanner } from '@/components/IndividualUlbTaskBanner'
import { OverviewPage } from '@/components/OverviewPage'
import { UniversalUlbPage } from '@/components/UniversalUlbPage'
import { BudgetConstraintsHelpPage } from '@/components/BudgetConstraintsHelpPage'
import { Button } from '@/components/ui/button'
import { cn, openExternal } from '@/lib/utils'
import { EMPTY_FILTERS, type TableFilters } from '@/components/BudgetsTable'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
  type NavToIndividualDetail,
  type NavToIndividualTask,
} from '@/lib/navEvents'
import type { BulkApplySnapshot } from '@/lib/snapshot'

type Tab = 'overview' | 'individual' | 'universal' | 'budget-model'

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  individual: 'Individual ULBs',
  universal: 'Universal ULB',
  'budget-model': 'Budget model',
}

export function App() {
  const { credentials, refresh, disconnect, loading } = useCredentials()
  const { resolvedTheme, setTheme } = useTheme()

  const [tab, setTab] = useState<Tab>('overview')
  const [creating, setCreating] = useState(false)
  // Snapshot is owned by IndividualUlbPage but surfaced here so the header
  // can render the Revert button regardless of which tab is active.
  const [snapshot, setSnapshot] = useState<BulkApplySnapshot | null>(null)
  const [revertCandidate, setRevertCandidate] = useState<BulkApplySnapshot | null>(null)
  // Pending filter set by deep-link events (e.g. from ConstraintsBanner).
  // Cleared by IndividualUlbPage once consumed.
  const [pendingIndividualFilter, setPendingIndividualFilter] = useState<TableFilters | null>(null)
  // Active task context shown as a contextual banner on the Individual ULBs
  // page so the user remembers what they came to fix.
  const [activeTask, setActiveTask] = useState<NavToIndividualTask | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<NavToIndividualDetail>).detail
      if (!detail) return
      setPendingIndividualFilter(detail.filter ?? EMPTY_FILTERS)
      setActiveTask(detail.task ?? null)
      setTab('individual')
    }
    window.addEventListener(NAV_TO_INDIVIDUAL_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_INDIVIDUAL_EVENT, handler)
  }, [])

  useEffect(() => {
    const handler = () => setTab('budget-model')
    window.addEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
  }, [])

  useEffect(() => {
    const handler = () => setTab('universal')
    window.addEventListener(NAV_TO_UNIVERSAL_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_UNIVERSAL_EVENT, handler)
  }, [])
  return (
    <div className="min-h-screen">
      <Toaster richColors position="bottom-right" />
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Gauge size={26} weight="duotone" className="text-emerald-600" />
            <div>
              <h1 className="text-base font-semibold leading-tight">ULB Dashboard</h1>
              <p className="text-xs text-neutral-500 leading-tight">
                Monitor Copilot AI-credit budgets across your enterprise
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTab('budget-model')}
            title="How the budget constraint model works"
            className={cn(
              'ml-auto',
              tab === 'budget-model' &&
                'bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
            )}
          >
            <BookOpen size={14} weight="duotone" />
            <span className="hidden sm:inline">Budget model</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle theme"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          >
            {resolvedTheme === 'dark' ? <Sun size={18} weight="duotone" /> : <Moon size={18} weight="duotone" />}
          </Button>
        </div>
      </header>

      {credentials ? (
        <div className="sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-neutral-950/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
            <div className="flex flex-1 sm:flex-initial gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
              {(['overview', 'universal', 'individual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex-1 sm:flex-initial px-3 py-1 text-sm font-medium rounded transition-colors',
                    tab === t
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
                  )}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              {snapshot ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRevertCandidate(snapshot)}
                  title={`Revert the most recent bulk apply (${snapshot.entries.length} budgets)`}
                >
                  <ArrowCounterClockwise size={14} weight="duotone" />
                  <span className="hidden sm:inline">Revert ({snapshot.entries.length.toLocaleString()})</span>
                </Button>
              ) : null}
              <ConnectionMenu
                isDemo={credentials.base === 'demo://'}
                label={
                  credentials.base === 'demo://'
                    ? `Demo · ${credentials.ent.replace('demo-', '')} users`
                    : new URL(credentials.base).host
                }
                loading={loading}
                onRefresh={() => void refresh()}
                onDisconnect={() => {
                  if (credentials.base === 'demo://') {
                    window.location.search = ''
                  } else {
                    disconnect()
                  }
                }}
              />
            </div>
          </div>
        </div>
      ) : null}

      {credentials && tab === 'individual' && activeTask ? (
        <div className="sticky top-[49px] z-10 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-neutral-950/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
            <IndividualUlbTaskBanner task={activeTask} onDismiss={() => setActiveTask(null)} />
          </div>
        </div>
      ) : null}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6">
        <ImportPanel />

        {credentials ? (
          tab === 'overview' ? (
            <OverviewPage />
          ) : tab === 'individual' ? (
            <IndividualUlbPage
              creating={creating}
              onCreatingChange={setCreating}
              onSnapshotChange={setSnapshot}
              pendingRevert={revertCandidate}
              onPendingRevertChange={setRevertCandidate}
              pendingFilter={pendingIndividualFilter}
              onPendingFilterConsumed={() => setPendingIndividualFilter(null)}
              activeTask={activeTask}
              onTaskDismiss={() => setActiveTask(null)}
            />
          ) : tab === 'budget-model' ? (
            <BudgetConstraintsHelpPage onBack={() => setTab('overview')} />
          ) : (
            <UniversalUlbPage />
          )
        ) : null}
      </main>

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
              onClick={openExternal('https://docs.github.com')}
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
              onClick={openExternal('https://github.com/xrvk')}
              className="hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline underline-offset-2 transition-colors"
            >
              @xrvk
            </a>
            {' · '}
            <a
              href="https://github.com/xrvk/ind-ulb-dashboard"
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternal('https://github.com/xrvk/ind-ulb-dashboard')}
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
