import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ApiError,
  AuthError,
  ScopeError,
  NotFoundError,
  ValidationError,
  ServerError,
  NetworkError,
  AbortedError,
} from '@/lib/errors'
import {
  _resetRateLimitCache,
  buildCostCenterIndex,
  createApiFetch,
  fetchAllCopilotSeats,
  fetchCostCenters,
  fetchUserBudgets,
  getLastKnownRateLimit,
  isPrimaryRateLimitExhausted,
  resolveCostCenter,
  type ApiFetch,
  type CostCenter,
  type RawBudget,
} from '@/lib/api'

function fakeBudget(i: number, scope: 'user' | 'enterprise' = 'user'): RawBudget {
  return {
    id: `b${i}`,
    budget_type: 'BundlePricing',
    budget_product_sku: 'ai_credits',
    budget_scope: scope,
    budget_amount: 10,
    prevent_further_usage: true,
    budget_entity_name: `user${i}`,
    budget_alerting: { will_alert: false, alert_recipients: [] },
    consumed_amount: 0,
    user: `user${i}`,
  }
}

describe('fetchUserBudgets pagination', () => {
  it('pages through the full list when the API returns 10 per page (10k budgets)', async () => {
    const TOTAL = 10_000
    const PAGE_SIZE = 10 // server-side cap
    // 9 of every 10 are user-scope, 1 is enterprise (just to vary)
    const all: RawBudget[] = []
    for (let i = 0; i < TOTAL; i += 1) {
      all.push(fakeBudget(i, i % 10 === 0 ? 'enterprise' : 'user'))
    }
    const fetchMock: ApiFetch = vi.fn(async path => {
      const m = String(path).match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      const start = (page - 1) * PAGE_SIZE
      return {
        total_count: TOTAL,
        budgets: all.slice(start, start + PAGE_SIZE),
      }
    })

    const progress: Array<[number, number | undefined]> = []
    const result = await fetchUserBudgets(fetchMock, (loaded, total) => progress.push([loaded, total]))

    // 10k total / 10 per page = 1000 calls
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL / PAGE_SIZE)
    // 9 of every 10 are user-scope
    expect(result.userBudgets).toHaveLength(TOTAL * 0.9)
    // Total budget count reflects the API's total_count (all scopes/types)
    expect(result.totalBudgetCount).toBe(TOTAL)
    // Progress was reported
    expect(progress[progress.length - 1]).toEqual([TOTAL, TOTAL])
  })

  it('stops at total_count even if it is hit before an empty page', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      total_count: 5,
      budgets: [fakeBudget(1), fakeBudget(2), fakeBudget(3), fakeBudget(4), fakeBudget(5)],
    }))
    const result = await fetchUserBudgets(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.userBudgets).toHaveLength(5)
    expect(result.totalBudgetCount).toBe(5)
  })

  it('preserves page order when pages 2..N return out of order (parallel fetch)', async () => {
    const TOTAL = 50
    const PAGE_SIZE = 10
    // Simulate variable per-page latency so page 5 lands before page 2.
    const delays: Record<number, number> = { 1: 0, 2: 50, 3: 30, 4: 10, 5: 0 }
    const fetchMock: ApiFetch = vi.fn(async path => {
      const m = String(path).match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      const start = (page - 1) * PAGE_SIZE
      await new Promise(r => setTimeout(r, delays[page] ?? 0))
      const slice = Array.from({ length: PAGE_SIZE }, (_, i) => fakeBudget(start + i, 'user'))
      return { total_count: TOTAL, budgets: slice }
    })

    const result = await fetchUserBudgets(fetchMock)
    expect(result.userBudgets).toHaveLength(TOTAL)
    // IDs must come out in original ascending order even when later pages
    // resolve first — guards against accidentally concatenating in resolution
    // order instead of page order.
    expect(result.userBudgets.map(b => b.id)).toEqual(
      Array.from({ length: TOTAL }, (_, i) => `b${i}`),
    )
  })

  it('rejects when a later parallel page fails', async () => {
    const TOTAL = 30
    const PAGE_SIZE = 10
    const fetchMock: ApiFetch = vi.fn(async path => {
      const m = String(path).match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      if (page === 3) throw new Error('500: boom')
      const start = (page - 1) * PAGE_SIZE
      return {
        total_count: TOTAL,
        budgets: Array.from({ length: PAGE_SIZE }, (_, i) => fakeBudget(start + i, 'user')),
      }
    })
    await expect(fetchUserBudgets(fetchMock)).rejects.toThrow(/500: boom/)
  })

  it('stops on an empty page when total_count is missing (sequential fallback)', async () => {
    let calls = 0
    const fetchMock: ApiFetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { budgets: [fakeBudget(1), fakeBudget(2)] }
      return { budgets: [] }
    })
    const result = await fetchUserBudgets(fetchMock)
    expect(result.userBudgets).toHaveLength(2)
    expect(result.totalBudgetCount).toBe(2)
    expect(calls).toBe(2)
  })
})

