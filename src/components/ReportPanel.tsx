import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowsClockwise, ArrowSquareOut, FileArrowUp, Clock, CheckCircle } from '@phosphor-icons/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCredentials } from '@/hooks/use-credentials'
import {
  aggregateAicByUser,
  createReport,
  endOfMonthISO,
  getReport,
  listReports,
  monthKey as toMonthKey,
  parseUsageCsv,
  startOfMonthISO,
  type UsageReport,
} from '@/lib/usageReport'
import {
  saveCachedReport,
  type CachedReport,
  type IngestSource,
} from '@/lib/reportCache'

interface Props {
  /** Month the dashboard is currently looking at. */
  month: Date
  /** Called whenever the cached report for the current month changes. */
  onIngested: (report: CachedReport) => void
  /** Current cached report for the active month, if any. */
  cached: CachedReport | null
}

const ONE_HOUR_MS = 60 * 60 * 1000

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < ONE_HOUR_MS) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 24 * ONE_HOUR_MS) return `${Math.floor(diff / ONE_HOUR_MS)}h ago`
  // Display in the viewer's local timezone for readability; backend math
  // stays in UTC elsewhere.
  return new Date(ts).toLocaleString()
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function ReportPanel({ month, onIngested, cached }: Props) {
  const { credentials, apiFetch } = useCredentials()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  /** Most recent report from `GET /reports` for this enterprise (any month). */
  const [latestReport, setLatestReport] = useState<UsageReport | null>(null)
  const [reportListError, setReportListError] = useState<string | null>(null)
  /** A report we're polling (created via the generate button or fetched). */
  const [activeReport, setActiveReport] = useState<UsageReport | null>(null)
  // `polling` is derived from activeReport status so we don't need to
  // toggle a separate state inside the effect (which trips react-hooks/set-state-in-effect).
  const polling = activeReport?.status === 'processing'
  const [creating, setCreating] = useState(false)
  /** Source attributed to the next upload, set when user clicks a flow button. */
  const [pendingSource, setPendingSource] = useState<IngestSource>('uploaded')
  /** Forces a re-render every second so countdown stays fresh. */
  const [nowTick, setNowTick] = useState<number>(0)

  // Tick once a second for the cooldown countdown display.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch the latest report list when credentials change.
  useEffect(() => {
    if (!apiFetch) return
    let cancelled = false
    listReports(apiFetch)
      .then(list => {
        if (cancelled) return
        setLatestReport(list[0] ?? null)
        setReportListError(null)
      })
      .catch(err => {
        if (cancelled) return
        // /reports has a known suffixed-payload bug in some envs — degrade
        // gracefully rather than blocking the page.
        setReportListError(err instanceof Error ? err.message : String(err))
        setLatestReport(null)
      })
    return () => {
      cancelled = true
    }
  }, [apiFetch])

  // Poll an active report (one we just created, or one we're awaiting).
  useEffect(() => {
    if (!apiFetch || !activeReport || activeReport.status !== 'processing') return
    let cancelled = false
    const tick = async () => {
      try {
        const next = await getReport(apiFetch, activeReport.id)
        if (cancelled) return
        setActiveReport(next)
        if (next.status === 'processing') {
          setTimeout(tick, 5000)
        }
      } catch (err) {
        if (cancelled) return
        toast.error(err instanceof Error ? err.message : String(err))
      }
    }
    const id = setTimeout(tick, 5000)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [apiFetch, activeReport])

  const handleGenerate = async () => {
    if (!apiFetch) return
    setCreating(true)
    try {
      const created = await createReport(apiFetch, {
        report_type: 'detailed',
        start_date: startOfMonthISO(month),
        end_date: endOfMonthISO(month),
      })
      setActiveReport(created)
      setLatestReport(prev => (prev && prev.created_at > created.created_at ? prev : created))
      setPendingSource('generated')
      toast.success('Report queued — generation usually takes ~1 minute.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleUseLatest = async () => {
    if (!apiFetch || !latestReport) return
    setPendingSource('latest-from-api')
    if (latestReport.status === 'completed') {
      setActiveReport(latestReport)
      return
    }
    // Fetch a fresh copy so download_urls are populated when complete.
    try {
      const fresh = await getReport(apiFetch, latestReport.id)
      setActiveReport(fresh)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  const handleFileChosen = async (file: File) => {
    if (!credentials) return
    const text = await file.text()
    const rows = parseUsageCsv(text)
    const aggregated = aggregateAicByUser(rows)
    const cached: CachedReport = {
      enterprise: credentials.ent,
      monthKey: toMonthKey(month),
      reportId: activeReport?.id ?? null,
      ingestedAt: Date.now(),
      source: pendingSource,
      rows: aggregated,
    }
    saveCachedReport(cached)
    onIngested(cached)
    toast.success(
      `Ingested ${aggregated.length.toLocaleString()} users from ${rows.length.toLocaleString()} usage rows.`,
    )
    setPendingSource('uploaded')
  }

  // Cooldown derivation from the live API list, not localStorage.
  // (Falls back to "no cooldown" if /reports errored.)
  const lastGeneratedAt = latestReport ? Date.parse(latestReport.created_at) : null
  const cooldownRemainingMs =
    lastGeneratedAt && Number.isFinite(lastGeneratedAt) && nowTick > 0
      ? Math.max(0, lastGeneratedAt + ONE_HOUR_MS - nowTick)
      : 0
  const generateDisabled = creating || polling || cooldownRemainingMs > 0
  const generateTooltip =
    cooldownRemainingMs > 0 && lastGeneratedAt
      ? `Last report generated ${formatRelative(lastGeneratedAt)}; next available in ${formatCountdown(cooldownRemainingMs)}.`
      : creating
        ? 'Creating report…'
        : polling
          ? 'Report generation in progress…'
          : undefined

  const showDownloadCta =
    activeReport?.status === 'completed' && (activeReport.download_urls?.length ?? 0) > 0
  const showLatestPanel = Boolean(
    latestReport &&
      latestReport.status === 'completed' &&
      (!activeReport || activeReport.id !== latestReport.id) &&
      lastGeneratedAt !== null &&
      nowTick > 0 &&
      nowTick - lastGeneratedAt < ONE_HOUR_MS,
  )

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base font-semibold">Usage report</CardTitle>
          {cached ? (
            <div className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
              <CheckCircle size={14} weight="duotone" className="text-emerald-600" />
              Last ingested {formatRelative(cached.ingestedAt)} · {cached.source.replace(/-/g, ' ')}
            </div>
          ) : null}
        </div>
        <p className="text-xs text-neutral-500">
          Generate or upload a detailed billing report to populate per-user AI-credit consumption
          for {month.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}.
        </p>
      </CardHeader>
      <CardContent className="grid gap-3">
        {/* Hidden file picker, triggered from any of the three flows. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void handleFileChosen(f)
            e.target.value = ''
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setPendingSource('uploaded')
              fileInputRef.current?.click()
            }}
          >
            <FileArrowUp size={14} weight="duotone" />
            Upload CSV
          </Button>
          {showLatestPanel ? (
            <Button size="sm" variant="outline" onClick={handleUseLatest}>
              <Clock size={14} weight="duotone" />
              Use latest report ({formatRelative(lastGeneratedAt!)})
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={generateDisabled}
            title={generateTooltip}
          >
            <ArrowsClockwise size={14} weight="duotone" />
            {creating
              ? 'Queuing…'
              : polling
                ? 'Generating…'
                : cooldownRemainingMs > 0
                  ? `Generate (cooldown ${formatCountdown(cooldownRemainingMs)})`
                  : 'Generate new report'}
          </Button>
        </div>

        {reportListError ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Couldn't check existing reports ({reportListError.slice(0, 120)}). Generation cooldown
            is not enforced.
          </p>
        ) : null}

        {activeReport ? (
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-neutral-700 dark:text-neutral-200">
                Report <code className="text-xs">{activeReport.id}</code>
                <span className="ml-2 text-xs text-neutral-500">
                  status: {activeReport.status}
                </span>
              </div>
              {showDownloadCta ? (
                <a
                  href={activeReport.download_urls![0]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 h-8 text-xs font-medium text-emerald-900 dark:text-emerald-100 hover:bg-emerald-100 dark:hover:bg-emerald-950/60"
                >
                  <ArrowSquareOut size={14} weight="duotone" />
                  Download CSV
                </a>
              ) : null}
            </div>
            {showDownloadCta ? (
              <p className="mt-2 text-xs text-neutral-500">
                The download link is a temporary URL that expires in about 1 hour. Save the file,
                then click <strong>Upload CSV</strong> above to ingest it.
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
