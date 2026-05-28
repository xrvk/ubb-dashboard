import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, onWheel, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      onWheel={e => {
        // Prevent number inputs from changing value when the user scrolls;
        // it's surprising and lossy. Blur the field to neutralize the wheel.
        if (type === 'number') {
          (e.currentTarget as HTMLInputElement).blur()
        }
        onWheel?.(e)
      }}
      className={cn(
        'flex h-10 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
