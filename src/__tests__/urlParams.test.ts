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

  it('normalizes a scheme-less GHE.com enterprise URL', () => {
    setSearch('?ent=acme.ghe.com/enterprises/acme-corp')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme-corp')
  })

  it('lowercases the host in a scheme-less enterprise URL', () => {
    setSearch('?ent=ACME.GHE.COM/enterprises/acme-corp')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme-corp')
  })

  it('accepts a scheme-less github.com enterprise URL', () => {
    setSearch('?ent=github.com/enterprises/octo')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('tolerates trailing path segments on a scheme-less URL', () => {
    setSearch('?ent=acme.ghe.com/enterprises/acme-corp/settings')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme-corp')
  })

  it('rejects a scheme-less URL on an untrusted host', () => {
    setSearch('?ent=example.com/enterprises/foo')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('rejects a value that has slashes but no /enterprises/ segment', () => {
    setSearch('?ent=acme.ghe.com/acme-corp')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('still accepts a legacy full github.com enterprise URL', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('still accepts a legacy full GHE.com enterprise URL', () => {
    setSearch('?ent=https%3A%2F%2Facme.ghe.com%2Fenterprises%2Facme')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme')
  })

  it('rejects a legacy URL on an untrusted host', () => {
    setSearch('?ent=https%3A%2F%2Fexample.com%2Ffoo')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('rejects a legacy URL on an untrusted host that has the right path shape', () => {
    setSearch('?ent=https%3A%2F%2Fexample.com%2Fenterprises%2Facme')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('accepts a legacy URL with extra path segments after the slug', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto%2Fsettings%2Fbilling')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('accepts a legacy URL with a query string or fragment', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto%3Ftab%3Dx%23frag')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('accepts an uppercase HTTPS scheme on legacy URLs', () => {
    setSearch('?ent=HTTPS%3A%2F%2Fgithub.com%2Fenterprises%2Focto')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('rejects a scheme-less URL with an empty slug', () => {
    setSearch('?ent=acme.ghe.com/enterprises/')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('rejects a scheme-less URL with an empty host', () => {
    setSearch('?ent=/enterprises/acme')
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

  it('uses the scheme-less enterprise URL form for GHE.com tenants', () => {
    const creds: Credentials = { base: 'https://api.acme.ghe.com', ent: 'acme-corp', token: 't' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBe(
      'https://xrvk.github.io/ubb-dashboard/?ent=acme.ghe.com/enterprises/acme-corp',
    )
  })

  it('returns null for demo credentials', () => {
    const creds: Credentials = { base: 'demo://', ent: 'demo-150', token: 'demo' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBeNull()
  })

  it('returns null when the connected host is outside the allowlist', () => {
    const creds: Credentials = { base: 'https://api.example.com', ent: 'acme', token: 't' }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBeNull()
  })

  it('returns null when the enterprise slug contains unsafe characters', () => {
    const creds: Credentials = {
      base: 'https://api.acme.ghe.com',
      ent: 'acme corp/x',
      token: 't',
    }
    expect(buildShareableEnterpriseUrl(creds, origin, pathname)).toBeNull()
  })
})
