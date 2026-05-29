/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createApiFetch,
  fetchAllCopilotSeats,
  fetchUserBudgets,
  parseEnterpriseUrl,
  type ApiFetch,
  type CopilotSeat,
  type Credentials,
  type UserBudget,
} from '@/lib/api'
import { generateDemoBudgets, generateDemoSeats, readDemoCountFromUrl } from '@/lib/demo'

interface CredentialsContextValue {
  credentials: Credentials | null
  budgets: UserBudget[]
  totalBudgetCount: number
  seats: CopilotSeat[]
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
      return
    }
    if (!apiFetch) return
    setLoading(true)
    setLoadProgress({ loaded: 0, total: undefined })
    setError(null)
    try {
      const [result, seatList] = await Promise.all([
        fetchUserBudgets(apiFetch, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        fetchAllCopilotSeats(apiFetch).catch(() => [] as CopilotSeat[]),
      ])
      setBudgets(result.userBudgets)
      setTotalBudgetCount(result.totalBudgetCount)
      setSeats(seatList)
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
      const [result, seatList] = await Promise.all([
        fetchUserBudgets(fetcher, (loaded, total) =>
          setLoadProgress({ loaded, total }),
        ),
        fetchAllCopilotSeats(fetcher).catch(() => [] as CopilotSeat[]),
      ])
      setCredentials(creds)
      setBudgets(result.userBudgets)
      setTotalBudgetCount(result.totalBudgetCount)
      setSeats(seatList)
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

  const value: CredentialsContextValue = {
    credentials,
    budgets,
    totalBudgetCount,
    seats,
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