describe('fetchAllCopilotSeats pagination', () => {
  function fakeSeatPage(start: number, count: number, totalSeats: number) {
    return {
      total_seats: totalSeats,
      seats: Array.from({ length: count }, (_, i) => ({
        assignee: { login: `user${start + i}` },
        organization: { login: `org${(start + i) % 3}` },
        last_activity_at: null,
        plan_type: 'business',
      })),
    }
  }

  it('paginates a large enterprise (1320 seats / 14 pages) and dedupes', async () => {
    const TOTAL = 1320
    const PAGE_SIZE = 100
    const fetchMock: ApiFetch = vi.fn(async (path: string) => {
      const m = path.match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      const start = (page - 1) * PAGE_SIZE
      const count = Math.min(PAGE_SIZE, TOTAL - start)
      return fakeSeatPage(start, count, TOTAL)
    })
    const result = await fetchAllCopilotSeats(fetchMock)
    // ceil(1320/100) = 14
    expect(fetchMock).toHaveBeenCalledTimes(14)
    expect(result).toHaveLength(TOTAL)
    expect(result[0].login).toBe('user0')
    expect(result[TOTAL - 1].login).toBe('user1319')
  })

  it('returns page 1 only when total_seats is already satisfied', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => fakeSeatPage(0, 3, 3))
    const result = await fetchAllCopilotSeats(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(3)
  })

  it('falls back to sequential when total_seats is missing', async () => {
    let calls = 0
    const fetchMock: ApiFetch = vi.fn(async () => {
      calls += 1
      if (calls <= 2) {
        return {
          // total_seats intentionally omitted
          seats: Array.from({ length: 100 }, (_, i) => ({
            assignee: { login: `user${(calls - 1) * 100 + i}` },
          })),
        }
      }
      return { seats: [] }
    })
    const result = await fetchAllCopilotSeats(fetchMock)
    expect(result).toHaveLength(200)
    expect(calls).toBe(3)
  })

  it('dedupes seats that appear in multiple orgs', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      total_seats: 3,
      seats: [
        { assignee: { login: 'alice' }, organization: { login: 'org-a' } },
        { assignee: { login: 'alice' }, organization: { login: 'org-b' } },
        { assignee: { login: 'bob' }, organization: { login: 'org-a' } },
      ],
    }))
    const result = await fetchAllCopilotSeats(fetchMock)
    expect(result.map(s => s.login).sort()).toEqual(['alice', 'bob'])
  })
})

function fakeCC(id: string, name: string, resources: Array<{ type: string; name: string }> = [], state = 'active'): CostCenter {
  return { id, name, state, resources }
}

