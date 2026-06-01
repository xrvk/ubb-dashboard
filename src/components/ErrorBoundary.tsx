/**
 * React error boundary for graceful render-error recovery.
 *
 * Without this, any uncaught render-time throw white-screens the entire app
 * and forces the user to re-enter credentials. With it, the affected subtree
 * collapses to a small fallback card with "Try again" + "Copy error details"
 * affordances, and the rest of the app shell (credentials, snapshot, tab
 * state) keeps working.
 *
 * We deliberately use a class component because as of React 19 there is no
 * hook equivalent for getDerivedStateFromError / componentDidCatch.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logDebug } from '@/lib/debugLog'

interface Props {
  /** Subtree to protect. */
  children: ReactNode
  /** Human-friendly label for the bounded subtree (e.g. "Individual ULBs tab"). */
  label?: string
  /** Optional custom fallback. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
  /**
   * Bumped on reset so the inner subtree remounts. React's reconciler treats
   * a changed `key` as a fresh subtree, which discards the broken state.
   */
  resetKey: number
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logDebug('error', `ErrorBoundary:${this.props.label ?? 'root'}`, error.message, {
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  private reset = () => {
    this.setState(s => ({ error: null, resetKey: s.resetKey + 1 }))
  }

  private copyDetails = async () => {
    const { error } = this.state
    if (!error) return
    const bundle = [
      `Label: ${this.props.label ?? 'root'}`,
      `Message: ${error.message}`,
      `Stack:`,
      error.stack ?? '(no stack)',
    ].join('\n')
    try {
      await navigator.clipboard.writeText(bundle)
    } catch {
      // best-effort; no toast here to avoid dependency on sonner
    }
  }

  render(): ReactNode {
    const { error, resetKey } = this.state
    if (!error) {
      // Wrap children in a keyed Fragment-ish container so reset remounts.
      return <ResetSlot key={resetKey}>{this.props.children}</ResetSlot>
    }
    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }
    return (
      <div className="m-4 rounded-md border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-4 text-sm">
        <div className="font-semibold text-red-900 dark:text-red-200 mb-1">
          Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.
        </div>
        <div className="text-red-800 dark:text-red-300 mb-3 font-mono text-xs break-words">
          {error.message}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="px-3 py-1 rounded border border-red-300 dark:border-red-700 bg-white dark:bg-red-900/30 text-red-900 dark:text-red-100 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={this.copyDetails}
            className="px-3 py-1 rounded border border-red-300 dark:border-red-700 bg-white dark:bg-red-900/30 text-red-900 dark:text-red-100 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/50"
          >
            Copy error details
          </button>
        </div>
      </div>
    )
  }
}

function ResetSlot({ children }: { children: ReactNode }) {
  return <>{children}</>
}
