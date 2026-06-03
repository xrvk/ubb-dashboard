import { useEffect, useState } from 'react'
import { Gauge, Moon, Sun, Monitor, ArrowCounterClockwise, BookOpen } from '@phosphor-icons/react'
import { Toaster, toast } from 'sonner'
import { useTheme } from 'next-themes'
import { useCredentials } from '@/hooks/use-credentials'
import { ConnectionMenu } from '@/components/ConnectionMenu'
import { ImportPanel } from '@/components/ImportPanel'
import { IndividualUlbPage } from '@/components/IndividualUlbPage'
import { LoadProgressBanner } from '@/components/LoadProgressBanner'
import { OrgBudgetPage } from '@/components/OrgBudgetPage'
import { DashboardPage } from '@/components/DashboardPage'
import { UniversalUlbPage } from '@/components/UniversalUlbPage'
import { BudgetConstraintsHelpPage } from '@/components/BudgetConstraintsHelpPage'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PartialLoadBanner } from '@/components/PartialLoadBanner'
import { Button } from '@/components/ui/button'
import { cn, openExternal } from '@/lib/utils'
import { describeError, isAborted } from '@/lib/errors'
import { buildShareableOrgUrl } from '@/lib/urlParams'
import {
  NAV_TO_BUDGET_MODEL_EVENT,
  NAV_TO_INDIVIDUAL_EVENT,
  NAV_TO_ORG_BUDGET_EVENT,
  NAV_TO_UNIVERSAL_EVENT,
} from '@/lib/navEvents'
import type { BulkApplySnapshot } from '@/lib/snapshot'

type Tab = 'dashboard' | 'org-budget' | 'individual' | 'universal' | 'budget-model'

const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'Dashboard',
  'org-budget': 'Org Budget',
  individual: 'Individual ULBs',
  universal: 'Universal ULB',
  'budget-model': 'Budget model',
}