describe('fetchCostCenters', () => {
  it('returns active cost centers from a single page', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      costCenters: [
        fakeCC('cc1', 'Eng', [{ type: 'User', name: 'alice' }]),
        fakeCC('cc2', 'Old', [], 'deleted'),
      ],
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.map(c => c.id)).toEqual(['cc1'])
  })

  it('paginates until a short page is returned', async () => {
    const PER_PAGE = 100
    const totalActive = PER_PAGE + 3
    const fetchMock: ApiFetch = vi.fn(async (path: string) => {
      const m = path.match(/[?&]page=(\d+)/)
      const page = m ? Number(m[1]) : 1
      if (page === 1) {
        return {
          costCenters: Array.from({ length: PER_PAGE }, (_, i) =>
            fakeCC(`cc-p1-${i}`, `n${i}`),
          ),
        }
      }
      if (page === 2) {
        return {
          costCenters: Array.from({ length: 3 }, (_, i) =>
            fakeCC(`cc-p2-${i}`, `n2-${i}`),
          ),
        }
      }
      return { costCenters: [] }
    })
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(totalActive)
  })

  it('handles empty enterprise', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({ costCenters: [] }))
    const result = await fetchCostCenters(fetchMock)
    expect(result).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates API errors (e.g. 403) so the caller can choose to swallow', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => {
      throw new Error('403: forbidden')
    })
    await expect(fetchCostCenters(fetchMock)).rejects.toThrow(/forbidden/)
  })

  it('accepts the snake_case cost_centers shape too', async () => {
    const fetchMock: ApiFetch = vi.fn(async () => ({
      cost_centers: [fakeCC('cc1', 'A')],
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(result.map(c => c.id)).toEqual(['cc1'])
  })

  it('stops after one page when the server ignores pagination and returns >PER_PAGE', async () => {
    // Repros the bug seen on at least one test enterprise where omitting
    // state=active makes the API return the full set on every page request,
    // ignoring page/per_page.
    const fetchMock: ApiFetch = vi.fn(async () => ({
      costCenters: Array.from({ length: 155 }, (_, i) => fakeCC(`cc${i}`, `n${i}`)),
    }))
    const result = await fetchCostCenters(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(155)
  })
})

describe('createApiFetch host allowlist', () => {
  it('accepts api.github.com', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.github.com', org: 'acme', token: 't' }),
    ).not.toThrow()
  })

  it('rejects ghe.com tenants (this variant is github.com-only)', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.acme.ghe.com', org: 'x', token: 't' }),
    ).toThrow(/untrusted host/)
  })

  it('rejects non-github hosts', () => {
    expect(() =>
      createApiFetch({ base: 'https://attacker.com', org: 'x', token: 't' }),
    ).toThrow(/untrusted host/)
  })

  it('rejects http (non-TLS) base URLs', () => {
    expect(() =>
      createApiFetch({ base: 'http://api.github.com', org: 'x', token: 't' }),
    ).toThrow(/https/)
  })

  it('rejects malformed base URLs', () => {
    expect(() =>
      createApiFetch({ base: 'not a url', org: 'x', token: 't' }),
    ).toThrow(/Invalid API base/)
  })

  it('rejects look-alike hosts (ghe.com suffix only)', () => {
    expect(() =>
      createApiFetch({ base: 'https://api.evil.com.ghe.example', org: 'x', token: 't' }),
    ).toThrow(/untrusted host/)
  })
})

// --- createApiFetch HTTP transport ---
//
// These tests stub global.fetch and exercise the typed-error mapping,
// GET retry policy, and write-shot semantics. Backoff durations are
// asserted as *bounds*, not exact values, so future tuning of the
// retry constants doesn't break the suite. Math.random is pinned so
// the jitter contribution is deterministic.

interface MockResponseSpec {
  status: number
  body?: string
  headers?: Record<string, string>
}

function mockFetchResponse(spec: MockResponseSpec): Response {
  return {
    ok: spec.status >= 200 && spec.status < 300,
    status: spec.status,
    headers: {
      get: (name: string) => spec.headers?.[name.toLowerCase()] ?? null,
    },
    text: async () => spec.body ?? '',
  } as unknown as Response
}

