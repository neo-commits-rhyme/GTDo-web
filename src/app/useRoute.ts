import { useCallback, useEffect } from 'react'
import { sidebarItemsEqual, type SidebarItem } from '../core/models'
import { DEFAULT_ROUTE, parseRoute, routeFor } from './router'
import { useStore } from './useStore'

/**
 * Keeps `store.selection` and the URL hash in step.
 *
 * A route naming a list that no longer exists falls back to Today rather than
 * rendering an empty pane — deleting the list you were looking at, or opening
 * someone else's link, must not leave a dead screen.
 */
export function useRoute(): (item: SidebarItem) => void {
  const store = useStore()

  const applyHash = useCallback(() => {
    const parsed = parseRoute(window.location.hash)
    const resolved =
      parsed === null || (parsed.kind === 'list' && store.list(parsed.id) === null)
        ? DEFAULT_ROUTE
        : parsed
    if (!sidebarItemsEqual(store.selection, resolved)) store.setSelection(resolved)
  }, [store])

  useEffect(() => {
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [applyHash])

  return useCallback(
    (item: SidebarItem) => {
      const next = routeFor(item)
      // Set the hash for history and shareability, then apply immediately —
      // hashchange is asynchronous, and the selection must not lag a click.
      if (window.location.hash !== next) window.location.hash = next
      applyHash()
    },
    [applyHash],
  )
}
