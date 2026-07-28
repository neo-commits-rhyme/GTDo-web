import { test, expect } from '@playwright/test'

/**
 * The claim worth proving in a real browser: nothing here needs a network, so
 * losing one should change nothing.
 *
 * Runs against the built output, since the service worker only exists after a
 * build.
 */
test('the app opens and keeps working with the network cut', async ({ page, context }) => {
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()

  await page.getByLabel('Add a task').fill('survives offline')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('survives offline')).toBeVisible()

  // Wait for the worker to be in control before pulling the plug.
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) await navigator.serviceWorker.ready
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  // The data was never on the network to begin with.
  await expect(page.getByText('survives offline')).toBeVisible()

  await context.setOffline(false)
})

test('the manifest is served and installable', async ({ page }) => {
  const response = await page.goto('/GTDo-web/manifest.webmanifest')
  expect(response?.status()).toBe(200)
  const manifest = await response!.json()
  expect(manifest.start_url).toBe('/GTDo-web/')
  expect(manifest.display).toBe('standalone')
})
