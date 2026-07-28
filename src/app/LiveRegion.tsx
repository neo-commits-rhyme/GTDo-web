import { useEffect, useState } from 'react'
import { useStore } from './useStore'

/**
 * The web equivalent of the LayoutChanged notification macOS posts when the
 * completion hold releases: rows have just migrated, so anyone navigating by
 * screen reader needs telling that the list is not where they left it.
 */
export function LiveRegion() {
  const store = useStore()
  const [message, setMessage] = useState('')

  useEffect(() => {
    let held = store.recentlyCompleted.size
    return store.subscribe(() => {
      const now = store.recentlyCompleted.size
      if (held > 0 && now === 0) setMessage('Completed tasks moved.')
      held = now
    })
  }, [store])

  return (
    <div className="visually-hidden" role="status" aria-live="polite" aria-label="List changes">
      {message}
    </div>
  )
}
