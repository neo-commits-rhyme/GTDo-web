import { SMART_VIEWS, type SidebarItem, type SmartView } from '../core/models'

/**
 * Hash routing, not path routing.
 *
 * GitHub Pages cannot rewrite, so a path-based SPA needs the 404.html fallback,
 * which costs a real back-button defect. A hash route works on any static host
 * with no server cooperation at all.
 */

const LIST_PREFIX = '#/list/'

export function routeFor(item: SidebarItem): string {
  return item.kind === 'smart' ? `#/${item.view}` : `${LIST_PREFIX}${item.id}`
}

/** Returns null for anything unrecognised; the caller falls back to Today. */
export function parseRoute(hash: string): SidebarItem | null {
  if (hash.startsWith(LIST_PREFIX)) {
    const id = hash.slice(LIST_PREFIX.length)
    return id === '' ? null : { kind: 'list', id }
  }
  const view = hash.replace(/^#\/?/, '')
  return SMART_VIEWS.includes(view as SmartView) ? { kind: 'smart', view: view as SmartView } : null
}

export const DEFAULT_ROUTE: SidebarItem = { kind: 'smart', view: 'today' }
