import { test, expect } from '@playwright/test'

/** Seeds a list with two tasks and selects it. */
async function seed(page: import('@playwright/test').Page) {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Notes/ }).click()
  for (const title of ['alpha', 'beta']) {
    await page.getByLabel('Add a task').fill(title)
    await page.getByRole('button', { name: 'Add' }).click()
  }
  await expect(page.getByText('beta')).toBeVisible()
}

test('a task can be reordered by keyboard alone', async ({ page }) => {
  // The promise sub-project 1 made when it shipped [ and ] — drag layers over
  // these, it does not replace them.
  await seed(page)
  const order = () => page.locator('.row__title').allTextContents()
  expect(await order()).toEqual(['alpha', 'beta'])

  // Selecting a row opens the detail pane, and Escape closes it by clearing
  // the selection — so the bracket keys operate with the pane open.
  await page.getByRole('button', { name: 'alpha', exact: true }).click()
  await page.keyboard.press(']')
  await expect.poll(order).toEqual(['beta', 'alpha'])
})

test('every row exposes a drag handle without losing its other controls', async ({ page }) => {
  await seed(page)
  await expect(page.getByRole('button', { name: 'Reorder alpha' })).toBeAttached()
  await expect(page.getByRole('checkbox', { name: 'Complete alpha' })).toBeAttached()
  await expect(page.getByRole('button', { name: 'alpha', exact: true })).toBeAttached()
})

test('undo restores a trashed task', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: 'alpha', exact: true }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(page.getByText('alpha')).toHaveCount(0)

  const bar = page.getByRole('status', { name: 'Undo available' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('alpha')).toBeVisible()
})

test('cmd-z undoes without touching the bar', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: 'alpha', exact: true }).click()
  await page.getByRole('button', { name: 'Move to trash' }).click()
  await expect(page.getByText('alpha')).toHaveCount(0)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await expect(page.getByText('alpha')).toBeVisible()
})
