import { test, expect } from '@playwright/test'

/**
 * The claim worth proving in a real browser: nothing here needs a network, so
 * losing one should change nothing.
 *
 * Runs against the built output, since the service worker only exists after a
 * build.
 */
test('the app opens and keeps working with the network cut', async ({ page, context, browserName }) => {
  // WebKit's offline emulation throws an internal error on reload once a
  // service worker is controlling. That is a driver limitation, not an app
  // one — the same worker registers and controls fine in WebKit, which the
  // manifest test below exercises. Skipped loudly rather than narrowed
  // silently.
  test.skip(browserName === 'webkit', 'Playwright/WebKit: setOffline + reload with an active SW')

  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()

  await page.getByLabel('Add a task').fill('survives offline')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('survives offline')).toBeVisible()

  // Wait for the worker to be CONTROLLING before pulling the plug. Awaiting
  // serviceWorker.ready is unbounded — if registration silently failed it never
  // resolves, and the test times out instead of saying what went wrong.
  await expect
    .poll(
      () => page.evaluate(() => 'serviceWorker' in navigator && !!navigator.serviceWorker.controller),
      { timeout: 15_000, message: 'the service worker never took control' },
    )
    .toBe(true)

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  // The data was never on the network to begin with.
  await expect(page.getByText('survives offline')).toBeVisible()

  await context.setOffline(false)
})

test('the manifest is served and installable', async ({ page }) => {
  // Fetched, not navigated to: Firefox treats a .webmanifest navigation as a
  // download and page.goto never settles.
  const response = await page.request.get('/GTDo-web/manifest.webmanifest')
  expect(response.status()).toBe(200)
  const manifest = await response.json()
  expect(manifest.start_url).toBe('/GTDo-web/')
  expect(manifest.display).toBe('standalone')

  // The worker registers and controls in every engine, offline emulation aside.
  await page.goto('/GTDo-web/')
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker?.controller), { timeout: 15_000 })
    .toBe(true)
})
