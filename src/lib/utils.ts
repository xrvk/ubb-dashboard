import { type ClassValue, clsx } from 'clsx'
import type { MouseEvent } from 'react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Adaptive currency formatter. Always ≤3 significant figures with a $-prefix
 * and a 1000× suffix (`k`, `M`, `B`). Trailing zero-decimals are stripped
 * so round numbers don't look noisy (`$9k`, not `$9.00k`):
 *
 *   $0 .. $999          → `$550`              (integer dollars, no suffix)
 *   $1,000 .. $9,999    → `$5.53k` / `$7k`    (up to 2 decimals, trimmed)
 *   $10,000 .. $99,999  → `$22.5k` / `$10k`   (up to 1 decimal, trimmed)
 *   $100,000 .. $999k   → `$225k`             (integer)
 *   $1M .. $9.99M       → `$1.3M` / `$1M`     (up to 2 decimals, trimmed)
 *   $10M .. $99.9M      → `$12.5M` / `$10M`   (up to 1 decimal, trimmed)
 *   $100M+              → `$225M` / `$1.3B`   (integer, then promotes)
 *
 * Sub-$1 values render with cents (`$0.42`) so they don't collapse to `$0`.
 * Negative values get a leading `-`.
 *
 * This is the single source of truth for currency display. All callers
 * (cards, tables, toasts, banners) go through it so the app stays
 * consistent at every magnitude.
 */
export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return '$0'
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs < 1 && abs > 0) return `${sign}$${abs.toFixed(2)}`
  const suffixes = ['', 'k', 'M', 'B', 'T']
  let bandIdx = 0
  let value = abs
  while (value >= 1_000 && bandIdx < suffixes.length - 1) {
    value /= 1_000
    bandIdx += 1
  }
  let rounded = Number.parseFloat(value.toPrecision(3))
  if (rounded >= 1_000 && bandIdx < suffixes.length - 1) {
    rounded /= 1_000
    bandIdx += 1
    rounded = Number.parseFloat(rounded.toPrecision(3))
  }
  if (bandIdx === 0) return `${sign}$${Math.round(rounded)}`
  // 1.00–9.99 → up to 2 decimals; 10.0–99.9 → up to 1 decimal; 100–999 → integer.
  const decimals = rounded < 10 ? 2 : rounded < 100 ? 1 : 0
  // Strip trailing zero-decimals so "$9.00k" → "$9k" and "$9.50k" → "$9.5k".
  // Done after toFixed so we still round properly first.
  let body = rounded.toFixed(decimals)
  if (body.includes('.')) body = body.replace(/\.?0+$/, '')
  return `${sign}$${body}${suffixes[bandIdx]}`
}

/**
 * Back-compat alias. `formatCurrency` is already whole-dollar-ish via the
 * 3-sig-fig rule, so this delegates straight to it.
 */
export function formatCurrencyWhole(amount: number): string {
  return formatCurrency(amount)
}

/**
 * Back-compat alias for tight spaces (bar segments, chips). Same output as
 * `formatCurrency`; kept so existing imports keep working.
 */
export function formatCurrencyShort(amount: number): string {
  return formatCurrency(amount)
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