describe('createApiFetch typed-error mapping', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  const fetcher = createApiFetch({ base: 'https://api.github.com', org: 'acme', token: 't' })

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it.each([
    [401, AuthError, 'auth'],
    [403, ScopeError, 'scope'],
    [404, NotFoundError, 'not_found'],
    [422, ValidationError, 'validation'],
  ])('maps %i to the right typed error (kind=%s)', async (status, ctor, kind) => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ status, body: '{"message":"nope"}' }))
    let caught: unknown
    try {
      await fetcher('/budgets', { method: 'PATCH' })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ctor)
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).kind).toBe(kind)
    expect((caught as ApiError).status).toBe(status)
  })

  it('captures Retry-After and x-github-request-id on 429', async () => {
    fetchSpy.mockResolvedValue(
      mockFetchResponse({
        status: 429,
        body: 'slow down',
        headers: { 'retry-after': '7', 'x-github-request-id': 'abc-123' },
      }),
    )
    // Use a non-idempotent method to skip the GET retry path (we just want
    // to assert the captured-headers shape from a single failed call).
    await expect(fetcher('/budgets', { method: 'PATCH' })).rejects.toMatchObject({
      status: 429,
      kind: 'rate_limit',
      headers: { 'retry-after': '7', 'x-github-request-id': 'abc-123' },
    })
  })

  it('maps 5xx to ServerError (transient)', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 503, body: 'down' }))
    await expect(fetcher('/budgets', { method: 'PATCH' })).rejects.toBeInstanceOf(ServerError)
  })

  it('wraps fetch rejection (offline/DNS/TLS) as NetworkError', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(fetcher('/budgets', { method: 'PATCH' })).rejects.toBeInstanceOf(NetworkError)
  })

  it('maps an AbortError from fetch to AbortedError (no retry)', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    fetchSpy.mockRejectedValue(abortErr)
    // Use GET to prove the retry loop also short-circuits on abort.
    await expect(fetcher('/budgets')).rejects.toBeInstanceOf(AbortedError)
    // One attempt only — retry must not fire on abort.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('sends Authorization, Accept, and X-GitHub-Api-Version headers', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 200, body: '{}' }))
    await fetcher('/budgets')
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer t')
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(headers['X-GitHub-Api-Version']).toBeDefined()
  })

  it('adds Content-Type only when a body is supplied', async () => {
    fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status: 200, body: '{}' }))
    await fetcher('/budgets', { method: 'PATCH', body: '{"foo":1}' })
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })
})

