/**
 * Scroll an element into view and briefly flash it with a ring so the user's
 * eye lands on the right place after a cross-page navigation.
 *
 * We wait two animation frames before reading the element, so a tab switch
 * that mounts the destination on the same render tick has time to paint
 * before we measure. Falling back to a single RAF was unreliable on slower
 * machines — the element existed but its layout was still being computed.
 */
export interface FlashTargetOptions {
  /** Extra classes to add for the flash. Defaults to an amber ring. */
  classes?: string[]
  /** How long to keep the flash classes applied. Defaults to 2000ms. */
  durationMs?: number
  /** Scroll alignment. Defaults to 'center'. */
  block?: ScrollLogicalPosition
}

const DEFAULT_FLASH_CLASSES = [
  'ring-2',
  'ring-amber-400',
  'ring-offset-2',
  'dark:ring-offset-neutral-950',
]

export function flashTarget(elementId: string, options: FlashTargetOptions = {}): void {
  const classes = options.classes ?? DEFAULT_FLASH_CLASSES
  const duration = options.durationMs ?? 2000
  const block = options.block ?? 'center'

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const el = document.getElementById(elementId)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block })
      el.classList.add(...classes)
      window.setTimeout(() => {
        el.classList.remove(...classes)
      }, duration)
    })
  })
}
