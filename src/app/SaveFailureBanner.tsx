import { useStore, useStoreTick } from './useStore'
import { downloadExport } from './transfer'

/**
 * A failed save means changes are only in memory. Say so loudly rather than
 * letting the user keep typing into nothing — and offer the one action that
 * rescues their data from a browser that will not store it.
 */
export function SaveFailureBanner() {
  useStoreTick()
  const store = useStore()
  if (store.saveError === null) return null

  return (
    <div className="banner" role="alert">
      <span className="banner__text">
        Changes are not being saved: {store.saveError.message}
      </span>
      <button type="button" className="banner__action" onClick={() => downloadExport(store)}>
        Export now
      </button>
    </div>
  )
}
