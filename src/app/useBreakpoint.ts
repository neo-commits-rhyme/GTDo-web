import { useEffect, useState } from 'react'

/**
 * Three shapes, from spec §7:
 * - `wide`   (>=1100) sidebar | list | detail column
 * - `medium` (700-1099) sidebar | list, detail OVERLAYS rather than reflowing —
 *            below ~1100 a third column starves the list
 * - `narrow` (<700) stacked push navigation, detail as a bottom sheet
 */
export type Breakpoint = 'wide' | 'medium' | 'narrow'

export function breakpointFor(width: number): Breakpoint {
  if (width >= 1100) return 'wide'
  if (width >= 700) return 'medium'
  return 'narrow'
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() =>
    breakpointFor(typeof window === 'undefined' ? 1280 : window.innerWidth),
  )
  useEffect(() => {
    const update = () => setBp(breakpointFor(window.innerWidth))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return bp
}