describe('createApiFetch GET retry policy', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  let randomSpy: ReturnType<typeof vi.spyOn>
  const fetcher = createApiFetch({ base: 'https://api.github.com', org: 'acme', token: 't' })

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
    // Pin jitter to 0 so backoff durations are predictable for bound assertions.
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    randomSpy.mockRestore()
    fetchSpy.mockRestore()
  })

  it('retries a GET on 502 and succeeds on the 3rd attempt', async () => {
    fetchSpy
      .mockResolvedValueOnce(mockFetchResponse({ status: 502, body: 'gateway' }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 502, body: 'gateway' }))
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, body: '{"ok":true}' }))
    const promise = fetcher('/budgets')
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('does NOT retry a non-idempotent PATCH on 502 (single shot)', async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ status: 502, body: 'gateway' }))
    await expect(fetcher('/budgets', { method: 'PATCH' })).rejects.toBeInstanceOf(ServerError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a POST on 5xx (single shot)', async () => {
    fetchSpy.mockResolvedValue(mockFetchResponse({ status: 503, body: 'down' }))
    await expect(fetcher('/budgets', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(ServerError)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a GET on 401/403/404/422 (non-retryable)', async () => {
    for (const status of [401, 403, 404, 422]) {
      fetchSpy.mockResolvedValueOnce(mockFetchResponse({ status, body: '{}' }))
    }
    await expect(fetcher('/a')).rejects.toBeInstanceOf(AuthError)
    await expect(fetcher('/b')).rejects.toBeInstanceOf(ScopeError)
    await expect(fetcher('/c')).rejects.toBeInstanceOf(NotFoundError)
    await expect(fetcher('/d')).rejects.toBeInstanceOf(ValidationError)
    // 4 calls, one per request — no retries.
    expect(fetchSpy).toHaveBeenCalledTimes(4)
  })

  it('gives up after the retry budget is exhausted', async () => {
    // GET_RETRY_DEFAULTS.maxRetries = 2 → 1 initial + 2 retries = 3 attempts.
    fetchSpy.mockResolvedValue(mockFetchResponse({ status: 502, body: 'gateway' }))
    const promise = fetcher('/budgets')
    // Catch the rejection upfront so unhandled-rejection warnings don't fire
    // while we tick the fake timers.
    const settled = promise.catch(err => err)
    await vi.runAllTimersAsync()
    const err = await settled
    expect(err).toBeInstanceOf(ServerError)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('honors Retry-After on 429 (uses header value, not the default backoff)', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        mockFetchResponse({ status: 429, body: 'slow', headers: { 'retry-after': '3' } }),
      )
      .mockResolvedValueOnce(mockFetchResponse({ status: 200, body: '{"ok":true}' }))
    const promise = fetcher('/budgets')
    // Advance just under the Retry-After window — the second fetch must
    // not have fired yet.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(promise).resolves.toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })
})

describe('rate limit header capture', () => {
  it('parses x-ratelimit-* headers and updates the cache on success', async () => {
    _resetRateLimitCache()
    const resetSec = Math.floor(Date.now() / 1000) + 1800
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '4200',
          'x-ratelimit-reset': String(resetSec),
          'x-ratelimit-resource': 'core',
        },
      }),
    )
    const apiFetch = createApiFetch({ base: 'https://api.github.com', org: 'x', token: 't' })
    await apiFetch('/budgets')
    const snap = getLastKnownRateLimit()
    expect(snap?.remaining).toBe(4200)
    expect(snap?.limit).toBe(5000)
    expect(snap?.resetAt).toBe(resetSec * 1000)
    expect(snap?.resource).toBe('core')
    fetchSpy.mockRestore()
  })

  it('captures rate-limit headers on ApiError so isPrimaryRateLimitExhausted detects exhaustion', async () => {
    _resetRateLimitCache()
    const resetSec = Math.floor(Date.now() / 1000) + 600
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: {
          'x-ratelimit-limit': '5000',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetSec),
        },
      }),
    )
    const apiFetch = createApiFetch({ base: 'https://api.github.com', org: 'x', token: 't' })
    try {
      await apiFetch('/budgets')
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError)
      const err = e as ApiError
      expect(err.status).toBe(403)
      expect(err.headers['x-ratelimit-remaining']).toBe('0')
      expect(isPrimaryRateLimitExhausted(err)).toBe(true)
    }
    fetchSpy.mockRestore()
  })

  it('isPrimaryRateLimitExhausted is false for 403 with remaining > 0', () => {
    const err = new ApiError(403, 'forbidden', {
      headers: { 'x-ratelimit-remaining': '4000' },
    })
    expect(isPrimaryRateLimitExhausted(err)).toBe(false)
  })

  it('isPrimaryRateLimitExhausted is false for 429', () => {
    const err = new ApiError(429, 'slow down', {
      headers: { 'x-ratelimit-remaining': '0' },
    })
    // 429 = secondary; the retry path handles it. Primary check is 403-only.
    expect(isPrimaryRateLimitExhausted(err)).toBe(false)
  })
})

