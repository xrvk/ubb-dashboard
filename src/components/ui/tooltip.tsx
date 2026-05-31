/* eslint-disable react-refresh/only-export-components */
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@/lib/utils'
import type { ComponentProps, ReactNode } from 'react'

export const TooltipProvider = TooltipPrimitive.Provider
export const Tooltip = TooltipPrimitive.Root
export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  children,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content> & { children: ReactNode }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs text-neutral-900 shadow-md',
          'dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out',
          'data-[side=top]:slide-in-from-bottom-1 data-[side=bottom]:slide-in-from-top-1',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-white dark:fill-neutral-900" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}
