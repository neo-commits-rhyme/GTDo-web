/**
 * Registers the service worker, so the app installs and opens with no network.
 *
 * Everything is wrapped and nothing is awaited on a path the UI blocks on: a
 * browser that refuses a service worker must still run the app, which needs no
 * network anyway.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/GTDo-web/sw.js', { scope: '/GTDo-web/' }).catch(() => {
      // Private mode and some enterprise policies block registration outright.
    })
  })
}
