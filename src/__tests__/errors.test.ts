import { describe, expect, it, beforeEach } from 'vitest'
import {
  ApiError,
  AuthError,
  ScopeError,
  RateLimitError,
  ServerError,
  NetworkError,
  AbortedError,
  ValidationError,
  apiErrorFromResponse,
  describeError,
  isAborted,
  isRetryable,
  kindFromStatus,
  retryAfterSecondsFromError,
} from '@/lib/errors'
import { __resetDebugLog, getDebugEntries } from '@/lib/debugLog'

describe('kindFromStatus', () => {
  it.each([
    [401, 'auth'],
    [403, 'scope'],
    [404, 'not_found'],
    [422, 'validation'],
    [429, 'rate_limit'],
    [500, 'server'],
    [502, 'server'],
    [504, 'server'],
    [0, 'unknown'],
    [418, 'unknown'],
  ] as const)('maps %i to %s', (status, kind) => {
    expect(kindFromStatus(status)).toBe(kind)
  })
})

describe('apiErrorFromResponse', () => {
  it('produces typed subclasses', () => {
    expect(apiErrorFromResponse(401, '', {})).toBeInstanceOf(AuthError)
    expect(apiErrorFromResponse(403, '', {})).toBeInstanceOf(ScopeError)
    expect(apiErrorFromResponse(422, '', {})).toBeInstanceOf(ValidationError)
    expect(apiErrorFromResponse(429, '', {})).toBeInstanceOf(RateLimitError)
    expect(apiErrorFromResponse(502, '', {})).toBeInstanceOf(ServerError)
  })

  it('captures headers on the typed error', () => {
    const err = apiErrorFromResponse(429, '', { 'retry-after': '30' })
    expect(err.headers['retry-after']).toBe('30')
  })

  it('falls back to ApiError for unknown statuses', () => {
    const err = apiErrorFromResponse(418, 'teapot', {})
    expect(err).toBeInstanceOf(ApiError)
    // Not one of the typed subclasses
    expect(err).not.toBeInstanceOf(AuthError)
    expect(err.kind).toBe('unknown')
  })
})

describe('retryAfterSecondsFromError', () => {
  it('prefers Retry-After header (seconds form)', () => {
    const err = apiErrorFromResponse(429, '', { 'retry-after': '42' })
    expect(retryAfterSecondsFromError(err)).toBe(42)
  })

  it('parses HTTP-date Retry-After header', () => {
    const future = new Date(Date.now() + 10_000).toUTCString()
    const err = apiErrorFromResponse(429, '', { 'retry-after': future })
    const got = retryAfterSecondsFromError(err)
    expect(got).not.toBeNull()
    // Allow slight clock drift in test execution
    expect(got!).toBeGreaterThanOrEqual(8)
    expect(got!).toBeLessThanOrEqual(12)
  })

  it('falls back to body when header missing', () => {
    const err = apiErrorFromResponse(429, '{"message":"retry after 17 seconds"}', {})
    expect(retryAfterSecondsFromError(err)).toBe(17)
  })

  it('returns null when neither source has a value', () => {
    const err = apiErrorFromResponse(429, 'no retry hint', {})
    expect(retryAfterSecondsFromError(err)).toBeNull()
  })
})

describe('isRetryable / isAborted', () => {
  it('flags rate-limit, server, network as retryable', () => {
    expect(isRetryable(apiErrorFromResponse(429, '', {}))).toBe(true)
    expect(isRetryable(apiErrorFromResponse(502, '', {}))).toBe(true)
    expect(isRetryable(new NetworkError('offline'))).toBe(true)
  })

  it('does not flag auth/scope/validation/aborted as retryable', () => {
    expect(isRetryable(apiErrorFromResponse(401, '', {}))).toBe(false)
    expect(isRetryable(apiErrorFromResponse(403, '', {}))).toBe(false)
    expect(isRetryable(apiErrorFromResponse(422, '', {}))).toBe(false)
    expect(isRetryable(new AbortedError())).toBe(false)
  })

  it('detects DOMException AbortError shape', () => {
    const ex = new Error('aborted')
    ex.name = 'AbortError'
    expect(isAborted(ex)).toBe(true)
    expect(isAborted(new AbortedError())).toBe(true)
    expect(isAborted(new Error('other'))).toBe(false)
  })
})

describe('describeError', () => {
  beforeEach(() => __resetDebugLog())

  it('returns recoverable=false for auth/scope', () => {
    expect(describeError(apiErrorFromResponse(401, '', {})).recoverable).toBe(false)
    expect(describeError(apiErrorFromResponse(403, '', {})).recoverable).toBe(false)
  })

  it('returns recoverable=true for rate-limit/server/network', () => {
    expect(describeError(apiErrorFromResponse(429, '', {})).recoverable).toBe(true)
    expect(describeError(apiErrorFromResponse(502, '', {})).recoverable).toBe(true)
    expect(describeError(new NetworkError('boom')).recoverable).toBe(true)
  })

  it('extracts GitHub JSON message for ValidationError body', () => {
    const err = apiErrorFromResponse(422, '{"message":"budget amount must be positive"}', {})
    expect(describeError(err).body).toContain('budget amount must be positive')
  })

  it('caps body length to ~200 chars', () => {
    const huge = 'x'.repeat(5000)
    const err = apiErrorFromResponse(422, huge, {})
    expect(describeError(err).body.length).toBeLessThanOrEqual(200)
  })

  it('writes to the debug log as a side effect', () => {
    describeError(apiErrorFromResponse(500, 'boom', {}), 'unit-test')
    const entries = getDebugEntries()
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(entries[entries.length - 1].source).toBe('unit-test')
  })
})