describe('buildCostCenterIndex', () => {
  it('indexes users and orgs lowercased', () => {
    const ccs = [
      fakeCC('cc1', 'Eng', [
        { type: 'User', name: 'Alice' },
        { type: 'Org', name: 'GitHub' },
      ]),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.get('alice')?.id).toBe('cc1')
    expect(idx.userToCC.has('Alice')).toBe(false)
    expect(idx.orgToCC.get('github')?.id).toBe('cc1')
  })

  it('warns and reports collisions when an org is in multiple ai-credits-budgeted CCs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ccs = [
        fakeCC('cc1', 'First', [{ type: 'Org', name: 'octo' }]),
        fakeCC('cc2', 'Second', [{ type: 'Org', name: 'octo' }]),
      ]
      // Both CCs have ai_credits budgets (keys lowercased).
      const budgets = new Map([
        ['first', { id: 'b1', costCenterName: 'First', budgetAmount: 10, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
        ['second', { id: 'b2', costCenterName: 'Second', budgetAmount: 20, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
      ])
      const idx = buildCostCenterIndex(ccs, budgets)
      // Sorted-by-id first-wins puts cc1 ahead of cc2.
      expect(idx.orgToCC.get('octo')?.id).toBe('cc1')
      expect(idx.orgBudgetedCollisions).toEqual([{ org: 'octo', costCenterNames: ['First', 'Second'] }])
      expect(warn).toHaveBeenCalledTimes(1)
    } finally {
      warn.mockRestore()
    }
  })

  it('does NOT flag org collisions when only one of the colliding CCs has a budget', () => {
    const ccs = [
      fakeCC('cc1', 'First', [{ type: 'Org', name: 'octo' }]),
      fakeCC('cc2', 'Second', [{ type: 'Org', name: 'octo' }]),
    ]
    const budgets = new Map([
      ['first', { id: 'b1', costCenterName: 'First', budgetAmount: 10, preventFurtherUsage: true, willAlert: false, alertRecipients: [] }],
    ])
    const idx = buildCostCenterIndex(ccs, budgets)
    expect(idx.orgBudgetedCollisions).toEqual([])
  })

  it('skips non-active cost centers', () => {
    const ccs = [
      fakeCC('cc1', 'Old', [{ type: 'User', name: 'alice' }], 'deleted'),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.size).toBe(0)
  })

  it('ignores unsupported resource types', () => {
    const ccs = [
      fakeCC('cc1', 'X', [{ type: 'Repository', name: 'owner/repo' }]),
    ]
    const idx = buildCostCenterIndex(ccs)
    expect(idx.userToCC.size).toBe(0)
    expect(idx.orgToCC.size).toBe(0)
  })
})

describe('resolveCostCenter', () => {
  const ccs = [
    fakeCC('ccu', 'User CC', [{ type: 'User', name: 'alice' }]),
    fakeCC('cco', 'Org CC', [{ type: 'Org', name: 'github' }]),
  ]
  const idx = buildCostCenterIndex(ccs)

  it('prefers direct user membership over org membership', () => {
    // alice is in both: direct user CC, and her org's CC. User wins.
    const r = resolveCostCenter('alice', 'github', idx)
    expect(r?.cc.id).toBe('ccu')
    expect(r?.via).toBe('user')
  })

  it('falls back to org membership when user is not directly assigned', () => {
    const r = resolveCostCenter('bob', 'github', idx)
    expect(r?.cc.id).toBe('cco')
    expect(r?.via).toBe('org')
    expect(r?.viaOrg).toBe('github')
  })

  it('returns null when neither user nor org match', () => {
    expect(resolveCostCenter('bob', 'unknown-org', idx)).toBeNull()
  })

  it('returns null when orgLogin is null and user has no direct membership', () => {
    expect(resolveCostCenter('bob', null, idx)).toBeNull()
  })

  it('lookups are case-insensitive on login and org', () => {
    expect(resolveCostCenter('ALICE', null, idx)?.cc.id).toBe('ccu')
    expect(resolveCostCenter('bob', 'GitHub', idx)?.cc.id).toBe('cco')
  })
})
