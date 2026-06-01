// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { buildShareableEnterpriseUrl, readEnterpriseUrlFromUrl } from '@/lib/urlParams'
import type { Credentials } from '@/lib/api'

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

afterEach(() => {
  setSearch('')
})

describe('readEnterpriseUrlFromUrl', () => {
  it('normalizes a bare slug to a full github.com enterprises URL', () => {
    setSearch('?ent=acme')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/acme')
  })

  it('passes through a full github.com enterprise URL unchanged', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('passes through a full GHE.com enterprise URL unchanged', () => {
    setSearch('?ent=https%3A%2F%2Facme.ghe.com%2Fenterprises%2Facme')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme')
  })

  it('rejects a URL on an untrusted host', () => {
    setSearch('?ent=https%3A%2F%2Fexample.com%2Ffoo')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('rejects a slug with disallowed characters', () => {
    setSearch('?ent=not%20a%20slug')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('rejects a malformed URL', () => {
    setSearch('?ent=https%3A%2F%2Fnot-a-real-url')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('returns null when the param is missing', () => {
    setSearch('')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('returns null when the param is empty', () => {
    setSearch('?ent=')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })
})

describe('buildShareableEnterpriseUrl', () => {
  const origin = 'https://xrvk.github.io'
  const pathname = '/ubb-dashboard/'

  it('uses the short slug form for github.com tenants', () => {
    const creds: Credentials = { base: 'https://api.github.com', ent: 'acme-corp', token: 't' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBe(
      'https://xrvk.github.io/ubb-dashboard/?ent=acme-corp',
    )
  })

  it('uses the full-URL form for GHE.com tenants', () => {
    const creds: Credentials = { base: 'https://api.acme.ghe.com', ent: 'acme-corp', token: 't' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBe(
      'https://xrvk.github.io/ubb-dashboard/?ent=https%3A%2F%2Facme.ghe.com%2Fenterprises%2Facme-corp',
    )
  })

  it('returns null for demo credentials', () => {
    const creds: Credentials = { base: 'demo://', ent: 'demo-150', token: 'demo' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBeNull()
  })
})
