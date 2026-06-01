import { describe, expect, it, beforeEach } from 'vitest'
import {
  __resetDebugLog,
  clearDebugEntries,
  formatDebugBundle,
  getDebugEntries,
  logDebug,
  subscribeDebug,
} from '@/lib/debugLog'

describe('debugLog', () => {
  beforeEach(() => __resetDebugLog())

  it('appends and returns entries in insertion order', () => {
    logDebug('info', 'src', 'first')
    logDebug('warn', 'src', 'second')
    logDebug('error', 'src', 'third')
    const e = getDebugEntries()
    expect(e.map(x => x.message)).toEqual(['first', 'second', 'third'])
    expect(e.map(x => x.level)).toEqual(['info', 'warn', 'error'])
  })

  it('caps buffer at 100 entries (oldest evicted)', () => {
    for (let i = 0; i < 105; i += 1) logDebug('info', 's', `m${i}`)
    const e = getDebugEntries()
    expect(e).toHaveLength(100)
    expect(e[0].message).toBe('m5') // first 5 were evicted
    expect(e[e.length - 1].message).toBe('m104')
  })

  it('notifies subscribers and supports unsubscribe', () => {
    let calls = 0
    const off = subscribeDebug(() => {
      calls += 1
    })
    logDebug('info', 's', 'a')
    logDebug('info', 's', 'b')
    expect(calls).toBe(2)
    off()
    logDebug('info', 's', 'c')
    expect(calls).toBe(2)
  })

  it('clearDebugEntries empties the buffer', () => {
    logDebug('info', 's', 'x')
    clearDebugEntries()
    expect(getDebugEntries()).toHaveLength(0)
  })

  it('formatDebugBundle includes all messages', () => {
    logDebug('error', 'mod', 'hello world')
    const out = formatDebugBundle()
    expect(out).toContain('hello world')
    expect(out).toContain('mod')
  })
})
