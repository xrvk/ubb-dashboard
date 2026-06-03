// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { buildShareableOrgUrl, readOrgUrlFromUrl } from '@/lib/urlParams'
import type { Credentials } from '@/lib/api'

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

afterEach(() => {
  setSearch('')
})

describe('readOrgUrlFromUrl', () => {
  it('normalizes a bare org slug to a full github.com URL', () => {
    setSearch('?org=acme')
    expect(readOrgUrlFromUrl()).toBe('https://github.com/acme')
  })

  it('passes through a full github.com org URL unchanged', () => {
    setSearch('?org=https%3A%2F%2Fgithub.com%2Focto')
    expect(readOrgUrlFromUrl()).toBe('https://github.com/octo')
  })

  it('rejects a URL on an untrusted host (no GHES/GHE.com support)', () => {
    setSearch('?org=https%3A%2F%2Facme.ghe.com%2Facme')
    expect(readOrgUrlFromUrl()).toBeNull()
  })

  it('rejects a URL on an arbitrary host', () => {
    setSearch('?org=https%3A%2F%2Fexample.com%2Ffoo')
    expect(readOrgUrlFromUrl()).toBeNull()
  })

  it('rejects a slug with disallowed characters', () => {
    setSearch('?org=not%20a%20slug')
    expect(readOrgUrlFromUrl()).toBeNull()
  })

  it('rejects a reserved single-segment path (settings)', () => {
    setSearch('?org=https%3A%2F%2Fgithub.com%2Fsettings')
    expect(readOrgUrlFromUrl()).toBeNull()
  })

  it('returns null when the param is missing', () => {
    setSearch('')
    expect(readOrgUrlFromUrl()).toBeNull()
  })

  it('returns null when the param is empty', () => {
    setSearch('?org=')
    expect(readOrgUrlFromUrl()).toBeNull()
  })
})

describe('buildShareableOrgUrl', () => {
  const origin = 'https://xrvk.github.io'
  const pathname = '/ubb-dashboard-org/'

  it('emits the short ?org=<slug> form', () => {
    const creds: Credentials = { base: 'https://api.github.com', org: 'acme-corp', token: 't' }
    expect(buildShareableOrgUrl(creds, origin, pathname)).toBe(
      'https://xrvk.github.io/ubb-dashboard-org/?org=acme-corp',
    )
  })

  it('URL-encodes slugs with special characters', () => {
    const creds: Credentials = { base: 'https://api.github.com', org: 'acme org', token: 't' }
    expect(buildShareableOrgUrl(creds, origin, pathname)).toBe(
      'https://xrvk.github.io/ubb-dashboard-org/?org=acme%20org',
    )
  })

  it('returns null for demo credentials', () => {
    const creds: Credentials = { base: 'demo://', org: 'demo-150', token: 'demo' }
    expect(buildShareableOrgUrl(creds, origin, pathname)).toBeNull()
  })
})