export function App() {
  const {
    credentials,
    refresh,
    disconnect,
    loading,
    loadProgress,
    devProfiles,
    switchProfile,
    partialLoadWarnings,
    dismissPartialLoadWarning,
  } = useCredentials()
  const { theme, resolvedTheme, setTheme } = useTheme()

  const cycleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
  }

  const themeIcon =
    theme === 'system' ? (
      <Monitor size={18} weight="duotone" />
    ) : resolvedTheme === 'dark' ? (
      <Sun size={18} weight="duotone" />
    ) : (
      <Moon size={18} weight="duotone" />
    )

  const themeLabel =
    theme === 'system'
      ? 'Theme: system (click for light)'
      : theme === 'light'
        ? 'Theme: light (click for dark)'
        : 'Theme: dark (click for system)'

  const [tab, setTab] = useState<Tab>('dashboard')

  /**
   * Switch tab AND scroll the page so the sticky tab bar pins at the very
   * top of the viewport. Re-clicking a tab acts as a "jump to top".
   */
  const goToTab = (next: Tab) => {
    setTab(next)
    window.requestAnimationFrame(() => {
      const header = document.querySelector<HTMLElement>('header')
      const offset = header?.offsetHeight ?? 0
      window.scrollTo({ top: offset, behavior: 'smooth' })
    })
  }
  const [creating, setCreating] = useState(false)
  // Snapshot is owned by IndividualUlbPage but surfaced here so the header
  // can render the Revert button regardless of which tab is active.
  const [snapshot, setSnapshot] = useState<BulkApplySnapshot | null>(null)
  const [revertCandidate, setRevertCandidate] = useState<BulkApplySnapshot | null>(null)

  useEffect(() => {
    const isBenignErrorEvent = (e: ErrorEvent): boolean => {
      if (typeof e.message === 'string' && e.message.includes('ResizeObserver loop')) return true
      if (e.error == null && e.message === 'Script error.') return true
      return false
    }
    const onError = (e: ErrorEvent) => {
      if (isAborted(e.error)) return
      if (isBenignErrorEvent(e)) return
      const desc = describeError(e.error ?? e.message, 'window.onerror')
      toast.error(desc.title, { description: desc.body })
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isAborted(e.reason)) return
      const desc = describeError(e.reason, 'unhandledrejection')
      toast.error(desc.title, { description: desc.body })
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  useEffect(() => {
    const handler = () => setTab('individual')
    window.addEventListener(NAV_TO_INDIVIDUAL_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_INDIVIDUAL_EVENT, handler)
  }, [])

  useEffect(() => {
    const handler = () => setTab('budget-model')
    window.addEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_BUDGET_MODEL_EVENT, handler)
  }, [])

  useEffect(() => {
    const handler = () => setTab('org-budget')
    window.addEventListener(NAV_TO_ORG_BUDGET_EVENT, handler)
    return () => window.removeEventListener(NAV_TO_ORG_BUDGET_EVENT, handler)
  }, [])

  useEffect(() => {
    const handler = () => {
      setTab('universal')
      // Wait for the tab content to render, then flash the cap card.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const el = document.getElementById('uulb-cap')
          if (!el) return
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          const cls = [
            'ring-2',
            'ring-amber-400',
            'ring-offset-2',
            'dark:ring-offset-neutral-950',
            'bg-amber-100',
            'dark:bg-amber-900/40',
          ]
          el.classList.add(...cls)
          window.setTimeout(() => {
            el.classList.remove(...cls)
          }, 2000)
        })
      })
    }
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
              <h1 className="text-base font-semibold leading-tight">UBB Dashboard for Organizations</h1>
              <p className="text-xs text-neutral-500 leading-tight">
                Monitor Copilot AI-credit budgets for your organization
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goToTab('budget-model')}
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
            aria-label={themeLabel}
            title={themeLabel}
            onClick={cycleTheme}
          >
            {themeIcon}
          </Button>
        </div>
      </header>

      {credentials ? (
        <div className="sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-neutral-950/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3">
            <div className="flex flex-1 sm:flex-initial gap-1 p-1 rounded-md bg-neutral-100 dark:bg-neutral-800">
              {(['dashboard', 'org-budget', 'universal', 'individual'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => goToTab(t)}
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
                    ? `Demo · ${credentials.org.replace('demo-', '')} users`
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
                devProfiles={devProfiles}
                onSwitchProfile={p => {
                  void switchProfile(p)
                }}
                currentHost={credentials.base !== 'demo://' ? new URL(credentials.base).host : undefined}
                onCopyShareLink={
                  credentials.base === 'demo://'
                    ? undefined
                    : () => {
                        const link = buildShareableOrgUrl(
                          credentials,
                          window.location.origin,
                          window.location.pathname,
                        )
                        if (!link) {
                          toast.error("Couldn't build a shareable link for this connection.")
                          return
                        }
                        void navigator.clipboard
                          .writeText(link)
                          .then(() =>
                            toast.success('Link copied', {
                              description:
                                'Recipients will see your org URL pre-filled but still need their own PAT.',
                            }),
                          )
                          .catch(() =>
                            toast.error("Couldn't copy to clipboard", { description: link }),
                          )
                      }
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {loading && loadProgress ? (
        <div className="sticky top-[49px] z-10 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:supports-[backdrop-filter]:bg-neutral-950/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2">
            <LoadProgressBanner loaded={loadProgress.loaded} total={loadProgress.total} />
          </div>
        </div>
      ) : null}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid gap-6">
        <ImportPanel />

        {credentials && partialLoadWarnings.length > 0 ? (
          <PartialLoadBanner warnings={partialLoadWarnings} onDismiss={dismissPartialLoadWarning} />
        ) : null}

        {credentials ? (
          tab === 'dashboard' ? (
            <ErrorBoundary label="Dashboard tab"><DashboardPage /></ErrorBoundary>
          ) : tab === 'org-budget' ? (
            <ErrorBoundary label="Org Budget tab"><OrgBudgetPage /></ErrorBoundary>
          ) : tab === 'individual' ? (
            <ErrorBoundary label="Individual ULBs tab">
              <IndividualUlbPage
                creating={creating}
                onCreatingChange={setCreating}
                onSnapshotChange={setSnapshot}
                pendingRevert={revertCandidate}
                onPendingRevertChange={setRevertCandidate}
              />
            </ErrorBoundary>
          ) : tab === 'budget-model' ? (
            <ErrorBoundary label="Budget model tab">
              <BudgetConstraintsHelpPage onBack={() => goToTab('org-budget')} />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary label="Universal ULB tab"><UniversalUlbPage /></ErrorBoundary>
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
              href="https://github.com/xrvk/ubb-dashboard-org"
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternal('https://github.com/xrvk/ubb-dashboard-org')}
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
