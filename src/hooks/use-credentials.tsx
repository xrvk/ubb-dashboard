/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  buildCostCenterIndex,
  createApiFetch,
  fetchAllAiCreditsBudgets,
  fetchAllCopilotSeats,
  fetchCostCenters,
  parseEnterpriseUrl,
  resolveCostCenter,
  type ApiFetch,
  type CopilotSeat,
  type CostCenter,
  type CostCenterBudget,
  type CostCenterResolution,
  type Credentials,
  type EnterpriseBudget,
  type UniversalUlb,
  type UserBudget,
} from '@/lib/api'
import { generateDemoBudgets, generateDemoSeats, readDemoCountFromUrl } from '@/lib/demo'

interface CredentialsContextValue {
  credentials: Credentials | null
  budgets: UserBudget[]
  totalBudgetCount: number
  seats: CopilotSeat[]
  costCenters: CostCenter[]
  /** Universal ULB (multi_user_customer scope) or null if not configured. */
  universalUlb: UniversalUlb | null
  setUniversalUlb: (u: UniversalUlb | null) => void
  /** Enterprise-scope ai_credits budget or null if not configured. */
  enterpriseBudget: EnterpriseBudget | null
  /** Cost-center-scope ai_credits budgets, keyed by lowercased CC name. */
  costCenterBudgetsByName: ReadonlyMap<string, CostCenterBudget>
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
  apiFetch: ApiFetch | null
  connect: (enterpriseUrl: string, token: string) => Promise<void>
  disconnect: () => void
  refresh: () => Promise<void>
}

const Ctx = createContext<CredentialsContextValue | null>(null)

export function CredentialsProvider({ children }: { children: ReactNode }) {
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [budgets, setBudgets] = useState<UserBudget[]>([])
  const [totalBudgetCount, setTotalBudgetCount] = useState(0)
  const [seats, setSeats] = useState<CopilotSeat[]>([])
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [universalUlb, setUniversalUlb] = useState<UniversalUlb | null>(null)
  const [enterpriseBudget, setEnterpriseBudget] = useState<EnterpriseBudget | null>(null)
  const [costCenterBudgetsByName, setCostCenterBudgetsByName] = useState<ReadonlyMap<string, CostCenterBudget>>(
    new Map(),
  )
  const [loading, setLoading] = useState(false)
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number | undefined } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const apiFetch = useMemo(
    () => (credentials ? createApiFetch(credentials) : null),
    [credentials],
  )

  const refresh = useCallback(async () => {
    if (credentials?.base === 'demo://') {
      const demoCount = readDemoCountFromUrl() ?? 0
      const demoBudgets = generateDemoBudgets(demoCount, Math.floor(Math.random() * 100_000))
      setBudgets(demoBudgets)
      setTotalBudgetCount(demoBudgets.length)
      setSeats(generateDemoSeats(demoCount))
      setCostCenters([])
      setUniversalUlb(null)
      setEnterpriseBudget(null)
      setCostCenterBudgetsByName(new Map())
      return
    }
    if (!apiFetch) return
    setLoading(true)
    setLoadProgress({ loaded: 0, total: undefined })
    setError(null)
    try {
      const [allBudgets, seatList, ccList] = await Promise.all([
        fetchAllAiCreditsBudgets(apiFetch, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        fetchAllCopilotSeats(apiFetch).catch(() => [] as CopilotSeat[]),
        fetchCostCenters(apiFetch).catch(() => [] as CostCenter[]),
      ])
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatList)
      setCostCenters(ccList)
      setUniversalUlb(allBudgets.universal)
      setEnterpriseBudget(allBudgets.enterprise)
      setCostCenterBudgetsByName(allBudgets.costCenterBudgetsByName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setLoadProgress(null)
    }
  }, [apiFetch, credentials])

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
    try {
      const fetcher = createApiFetch(creds)
      const [allBudgets, seatList, ccList] = await Promise.all([
        fetchAllAiCreditsBudgets(fetcher, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        fetchAllCopilotSeats(fetcher).catch(() => [] as CopilotSeat[]),
        fetchCostCenters(fetcher).catch(() => [] as CostCenter[]),
      ])
      setCredentials(creds)
      setBudgets(allBudgets.userBudgets)
      setTotalBudgetCount(allBudgets.totalBudgetCount)
      setSeats(seatList)
      setCostCenters(ccList)
      setUniversalUlb(allBudgets.universal)
      setEnterpriseBudget(allBudgets.enterprise)
      setCostCenterBudgetsByName(allBudgets.costCenterBudgetsByName)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setLoadProgress(null)
    }
  }, [])

  const disconnect = useCallback(() => {
    setCredentials(null)
    setBudgets([])
    setTotalBudgetCount(0)
    setSeats([])
    setCostCenters([])
    setUniversalUlb(null)
    setEnterpriseBudget(null)
    setCostCenterBudgetsByName(new Map())
    setError(null)
  }, [])

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
        setBudgets(demoBudgets)
        setTotalBudgetCount(demoBudgets.length)
        setSeats(generateDemoSeats(demoCount))
      })
      return
    }
    const url = import.meta.env.VITE_DEV_ENTERPRISE_URL as string | undefined
    const token = import.meta.env.VITE_DEV_PAT as string | undefined
    if (url && token) {
      autoConnectRef.current = true
      void Promise.resolve().then(() => connect(url, token))
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

  const value: CredentialsContextValue = {
    credentials,
    budgets,
    totalBudgetCount,
    seats,
    costCenters,
    loginToCostCenter,
    universalUlb,
    setUniversalUlb,
    enterpriseBudget,
    costCenterBudgetsByName,
    loading,
    loadProgress,
    error,
    apiFetch,
    connect,
    disconnect,
    refresh,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCredentials(): CredentialsContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useCredentials must be used inside CredentialsProvider')
  return v
}
