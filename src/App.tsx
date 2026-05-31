import { useState } from 'react'
import { Plus, Gauge, Moon, Sun, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Toaster } from 'sonner'
import { useTheme } from 'next-themes'
import { useCredentials } from '@/hooks/use-credentials'
import { ImportPanel } from '@/components/ImportPanel'
import { IndividualUlbPage } from '@/components/IndividualUlbPage'
import { UniversalUlbPage } from '@/components/UniversalUlbPage'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BulkApplySnapshot } from '@/lib/snapshot'

type Tab = 'individual' | 'universal'

export function App() {
  const { credentials, totalBudgetCount } = useCredentials()
  const { resolvedTheme, setTheme } = useTheme()

  const [tab, setTab] = useState<Tab>('individual')
  const [creating, setCreating] = useState(false)
  // Snapshot is owned by IndividualUlbPage but surfaced here so the header
  // can render the Revert button regardless of which tab is active.
  const [snapshot, setSnapshot] = useState<BulkApplySnapshot | null>(null)
  const [revertCandidate, setRevertCandidate] = useState<BulkApplySnapshot | null>(null)

  return (
    <div className="min-h-screen">
      <Toaster richColors position="bottom-right" />
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 sticky top-0 z-10">
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

          {credentials ? (
            <div className="hidden sm:flex gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800 ml-2">
              {(['individual', 'universal'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'px-3 py-1 text-sm font-medium rounded transition-colors',
                    tab === t
                      ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
                  )}
                >
                  {t === 'individual' ? 'Individual ULBs' : 'Universal ULB'}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center gap-2 ml-auto">
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
                {tab === 'individual' ? (
                  <Button
                    onClick={() => setCreating(true)}
                    size="sm"
                    disabled={totalBudgetCount >= 10000}
                    title={totalBudgetCount >= 10000 ? 'Budget limit of 10,000 reached for this enterprise' : undefined}
                  >
                    <Plus size={16} weight="bold" />
                    Add ULB
                  </Button>
                ) : null}
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

        {/* Mobile tab row */}
        {credentials ? (
          <div className="sm:hidden max-w-7xl mx-auto px-4 pb-2 flex gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
            {(['individual', 'universal'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'flex-1 px-3 py-1 text-sm font-medium rounded transition-colors',
                  tab === t
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400',
                )}
              >
                {t === 'individual' ? 'Individual ULBs' : 'Universal ULB'}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6">
        <ImportPanel />

        {credentials ? (
          tab === 'individual' ? (
            <IndividualUlbPage
              creating={creating}
              onCreatingChange={setCreating}
              onSnapshotChange={setSnapshot}
              pendingRevert={revertCandidate}
              onPendingRevertChange={setRevertCandidate}
            />
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
