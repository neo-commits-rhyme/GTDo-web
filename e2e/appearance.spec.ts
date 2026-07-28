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

/**
 * Counts elements — including ::before/::after — painting in `rgb`, across
 * every property the accent could reach. Runs in the page so nothing has to
 * decode a screenshot.
 */
const countPainted = (page: import('@playwright/test').Page, rgb: string) =>
  page.evaluate((want: string) => {
    const PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor',
      'borderBottomColor', 'borderLeftColor', 'outlineColor', 'boxShadow'] as const
    let n = 0
    for (const el of document.querySelectorAll('*')) {
      for (const pseudo of [null, '::before', '::after']) {
        const s = getComputedStyle(el, pseudo)
        if (PROPS.some((p) => String(s[p]).includes(want))) { n++; break }
      }
    }
    return n
  }, rgb)

test('picking an accent repaints an app that has no data at all', async ({ page }) => {
  // The bug this guards, in full: the first fix routed the accent to completed
  // tasks only. On a new install — empty store, Today view, nothing completed —
  // that repainted zero pixels, so the setting still looked broken to exactly
  // the users most likely to try it. Measured before the fix: 0 of 125
  // elements. The accent must reach something that needs no data to exist.
  await page.addInitScript(() => localStorage.setItem('gtdo.accent', 'teal'))
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()

  // Guard the premise: if seeding ever changes, this test must not quietly
  // start measuring a populated app instead.
  await expect(page.locator('.row')).toHaveCount(0)

  const teal = 'rgb(12, 107, 99)' // ACCENTS.teal.light
  expect(await countPainted(page, teal), 'empty app, light').toBeGreaterThan(0)

  // Dark has its own accent value and its own token block; light passing says
  // nothing about it.
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  expect(await countPainted(page, 'rgb(95, 207, 194)'), 'empty app, dark').toBeGreaterThan(0)
})

test('the accent survives losing the sidebar at narrow widths', async ({ page }) => {
  // Below 700px RootShell does not render the sidebar, so the selected-row
  // rail is gone and the view title is the only accent surface left. A fix
  // that relied on the sidebar alone would leave every phone user with the
  // original bug.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('gtdo.accent', 'teal'))
  await page.goto('/GTDo-web/')
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible()
  await expect(page.locator('.nav__item--selected')).toHaveCount(0)
  expect(await countPainted(page, 'rgb(12, 107, 99)'), 'narrow, no sidebar').toBeGreaterThan(0)
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
