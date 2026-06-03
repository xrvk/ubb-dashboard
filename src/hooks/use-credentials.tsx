/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import {
  createApiFetch,
  fetchAllAiCreditsBudgets,
  fetchAllCopilotSeats,
  fetchCopilotUsageSummary,
  parseOrgUrl,
  type ApiFetch,
  type CopilotSeat,
  type CopilotUsageSummary,
  type Credentials,
  type OrgBudget,
  type UniversalUlb,
  type UserBudget,
} from '@/lib/api'
import {
  generateDemoBudgets,
  generateDemoCachedReports,
  generateDemoOrgBudget,
  generateDemoSeats,
  generateDemoUniversalUlb,
  generateDemoUsageSummary,
  readDemoCountFromUrl,
  readDemoPoolPctFromUrl,
  scaleDemoConsumptionTo,
} from '@/lib/demo'
import { saveCachedReport } from '@/lib/reportCache'
import { includedAiCredits, seatCostBreakdown } from '@/lib/pricing'
import { describeError, isAborted } from '@/lib/errors'

export type PartialLoadFeature = 'seats' | 'usage-summary'

export interface PartialLoadWarning {
  feature: PartialLoadFeature
  /** Short label suitable for a banner heading. */
  label: string
  /** Human-readable explanation from describeError. */
  reason: string
  /** Optional suggested action (e.g. "Add admin:org scope"). */
  suggestedAction?: string
}

const FEATURE_LABEL: Record<PartialLoadFeature, string> = {
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
  /** Universal ULB (multi_user_customer scope) or null if not configured. */
  universalUlb: UniversalUlb | null
  setUniversalUlb: (u: UniversalUlb | null) => void
  setBudgets: Dispatch<SetStateAction<UserBudget[]>>
  /** Organization-scope ai_credits budget or null if not configured. */
  orgBudget: OrgBudget | null
  setOrgBudget: Dispatch<SetStateAction<OrgBudget | null>>
  /**
   * Organization-wide Copilot billing usage summary for the current month, or
   * `null` if not yet loaded / unavailable.
   */
  usageSummary: CopilotUsageSummary | null
  loading: boolean
  loadProgress: { loaded: number; total: number | undefined } | null
  error: string | null
  partialLoadWarnings: PartialLoadWarning[]
  dismissPartialLoadWarning: (feature: PartialLoadFeature) => void
  apiFetch: ApiFetch | null
  connect: (orgUrl: string, token: string) => Promise<void>
  disconnect: () => void
  refresh: () => Promise<void>
  devProfiles: ReadonlyArray<{ name: string; url: string; token: string }>
  switchProfile: (profile: { url: string; token: string }) => Promise<void>
}

