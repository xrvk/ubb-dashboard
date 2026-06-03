// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flashTarget } from '../lib/flashTarget'

/**
 * flashTarget is the deferred-scroll + ring-flash helper extracted from
 * App.tsx so any cross-page nav can land the user on the right element.
 * Tests pin down the two RAF defer, the missing-element no-op, the ring
 * classes, and the timed cleanup so future refactors can't silently
 * regress the cross-page UX.
 */

function flushRafs(times = 2) {
  for (let i = 0; i < times; i++) {
    vi.advanceTimersToNextFrame()
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('flashTarget', () => {
  it('scrolls the element into view and adds the default ring classes', () => {
    const el = document.createElement('div')
    el.id = 'target'
    document.body.appendChild(el)
    const scroll = vi.fn()
    el.scrollIntoView = scroll

    flashTarget('target')
    flushRafs()

    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
    expect(el.classList.contains('ring-2')).toBe(true)
    expect(el.classList.contains('ring-amber-400')).toBe(true)
  })

  it('removes the flash classes after the duration elapses', () => {
    const el = document.createElement('div')
    el.id = 'target'
    document.body.appendChild(el)
    el.scrollIntoView = vi.fn()

    flashTarget('target', { durationMs: 500 })
    flushRafs()
    expect(el.classList.contains('ring-2')).toBe(true)

    vi.advanceTimersByTime(500)
    expect(el.classList.contains('ring-2')).toBe(false)
    expect(el.classList.contains('ring-amber-400')).toBe(false)
  })

  it('uses the caller-supplied class list when provided', () => {
    const el = document.createElement('div')
    el.id = 'target'
    document.body.appendChild(el)
    el.scrollIntoView = vi.fn()

    flashTarget('target', { classes: ['bg-red-500', 'animate-pulse'] })
    flushRafs()

    expect(el.classList.contains('bg-red-500')).toBe(true)
    expect(el.classList.contains('animate-pulse')).toBe(true)
    // Defaults must not leak when the caller passes custom classes.
    expect(el.classList.contains('ring-2')).toBe(false)
  })

  it('no-ops when the element id does not exist (post-RAF safety)', () => {
    expect(() => {
      flashTarget('does-not-exist')
      flushRafs()
    }).not.toThrow()
  })

  it('honors a custom scroll alignment', () => {
    const el = document.createElement('div')
    el.id = 'target'
    document.body.appendChild(el)
    const scroll = vi.fn()
    el.scrollIntoView = scroll

    flashTarget('target', { block: 'start' })
    flushRafs()

    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })
})
