import { mapWithConcurrency } from '@/lib/concurrency'
/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  buildCostCenterIndex,
  createApiFetch,
  fetchAllAiCreditsBudgets,
  fetchAllCopilotSeats,
  fetchCopilotUsageSummary,
  fetchCostCenters,
  parseEnterpriseUrl,
  resolveCostCenter,
  type ApiFetch,
  type CopilotSeat,
  type CopilotUsageSummary,
  type CostCenter,
  type CostCenterBudget,
  type CostCenterResolution,
  type Credentials,
  type EnterpriseBudget,
  type UniversalUbb,
  type UserBudget,
} from '@/lib/api'
import {
  generateDemoBudgets,
  generateDemoCachedReports,
  generateDemoCostCenterBudgets,
  generateDemoCostCenters,
  generateDemoEnterpriseBudget,
  generateDemoSeats,
  generateDemoUniversalUbb,
  generateDemoUsageByCostCenter,
  generateDemoUsageSummary,
  readDemoCcCountFromUrl,
  readDemoCountFromUrl,
  readDemoExcludeCcFromUrl,
  readDemoPoolPctFromUrl,
  scaleDemoConsumptionTo,
} from '@/lib/demo'
import { saveCachedReport } from '@/lib/reportCache'
import { includedAiCredits, seatCostBreakdown } from '@/lib/pricing'
import { describeError, isAborted } from '@/lib/errors'

export type PartialLoadFeature = 'cost-centers' | 'seats' | 'usage-summary'

export interface PartialLoadWarning {
  feature: PartialLoadFeature
  /** Short label suitable for a banner heading. */
  label: string
  /** Human-readable explanation from describeError. */
  reason: string
  /** Optional suggested action (e.g. "Add manage_billing:enterprise scope"). */
  suggestedAction?: string
}

const FEATURE_LABEL: Record<PartialLoadFeature, string> = {
  'cost-centers': 'Cost center attribution',
  seats: 'Copilot seats',
  'usage-summary': 'Billing usage summary',
}

/** Run a secondary fetch; on failure return [fallback, warning]. */
async function loadWithWarning<T>(
  feature: PartialLoadFeature,
  fallback: T,
  fetch: () => Promise<T>,
): Promise<[T, PartialLoadWarning | null]> {
  try {
    return [await fetch(), null]
  } catch (e) {
    if (isAborted(e)) return [fallback, null]
    const desc = describeError(e, `load:${feature}`)
    return [
      fallback,
      {
        feature,
        label: FEATURE_LABEL[feature],
        reason: desc.body,
        suggestedAction: desc.suggestedAction,
      },
    ]
  }
}

