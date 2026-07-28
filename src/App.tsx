import { useEffect, useState } from 'react'
import { AppStore } from './core/store'
import { IndexedDbAdapter, requestPersistentStorage } from './storage/indexedDbAdapter'
import { TimerReminderSink } from './app/reminders/scheduler'
import { markReported } from './app/reminders/lastSeen'
import { RootShell } from './app/RootShell'
import { StoreContext } from './app/useStore'
import { UndoContext } from './app/undo/useUndo'
import { UndoCenter } from './core/undo'
import { autoEmptyTrashEnabled } from './app/SettingsSheet'
import './app/styles.css'

const undoCentre = new UndoCenter()
/**
 * One sink for the app: reminders are timers in this tab, nothing more.
 *
 * onDelivered is what keeps catch-up honest — the stamp advances only for a
 * notification the browser actually drew, never merely because the timer ran.
 */
const reminderSink = new TimerReminderSink({ onDelivered: markReported })

export function App() {
  const [store, setStore] = useState<AppStore | null>(null)

  useEffect(() => {
    let cancelled = false
    void AppStore.create({
      adapter: new IndexedDbAdapter(),
      now: () => new Date(),
      scheduler: (ms, fn) => { window.setTimeout(fn, ms) },
      reminders: reminderSink,
      // An offered undo holds tasks as they were before the last mutation, so
      // the store must not adopt another tab's document underneath it — the
      // undo would write that stale copy over their work.
      hasPendingUndo: () => undoCentre.pending !== null,
    }).then((created) => {
      if (cancelled) return
      // Nothing is scheduled by loading, so arm every live reminder once the
      // store exists. Without this the field stores a date and no timer is
      // ever set — which is exactly what shipped before an end-to-end test
      // actually watched for a notification.
      created.armAllReminders()
      // At launch only, once, and only when the preference is on — matching
      // macOS. There is no timer.
      if (autoEmptyTrashEnabled()) created.purgeTrash(30)
      // Fire-and-forget: Firefox never settles this promise (assumptions §3).
      requestPersistentStorage()
      setStore(created)
    })
    return () => { cancelled = true }
  }, [])

  if (store === null) return <p className="list__empty">Loading…</p>

  return (
    <StoreContext.Provider value={store}>
      <UndoContext.Provider value={undoCentre}>
        <RootShell />
      </UndoContext.Provider>
    </StoreContext.Provider>
  )
}
