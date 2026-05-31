import { type ClassValue, clsx } from 'clsx'
import type { MouseEvent } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/**
 * Compact currency for tight spaces (bar segments, chips). Examples:
 *   42        → $42
 *   1234      → $1.2k
 *   12500     → $12.5k
 *   1230000   → $1.2M
 * Always prefixed with $; precision is one decimal for k/M, none for <1k.
 */
export function formatCurrencyShort(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `${sign}$${Math.round(abs)}`
}

export function formatPercent(ratio: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(ratio)
}

/**
 * onClick handler for external links. Some embedded browsers (inspect-element
 * mode, restricted webviews) silently swallow `target="_blank"` navigation, so
 * we also call `window.open` explicitly. The anchor's `href` + `target` stay
 * intact so right-click / middle-click still work.
 */
export function openExternal(
  href: string,
): (e: MouseEvent<HTMLAnchorElement>) => void {
  return e => {
    if (e.defaultPrevented) return
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return
    e.preventDefault()
    e.stopPropagation()
    window.open(href, '_blank', 'noopener,noreferrer')
  }
}