interface CredentialsContextValue {
  credentials: Credentials | null
  budgets: UserBudget[]
  totalBudgetCount: number
  seats: CopilotSeat[]
  costCenters: CostCenter[]
  /** Universal UBB (multi_user_customer scope) or null if not configured. */
  universalUbb: UniversalUbb | null
  setUniversalUbb: (u: UniversalUbb | null) => void
  /**
   * Local mutation of the budgets array. Exposed so demo-mode "apply" actions
   * can mirror real API mutations into the in-memory store without hitting
   * github.com. Real (non-demo) callers should keep using the API + refresh()
   * cycle; this setter exists for sandbox flows only.
   */
  setBudgets: Dispatch<SetStateAction<UserBudget[]>>
  /** Enterprise-scope ai_credits budget or null if not configured. */
  enterpriseBudget: EnterpriseBudget | null
  /** Cost-center-scope ai_credits budgets, keyed by lowercased CC name. */
  costCenterBudgetsByName: ReadonlyMap<string, CostCenterBudget>
  /**
   * Enterprise-wide Copilot billing usage summary for the current month, or
   * `null` if not yet loaded / unavailable. Best-effort: a 403 (no enhanced
   * billing access) leaves it null.
   */
  usageSummary: CopilotUsageSummary | null
  /**
   * Per-cost-center billing usage for the current month, keyed by cost
   * center id. Populated after the initial load by issuing one
   * `fetchCopilotUsageSummary({ costCenterId })` per CC in parallel. CCs
   * whose fetch failed are absent from the map (caller should treat as
   * unknown / show "—"). This is the authoritative per-CC MTD source —
   * it covers individual UBB, universal UBB, and org-routed seats alike,
   * unlike the user-budgets API which only reports individual-UBB users.
   */
  usageByCostCenterId: ReadonlyMap<string, CopilotUsageSummary>
  /**
   * Lowercased-login → resolved CC (or null if unassigned).
   * Built from seats × cost-center index per the cost-center allocation docs:
   * user-direct membership > org-inherited > null. Budget rows look up their
   * login here without needing to know about the indexer.
   */
  loginToCostCenter: Map<string, CostCenterResolution | null>
  loading: boolean
  loadProgress: { loaded: number; total: number | undefined } | null
  error: string | null
  /**
   * Non-fatal warnings from the most recent connect/refresh. Each entry
   * represents a secondary feature that failed to load (e.g. cost centers).
   * The dashboard renders a collapsible banner from this. Empty array means
   * the load was fully successful.
   */
  partialLoadWarnings: PartialLoadWarning[]
  /** Dismiss a single partial-load warning. */
  dismissPartialLoadWarning: (feature: PartialLoadFeature) => void
  apiFetch: ApiFetch | null
  connect: (enterpriseUrl: string, token: string) => Promise<void>
  disconnect: () => void
  refresh: () => Promise<void>
  /** Dev-only: extra `.env.*.local` profiles for the connection menu's quick-switch. Empty in production. */
  devProfiles: ReadonlyArray<{ name: string; url: string; token: string }>
  /** Dev-only: disconnect, then connect with the given profile's credentials. */
  switchProfile: (profile: { url: string; token: string }) => Promise<void>
}

