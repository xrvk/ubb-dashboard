/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  createApiFetch,
  fetchUserBudgets,
  parseEnterpriseUrl,
  type ApiFetch,
  type Credentials,
  type UserBudget,
} from '@/lib/api'

interface CredentialsContextValue {
  credentials: Credentials | null
  budgets: UserBudget[]
  loading: boolean
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiFetch = useMemo(
    () => (credentials ? createApiFetch(credentials) : null),
    [credentials],
  )

  const refresh = useCallback(async () => {
    if (!apiFetch) return
    setLoading(true)
    setError(null)
    try {
      const list = await fetchUserBudgets(apiFetch)
      setBudgets(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [apiFetch])

  const connect = useCallback(async (enterpriseUrl: string, token: string) => {
    const parsed = parseEnterpriseUrl(enterpriseUrl)
    if (!parsed) {
      setError('Invalid enterprise URL. Expected e.g. https://github.com/enterprises/your-slug')
      return
    }
    const creds: Credentials = { base: parsed.base, ent: parsed.ent, token }
    setLoading(true)
    setError(null)
    try {
      const list = await fetchUserBudgets(createApiFetch(creds))
      setCredentials(creds)
      setBudgets(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setCredentials(null)
    setBudgets([])
    setError(null)
  }, [])

  // Dev auto-connect from .env.local (runs at most once)
  const autoConnectRef = useRef(false)
  useEffect(() => {
    if (autoConnectRef.current || credentials) return
    const url = import.meta.env.VITE_DEV_ENTERPRISE_URL as string | undefined
    const token = import.meta.env.VITE_DEV_PAT as string | undefined
    if (url && token) {
      autoConnectRef.current = true
      // Defer to break out of the synchronous effect call chain so setState
      // doesn't happen during the effect's microtask.
      void Promise.resolve().then(() => connect(url, token))
    }
  }, [connect, credentials])

  const value: CredentialsContextValue = {
    credentials,
    budgets,
    loading,
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
