// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readEnterpriseUrlFromUrl } from '@/lib/urlParams'

function setSearch(search: string) {
  window.history.replaceState(null, '', `/${search}`)
}

afterEach(() => {
  setSearch('')
})

describe('readEnterpriseUrlFromUrl', () => {
  it('normalizes a bare slug to a full enterprises URL', () => {
    setSearch('?ent=octodemo')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octodemo')
  })

  it('passes through a full enterprise URL unchanged', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('accepts a full GHE.com enterprise URL', () => {
    setSearch('?ent=https%3A%2F%2Facme.ghe.com%2Fenterprises%2Facme')
    expect(readEnterpriseUrlFromUrl()).toBe('https://acme.ghe.com/enterprises/acme')
  })

  it('returns null for an invalid slug with disallowed characters', () => {
    setSearch('?ent=not%20a%20slug')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('returns null for a URL that is not an enterprise URL', () => {
    setSearch('?ent=https%3A%2F%2Fexample.com%2Ffoo')
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

  it('combines a bare slug with a GHE.com host param', () => {
    setSearch('?ent=octodemo&host=customer.ghe.com')
    expect(readEnterpriseUrlFromUrl()).toBe('https://customer.ghe.com/enterprises/octodemo')
  })

  it('ignores host param when ent is already a full URL', () => {
    setSearch('?ent=https%3A%2F%2Fgithub.com%2Fenterprises%2Focto&host=customer.ghe.com')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octo')
  })

  it('rejects the prefill entirely when host is an unsupported host', () => {
    setSearch('?ent=octodemo&host=evil.com')
    expect(readEnterpriseUrlFromUrl()).toBeNull()
  })

  it('falls back to github.com when host param is missing', () => {
    setSearch('?ent=octodemo')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octodemo')
  })

  it('falls back to github.com when host param is empty', () => {
    setSearch('?ent=octodemo&host=')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octodemo')
  })

  it('accepts github.com explicitly as host', () => {
    setSearch('?ent=octodemo&host=github.com')
    expect(readEnterpriseUrlFromUrl()).toBe('https://github.com/enterprises/octodemo')
  })
})