const Ctx = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [budgets, setBudgets] = useState<UserBudget[]>([])
  const [totalBudgetCount, setTotalBudgetCount] = useState(0)
  const [seats, setSeats] = useState<CopilotSeat[]>([])
  const [universalUlb, setUniversalUlb] = useState<UniversalUlb | null>(null)
  const [orgBudget, setOrgBudget] = useState<OrgBudget | null>(null)
  const [usageSummary, setUsageSummary] = useState<CopilotUsageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number | undefined } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [devProfiles, setDevProfiles] = useState<ReadonlyArray<{ name: string; url: string; token: string }>>([])
  const [partialLoadWarnings, setPartialLoadWarnings] = useState<PartialLoadWarning[]>([])
  const dismissedFeaturesRef = useRef<Set<PartialLoadFeature>>(new Set())

  const dismissPartialLoadWarning = useCallback((feature: PartialLoadFeature) => {
    dismissedFeaturesRef.current.add(feature)
    setPartialLoadWarnings(prev => prev.filter(w => w.feature !== feature))
  }, [])

  const applyWarnings = useCallback((warnings: PartialLoadWarning[]) => {
    setPartialLoadWarnings(warnings.filter(w => !dismissedFeaturesRef.current.has(w.feature)))
  }, [])

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
    () => (credentials && credentials.base !== 'demo://' ? createApiFetch(credentials) : null),
    [credentials],
  )

  const refresh = useCallback(async () => {
    if (credentials?.base === 'demo://') {
      const demoCount = readDemoCountFromUrl() ?? 0
      const demoBudgets = generateDemoBudgets(demoCount, Math.floor(Math.random() * 100_000))
      const demoSeats = generateDemoSeats(demoCount)
      const universal = generateDemoUniversalUlb(demoBudgets)
      const poolPct = readDemoPoolPctFromUrl()
      if (poolPct !== null) {
        const cost = seatCostBreakdown(demoSeats)
        const credits = includedAiCredits(cost.business, cost.enterprise)
        scaleDemoConsumptionTo((poolPct / 100) * credits.totalDollars, demoBudgets, universal)
      }
      setBudgets(demoBudgets)
      setTotalBudgetCount(demoBudgets.length)
      setSeats(demoSeats)
      setUniversalUlb(universal)
      setOrgBudget(generateDemoOrgBudget())
      setUsageSummary(
        generateDemoUsageSummary(demoBudgets, {
          poolExhausted: poolPct === null ? true : poolPct >= 100,
        }),
      )
      for (const report of generateDemoCachedReports(credentials.org, demoSeats)) {
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
      const [allBudgets, seatResult, summaryResult] = await Promise.all([
        fetchAllAiCreditsBudgets(apiFetch, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        loadWithWarning<CopilotSeat[]>('seats', [], () => fetchAllCopilotSeats(apiFetch)),
        loadWithWarning<CopilotUsageSummary | null>('usage-summary', null, () =>
          fetchCopilotUsageSummary(apiFetch),
        ),
      ])
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatResult[0])
      setUniversalUlb(allBudgets.universal)
      setOrgBudget(allBudgets.org)
      setUsageSummary(summaryResult[0])
      applyWarnings(
        [seatResult[1], summaryResult[1]].filter(
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

  const connect = useCallback(async (orgUrl: string, token: string) => {
    const parsed = parseOrgUrl(orgUrl)
    if (!parsed) {
      setError(
        'Invalid organization URL. Expected e.g. https://github.com/your-org or the bare slug "your-org".',
      )
      return
    }
    const creds: Credentials = { base: parsed.base, org: parsed.org, token }
    setLoading(true)
    setLoadProgress({ loaded: 0, total: undefined })
    setError(null)
    dismissedFeaturesRef.current = new Set()
    setPartialLoadWarnings([])
    try {
      const fetcher = createApiFetch(creds)
      const [allBudgets, seatResult, summaryResult] = await Promise.all([
        fetchAllAiCreditsBudgets(fetcher, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        loadWithWarning<CopilotSeat[]>('seats', [], () => fetchAllCopilotSeats(fetcher)),
        loadWithWarning<CopilotUsageSummary | null>('usage-summary', null, () =>
          fetchCopilotUsageSummary(fetcher),
        ),
      ])
      setCredentials(creds)
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatResult[0])
      setUniversalUlb(allBudgets.universal)
      setOrgBudget(allBudgets.org)
      setUsageSummary(summaryResult[0])
      applyWarnings(
        [seatResult[1], summaryResult[1]].filter(
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
    setUniversalUlb(null)
    setOrgBudget(null)
    setUsageSummary(null)
    setError(null)
    dismissedFeaturesRef.current = new Set()
    setPartialLoadWarnings([])
  }, [])

  const switchProfile = useCallback(async (profile: { url: string; token: string }) => {
    disconnect()
    await connect(profile.url, profile.token)
  }, [connect, disconnect])

  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (autoConnectRef.current || credentials) return
    const demoCount = readDemoCountFromUrl()
    if (demoCount !== null) {
      autoConnectRef.current = true
      void Promise.resolve().then(() => {
        setCredentials({ base: 'demo://', org: `demo-${demoCount}`, token: 'demo' })
        const demoBudgets = generateDemoBudgets(demoCount)
        const demoSeats = generateDemoSeats(demoCount)
        const universal = generateDemoUniversalUlb(demoBudgets)
        const poolPct = readDemoPoolPctFromUrl()
        if (poolPct !== null) {
          const cost = seatCostBreakdown(demoSeats)
          const credits = includedAiCredits(cost.business, cost.enterprise)
          scaleDemoConsumptionTo((poolPct / 100) * credits.totalDollars, demoBudgets, universal)
        }
        setBudgets(demoBudgets)
        setTotalBudgetCount(demoBudgets.length)
        setSeats(demoSeats)
        setUniversalUlb(universal)
        setOrgBudget(generateDemoOrgBudget())
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
    if (import.meta.env.DEV) {
      const url = import.meta.env.VITE_DEV_ORG_URL as string | undefined
      const token = import.meta.env.VITE_DEV_PAT as string | undefined
      if (url && token) {
        autoConnectRef.current = true
        void Promise.resolve().then(() => connect(url, token))
      }
    }
  }, [connect, credentials])

  const value: CredentialsContextValue = {
    credentials,
    budgets,
    totalBudgetCount,
    seats,
    universalUlb,
    setUniversalUlb,
    setBudgets,
    orgBudget,
    setOrgBudget,
    usageSummary,
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
