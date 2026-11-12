import { useEffect, useRef } from 'react'
import { telegram } from '../telegram'

/**
 * While `active`, Telegram's Back button is shown and runs `handler`. When
 * several are active the most recently activated one answers, which is the
 * layer on top. Outside Telegram this does nothing.
 */
export function useTelegramBack(active: boolean, handler: () => void): void {
  // A ref, so a handler recreated every render does not hide and re-show the button.
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!active) return undefined
    return telegram.pushBack(() => latest.current())
  }, [active])
}
