import { StaleWriteError } from '../core/ports'
import { useStore, useStoreTick } from './useStore'
import { downloadExport } from './transfer'

/**
 * A failed save means changes are only in memory. Say so loudly rather than
 * letting the user keep typing into nothing — and offer the one action that
 * rescues their data from a browser that will not store it.
 *
 * A stale write is told apart because it is the only failure that never clears
 * itself: adoptExternalWrite declines while saveError is set, so the revision
 * this tab has seen stays behind for good and every later save is refused the
 * same way. Without the reload the tab is a dead end — and the generic copy
 * sends the user after storage, which is not what went wrong.
 */
export function SaveFailureBanner() {
  useStoreTick()
  const store = useStore()
  if (store.saveError === null) return null

  const stale = store.saveError instanceof StaleWriteError

  return (
    <div className="banner" role="alert">
      <span className="banner__text">
        {stale
          ? 'Another tab saved a newer version. This change was not saved, and nothing will save here until this tab reloads — export first if you want to keep it.'
          : `Changes are not being saved: ${store.saveError.message}`}
      </span>
      {/* Export comes first: reloading throws away the change this tab is
          still holding, so the way to get it out has to be reached first. */}
      <button type="button" className="banner__action" onClick={() => downloadExport(store)}>
        Export now
      </button>
      {stale && (
        <button type="button" className="banner__action" onClick={() => window.location.reload()}>
          Reload
        </button>
      )}
    </div>
  )
}
