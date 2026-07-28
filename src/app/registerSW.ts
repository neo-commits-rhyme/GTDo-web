/**
 * Registers the service worker, so the app installs and opens with no network.
 *
 * Everything is wrapped and nothing is awaited on a path the UI blocks on: a
 * browser that refuses a service worker must still run the app, which needs no
 * network anyway.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return

  // A new worker calls skipWaiting + clients.claim, so it takes control of this
  // already-loaded page — but the page keeps running the OLD bundle's HTML and
  // JS until something reloads it. Without this the user sees the previous
  // deploy until they happen to navigate again, which is how a shipped fix can
  // look like it never shipped.
  //
  // hadController distinguishes an update from the first-ever install, whose
  // claim() must not bounce the page. reloaded makes it strictly one-shot, so
  // there is no way to build a reload loop out of it.
  const hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return
    reloaded = true
    window.location.reload()
  })

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/GTDo-web/sw.js', { scope: '/GTDo-web/' }).catch(() => {
      // Private mode and some enterprise policies block registration outright.
    })
  })
}
