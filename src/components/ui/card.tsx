import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, children, id }: { className?: string; children: ReactNode; id?: string }) {
  return (
    <div
      id={id}
      className={cn(
        'rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm scroll-mt-24',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4 border-b border-neutral-200 dark:border-neutral-800', className)}>{children}</div>
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('p-4', className)}>{children}</div>
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return <h3 className={cn('text-sm font-medium text-neutral-500 dark:text-neutral-400', className)}>{children}</h3>
}
