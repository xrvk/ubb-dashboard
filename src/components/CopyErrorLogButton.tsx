/**
 * Footer button that copies the in-memory debug ring buffer (and a small
 * environment summary) to the clipboard. Designed to be pasted into bug
 * reports so we can see what the user saw without asking them to screenshot
 * a toast.
 */

import { useState } from 'react'
import { ClipboardText } from '@phosphor-icons/react'
import { formatDebugBundle, getDebugEntries } from '@/lib/debugLog'

export function CopyErrorLogButton() {
  const [copied, setCopied] = useState(false)

  const onClick = async () => {
    const bundle = [
      `User-Agent: ${navigator.userAgent}`,
      `URL: ${location.href}`,
      `Generated: ${new Date().toISOString()}`,
      `Entries: ${getDebugEntries().length}`,
      '',
      formatDebugBundle(),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(bundle)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore; older browsers without clipboard API
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-neutral-100 hover:underline underline-offset-2 transition-colors"
      title="Copy a debug log of recent API errors for bug reports"
    >
      <ClipboardText size={12} />
      {copied ? 'Copied!' : 'Copy error log'}
    </button>
  )
}
