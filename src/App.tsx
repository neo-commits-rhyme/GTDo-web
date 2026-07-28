import { useEffect, useState } from 'react'
import { AppStore } from './core/store'
import { IndexedDbAdapter, requestPersistentStorage } from './storage/indexedDbAdapter'
import { RootShell } from './app/RootShell'
import { StoreContext } from './app/useStore'
import { autoEmptyTrashEnabled } from './app/SettingsSheet'
import './app/styles.css'

export function App() {
  const [store, setStore] = useState<AppStore | null>(null)

  useEffect(() => {
    let cancelled = false
    void AppStore.create({
      adapter: new IndexedDbAdapter(),
      now: () => new Date(),
      scheduler: (ms, fn) => { window.setTimeout(fn, ms) },
    }).then((created) => {
      if (cancelled) return
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
      <RootShell />
    </StoreContext.Provider>
  )
}
