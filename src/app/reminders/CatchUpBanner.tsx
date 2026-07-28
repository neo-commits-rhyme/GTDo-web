import { useMemo, useState } from 'react'
import { missedReminders } from '../../core/catchUp'
import { markCaughtUp, sinceLastOpen } from './lastSeen'
import { useStore, useStoreTick } from '../useStore'

/**
 * What came due while GTDo was closed.
 *
 * Fires no notifications — it is a banner. Notifying someone about events that
 * already happened is how an app teaches them to ignore it. And it needs no
 * permission, so this still works for anyone who denied notifications.
 */
export function CatchUpBanner() {
  useStoreTick()
  const store = useStore()
  const [dismissed, setDismissed] = useState(false)
  // The stamp as it stood when the tab opened, never the stored one: the
  // heartbeat and dismissal both push the stored stamp forward, so reading that
  // would make the banner erase itself as soon as anything else re-rendered.
  const [since] = useState(sinceLastOpen)

  const missed = useMemo(
    () => missedReminders(store.data, since, store.now()),
    [store, since],
  )

  if (dismissed || missed.length === 0) return null

  const dismiss = () => {
    markCaughtUp(store.now())
    setDismissed(true)
  }

  return (
    <div className="catchup" role="status" aria-live="polite" aria-label="Missed reminders">
      <div className="catchup__body">
        <strong>
          {missed.length} reminder{missed.length === 1 ? '' : 's'} came due while GTDo was closed
        </strong>
        <ul className="catchup__list">
          {missed.slice(0, 5).map((t) => (
            <li key={t.id}>{t.title}</li>
          ))}
          {missed.length > 5 && <li>and {missed.length - 5} more</li>}
        </ul>
      </div>
      <button type="button" className="catchup__dismiss" onClick={dismiss}>Got it</button>
    </div>
  )
}