const Ctx = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [budgets, setBudgets] = useState<UserBudget[]>([])
  const [totalBudgetCount, setTotalBudgetCount] = useState(0)
  const [seats, setSeats] = useState<CopilotSeat[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [universalUbb, setUniversalUbb] = useState<UniversalUbb | null>(null)
  const [enterpriseBudget, setEnterpriseBudget] = useState<EnterpriseBudget | null>(null)
  const [costCenterBudgetsByName, setCostCenterBudgetsByName] = useState<ReadonlyMap<string, CostCenterBudget>>(
    new Map(),
  )
  const [usageSummary, setUsageSummary] = useState<CopilotUsageSummary | null>(null)
  const [usageByCostCenterId, setUsageByCostCenterId] = useState<ReadonlyMap<string, CopilotUsageSummary>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number | undefined } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [devProfiles, setDevProfiles] = useState<ReadonlyArray<{ name: string; url: string; token: string }>>([])
  const [partialLoadWarnings, setPartialLoadWarnings] = useState<PartialLoadWarning[]>([])
  // Features the user has explicitly dismissed. Persists across `refresh()`
  // so a permanent condition (e.g. missing scope) doesn't keep re-surfacing
  // the same banner after every reload. Cleared on `connect`/`disconnect`
  // when the underlying credentials change.
  const dismissedFeaturesRef = useRef<Set<PartialLoadFeature>>(new Set())

  const dismissPartialLoadWarning = useCallback((feature: PartialLoadFeature) => {
    dismissedFeaturesRef.current.add(feature)
    setPartialLoadWarnings(prev => prev.filter(w => w.feature !== feature))
  }, [])

  /** Filter out warnings the user has already dismissed this session. */
  const applyWarnings = useCallback((warnings: PartialLoadWarning[]) => {
    setPartialLoadWarnings(warnings.filter(w => !dismissedFeaturesRef.current.has(w.feature)))
  }, [])

  // Fetch dev profiles from the Vite middleware. Only attempted in dev
  // (the endpoint doesn't exist in production builds). Failures are
  // silently swallowed — profiles are a developer convenience.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    void fetch('/__dev_profiles')
      .then(r => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setDevProfiles(
            data.filter(
              (p): p is { name: string; url: string; token: string } =>
                !!p && typeof (p as { name?: unknown }).name === 'string' &&
                typeof (p as { url?: unknown }).url === 'string' &&
                typeof (p as { token?: unknown }).token === 'string',
            ),
          )
        }
      })
      .catch(() => {})
  }, [])

  const apiFetch = useMemo(
    // Demo mode uses a sentinel base (`demo://`) and never makes real HTTP
    // calls, so it must skip the host-allowlisted createApiFetch (which would
    // (correctly) reject the sentinel as not-https).
    () => (credentials && credentials.base !== 'demo://' ? createApiFetch(credentials) : null),
    [credentials],
  )

  const refresh = useCallback(async () => {
    if (credentials?.base === 'demo://') {
      const demoCount = readDemoCountFromUrl() ?? 0
      const demoBudgets = generateDemoBudgets(demoCount, Math.floor(Math.random() * 100_000))
      const demoCcCount = readDemoCcCountFromUrl() ?? undefined
      const demoSeats = generateDemoSeats(demoCount, demoCcCount)
      const universal = generateDemoUniversalUbb(demoBudgets)
      const poolPct = readDemoPoolPctFromUrl()
      if (poolPct !== null) {
        const cost = seatCostBreakdown(demoSeats)
        const credits = includedAiCredits(cost.business, cost.enterprise)
        scaleDemoConsumptionTo((poolPct / 100) * credits.totalDollars, demoBudgets, universal)
      }
      setBudgets(demoBudgets)
      setTotalBudgetCount(demoBudgets.length)
      setSeats(demoSeats)
      const demoCcs = generateDemoCostCenters(demoCount, demoCcCount)
      setCostCenters(demoCcs)
      setUniversalUbb(universal)
      setEnterpriseBudget(generateDemoEnterpriseBudget())
      setCostCenterBudgetsByName(generateDemoCostCenterBudgets(demoCcs))
      setUsageSummary(
        generateDemoUsageSummary(demoBudgets, {
          poolExhausted: poolPct === null ? true : poolPct >= 100,
        }),
      )
      for (const report of generateDemoCachedReports(credentials.ent, demoSeats)) {
        saveCachedReport(report)
      }
      return
    }
    if (!apiFetch) return
    setLoading(true)
    setLoadProgress({ loaded: 0, total: undefined })
    setError(null)
    setPartialLoadWarnings([])
    try {
      const [allBudgets, seatResult, ccResult, summaryResult] = await Promise.all([
        fetchAllAiCreditsBudgets(apiFetch, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        loadWithWarning<CopilotSeat[]>('seats', [], () => fetchAllCopilotSeats(apiFetch)),
        loadWithWarning<CostCenter[]>('cost-centers', [], () => fetchCostCenters(apiFetch)),
        loadWithWarning<CopilotUsageSummary | null>('usage-summary', null, () =>
          fetchCopilotUsageSummary(apiFetch),
        ),
      ])
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatResult[0])
      setCostCenters(ccResult[0])
      setUniversalUbb(allBudgets.universal)
      setEnterpriseBudget(allBudgets.enterprise)
      setCostCenterBudgetsByName(allBudgets.costCenterBudgetsByName)
      setUsageSummary(summaryResult[0])
      applyWarnings(
        [seatResult[1], ccResult[1], summaryResult[1]].filter(
          (w): w is PartialLoadWarning => w !== null,
        ),
      )
    } catch (e) {
      setError(describeError(e, 'refresh').body)
    } finally {
      setLoading(false)
      setLoadProgress(null)
    }
  }, [apiFetch, credentials, applyWarnings])

  const connect = useCallback(async (enterpriseUrl: string, token: string) => {
    const parsed = parseEnterpriseUrl(enterpriseUrl)
    if (!parsed) {
      setError('Invalid enterprise URL. Expected e.g. https://github.com/enterprises/your-slug')
      return
    }
    const creds: Credentials = { base: parsed.base, ent: parsed.ent, token }
    setLoading(true)
    setLoadProgress({ loaded: 0, total: undefined })
    setError(null)
    // Fresh credentials = fresh dismissals.
    dismissedFeaturesRef.current = new Set()
    setPartialLoadWarnings([])
    try {
      const fetcher = createApiFetch(creds)
      const [allBudgets, seatResult, ccResult, summaryResult] = await Promise.all([
        fetchAllAiCreditsBudgets(fetcher, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        loadWithWarning<CopilotSeat[]>('seats', [], () => fetchAllCopilotSeats(fetcher)),
        loadWithWarning<CostCenter[]>('cost-centers', [], () => fetchCostCenters(fetcher)),
        loadWithWarning<CopilotUsageSummary | null>('usage-summary', null, () =>
          fetchCopilotUsageSummary(fetcher),
        ),
      ])
      setCredentials(creds)
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatResult[0])
      setCostCenters(ccResult[0])
      setUniversalUbb(allBudgets.universal)
      setEnterpriseBudget(allBudgets.enterprise)
      setCostCenterBudgetsByName(allBudgets.costCenterBudgetsByName)
      setUsageSummary(summaryResult[0])
      applyWarnings(
        [seatResult[1], ccResult[1], summaryResult[1]].filter(
          (w): w is PartialLoadWarning => w !== null,
        ),
      )
    } catch (e) {
      setError(describeError(e, 'connect').body)
    } finally {
      setLoading(false)
      setLoadProgress(null)
    }
  }, [applyWarnings])

  const disconnect = useCallback(() => {
    setCredentials(null)
    setBudgets([])
    setTotalBudgetCount(0)
    setSeats([])
    setCostCenters([])
    setUniversalUbb(null)
    setEnterpriseBudget(null)
    setCostCenterBudgetsByName(new Map())
    setUsageSummary(null)
    setUsageByCostCenterId(new Map())
    setError(null)
    dismissedFeaturesRef.current = new Set()
    setPartialLoadWarnings([])
  }, [])

  const switchProfile = useCallback(async (profile: { url: string; token: string }) => {
    disconnect()
    await connect(profile.url, profile.token)
  }, [connect, disconnect])

  // Dev auto-connect from .env.local (runs at most once)
  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (autoConnectRef.current || credentials) return
    // Demo mode via ?demo=N query param bypasses the API entirely
    const demoCount = readDemoCountFromUrl()
    if (demoCount !== null) {
      autoConnectRef.current = true
      void Promise.resolve().then(() => {
        setCredentials({ base: 'demo://', ent: `demo-${demoCount}`, token: 'demo' })
        const demoBudgets = generateDemoBudgets(demoCount)
        const demoCcCount = readDemoCcCountFromUrl() ?? undefined
        const demoSeats = generateDemoSeats(demoCount, demoCcCount)
        const universal = generateDemoUniversalUbb(demoBudgets)
        const poolPct = readDemoPoolPctFromUrl()
        if (poolPct !== null) {
          const cost = seatCostBreakdown(demoSeats)
          const credits = includedAiCredits(cost.business, cost.enterprise)
          scaleDemoConsumptionTo((poolPct / 100) * credits.totalDollars, demoBudgets, universal)
        }
        setBudgets(demoBudgets)
        setTotalBudgetCount(demoBudgets.length)
        setSeats(demoSeats)
        const demoCcs = generateDemoCostCenters(demoCount, demoCcCount)
        setCostCenters(demoCcs)
        setUniversalUbb(universal)
        setEnterpriseBudget(generateDemoEnterpriseBudget({ excludeCostCenterUsage: readDemoExcludeCcFromUrl() }))
        setCostCenterBudgetsByName(generateDemoCostCenterBudgets(demoCcs))
        setUsageSummary(
          generateDemoUsageSummary(demoBudgets, {
            poolExhausted: poolPct === null ? true : poolPct >= 100,
          }),
        )
        for (const report of generateDemoCachedReports(`demo-${demoCount}`, demoSeats)) {
          saveCachedReport(report)
        }
      })
      return
    }
    // Auto-connect from `.env.local` is a developer convenience and must
    // never run in a production build — Vite would otherwise inline the
    // PAT into the bundle. Gating on `import.meta.env.DEV` (a compile-time
    // boolean literal) lets the bundler dead-code-eliminate this branch in
    // production, stripping the env reads with it.
    if (import.meta.env.DEV) {
      const url = import.meta.env.VITE_DEV_ENTERPRISE_URL as string | undefined
      const token = import.meta.env.VITE_DEV_PAT as string | undefined
      if (url && token) {
        autoConnectRef.current = true
        void Promise.resolve().then(() => connect(url, token))
      }
    }
  }, [connect, credentials])

  // Build login→CC resolution lazily from seats + cost centers. Seats carry
  // the org that granted each user's Copilot license, which is the priority-2
  // fallback per the cost-center allocation docs.
  const loginToCostCenter = useMemo(() => {
    const map = new Map<string, CostCenterResolution | null>()
    if (costCenters.length === 0) return map
    const index = buildCostCenterIndex(costCenters, costCenterBudgetsByName)
    for (const s of seats) {
      map.set(s.login.toLowerCase(), resolveCostCenter(s.login, s.orgLogin, index))
    }
    return map
  }, [seats, costCenters, costCenterBudgetsByName])

  // Per-CC seat counts, used both by the dashboard and to proportion demo
  // usage across CCs. Built from the same login→CC resolution.
  const ccSeatCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const res of loginToCostCenter.values()) {
      if (!res?.cc) continue
      counts.set(res.cc.id, (counts.get(res.cc.id) ?? 0) + 1)
    }
    return counts
  }, [loginToCostCenter])

  // Fetch (or synthesize) per-CC billing usage whenever the CC list changes.
  // Real mode: one `fetchCopilotUsageSummary({ costCenterId })` per CC in
  // parallel; failures degrade per-CC to a missing map entry. Demo mode:
  // distribute the top-line aiCreditsNet proportional to seat share.
  //
  // The synchronous resets below are intentional guards (no CCs, no usage
  // summary in demo, no apiFetch). Refactoring to useMemo would lose the
  // async-fetch path, so disable the rule for this effect.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (costCenters.length === 0) {
      setUsageByCostCenterId(new Map())
      return
    }
    if (credentials?.base === 'demo://') {
      if (!usageSummary) {
        setUsageByCostCenterId(new Map())
        return
      }
      setUsageByCostCenterId(
        generateDemoUsageByCostCenter(costCenters, ccSeatCounts, usageSummary),
      )
      return
    }
    if (!apiFetch) {
      setUsageByCostCenterId(new Map())
      return
    }
    let cancelled = false
    // Bounded fan-out: one /usage/summary call per CC. At 1k CCs an
    // unbounded `Promise.all` would issue 1,000 parallel reads and trip
    // GitHub's secondary rate limits — we cap at 8 concurrent (same as
    // `fetchPagesInParallel` for paged endpoints).
    void mapWithConcurrency(costCenters, 8, cc =>
      fetchCopilotUsageSummary(apiFetch, { costCenterId: cc.id })
        .then(s => [cc.id, s] as const)
        .catch(() => null),
    ).then(results => {
      if (cancelled) return
      const map = new Map<string, CopilotUsageSummary>()
      for (const entry of results) if (entry) map.set(entry[0], entry[1])
      setUsageByCostCenterId(map)
    })
    return () => {
      cancelled = true
    }
  }, [credentials, apiFetch, costCenters, ccSeatCounts, usageSummary])
  /* eslint-enable react-hooks/set-state-in-effect */

  const value: CredentialsContextValue = {
    credentials,
    budgets,
    totalBudgetCount,
    seats,
    costCenters,
    loginToCostCenter,
    universalUbb,
    setUniversalUbb,
    setBudgets,
    enterpriseBudget,
    costCenterBudgetsByName,
    usageSummary,
    usageByCostCenterId,
    loading,
    loadProgress,
    error,
    partialLoadWarnings,
    dismissPartialLoadWarning,
    apiFetch,
    connect,
    disconnect,
    refresh,
    devProfiles,
    switchProfile,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCredentials(): CredentialsContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCredentials must be used inside CredentialsProvider')
  return v
}
