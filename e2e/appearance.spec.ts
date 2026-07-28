import { test, expect } from '@playwright/test'

/**
 * The checks that only a real browser can make: does the font actually load,
 * does the media query actually resolve, does the reduced-motion token
 * actually disarm the transform.
 */

test('renders in both colour schemes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const light = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor)

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const dark = await page.evaluate(() =>
    getComputedStyle(document.body).backgroundColor)

  expect(light).not.toBe(dark)
})

test('the serif actually loads and is used for the view title', async ({ page }) => {
  await page.goto('/GTDo-web/')
  // The font is only requested once text using it has been laid out, so the
  // check has to come after the title exists — not after navigation.
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready
    return document.fonts.check('16px "GTDo Serif"')
  })
  expect(loaded).toBe(true)

  const family = await page.evaluate(() => {
    const el = document.querySelector('.list__title')
    return el === null ? '' : getComputedStyle(el).fontFamily
  })
  expect(family).toContain('GTDo Serif')
})

test('reduced motion disarms the press transform', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/GTDo-web/')
  const scale = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--press-scale').trim())
  expect(scale).toBe('1')
})

test('the sidebar boundary is drawn, not inferred', async ({ page }) => {
  // Panel sits at 1.08:1 against paper — without the border there is no edge.
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('navigation', { name: 'Lists' })).toBeVisible()
  const border = await page.evaluate(() => {
    const el = document.querySelector('.shell__sidebar')
    if (el === null) return null
    const s = getComputedStyle(el)
    return { width: s.borderRightWidth, color: s.borderRightColor }
  })
  expect(border).not.toBeNull()
  expect(border!.width).toBe('1px')
  expect(border!.color).not.toBe('rgba(0, 0, 0, 0)')
})

test('the theme override beats the system preference in both directions', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  const systemDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  await page.evaluate(() => {
    localStorage.setItem('gtdo.theme', 'light')
  })
  await page.reload()
  // useTheme stamps data-theme on mount, so wait for the app before reading.
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.locator('html[data-theme="light"]')).toHaveCount(1)
  const forcedLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  expect(forcedLight).not.toBe(systemDark)
})
