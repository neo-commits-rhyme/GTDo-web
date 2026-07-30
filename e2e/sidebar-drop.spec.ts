import { test, expect } from '@playwright/test'

/**
 * Dropping a task onto a sidebar list to file it there — the gesture the README
 * promises. Driven with the real mouse, because dnd-kit reads pointer events and
 * a synthesised sequence proves nothing about what a hand does.
 *
 * This is the case closestCenter alone got wrong: it measures the dragged ROW's
 * centre, and a full-width row's centre stays far right of the sidebar however
 * far left the pointer goes, so the drop resolved to a neighbouring row — or,
 * with one row on screen, to the dragged row itself, doing nothing.
 */

async function dragOnto(
  page: import('@playwright/test').Page,
  rowText: string,
  targetName: RegExp,
) {
  const handle = page.locator('.row', { hasText: rowText }).locator('.row__handle')
  const target = page.locator('nav').getByRole('button', { name: targetName }).first()

  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Past the 5px activation slop first, then across in steps: dnd-kit tracks
  // pointermove, and a single jump registers as one frame with no path.
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  // Let the drop settle before anything clicks: a click issued in the same tick
  // lands while dnd-kit is still tearing the drag down.
  await page.waitForTimeout(300)
}

test('dropping a task on a sidebar list moves it there', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByLabel('Add a task').fill('buy milk')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('buy milk')).toBeVisible()

  await dragOnto(page, 'buy milk', /^Someday/)

  // The badge is the assertion that does not depend on navigating anywhere.
  const someday = page.locator('nav').getByRole('button', { name: /^Someday/ }).first()
  await expect(someday).toHaveText(/1/)
  await expect(page.locator('main').getByText('buy milk')).toHaveCount(0)

  await someday.click()
  await expect(page.getByRole('heading', { name: 'Someday', level: 1 })).toBeVisible()
  await expect(page.getByText('buy milk')).toBeVisible()
})

/** One row on screen was the worst case: the drop resolved to the dragged row
 *  itself, so nothing happened at all and nothing said why. */
test('it works with a single row on screen', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.locator('nav').getByRole('button', { name: /^Inbox/ }).first().click()
  await page.getByLabel('Add a task').fill('only task')
  await page.getByRole('button', { name: 'Add' }).click()

  await dragOnto(page, 'only task', /^Someday/)

  await expect(page.locator('nav').getByRole('button', { name: /^Someday/ }).first())
    .toHaveText(/1/)
})

test('a mirrored project row can be filed from Next actions too', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Load sample data' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.locator('nav').getByRole('button', { name: /^Next actions/ }).first().click()
  await expect(page.locator('.row', { hasText: 'Wireframe home page' })).toBeVisible()

  await dragOnto(page, 'Wireframe home page', /^Someday/)

  // Someday strips the deadline, so it leaves the mirror and the project both.
  await expect(page.locator('main').getByText('Wireframe home page')).toHaveCount(0)
  await page.locator('nav').getByRole('button', { name: /^Someday/ }).first().click()
  await expect(page.getByText('Wireframe home page')).toBeVisible()
})

/** Reordering still has to work: pointerWithin resolves to the row under the
 *  pointer, which is the same answer closestCenter gave inside a list. */
test('reordering within a list still works', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.locator('nav').getByRole('button', { name: /^Inbox/ }).first().click()
  for (const t of ['first', 'second', 'third']) {
    await page.getByLabel('Add a task').fill(t)
    await page.getByRole('button', { name: 'Add' }).click()
  }

  const handle = page.locator('.row', { hasText: 'first' }).locator('.row__handle')
  const target = page.locator('.row', { hasText: 'third' })
  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 })
  await page.waitForTimeout(150)
  await page.mouse.up()
  await page.waitForTimeout(300)

  await expect(page.locator('.row__title')).toHaveText(['second', 'third', 'first'])
})
