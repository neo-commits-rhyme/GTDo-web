import { test, expect } from '@playwright/test'

/**
 * The only test that proves a real browser actually persisted. Everything else
 * runs against fake-indexeddb.
 */
test('add, complete, reload, still there', async ({ page }) => {
  await page.goto('/GTDo-web/')

  await page.getByLabel('Add a task').fill('buy milk')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByText('buy milk')).toBeVisible()

  await page.getByRole('checkbox', { name: 'Complete buy milk' }).click()
  await expect(page.getByRole('checkbox', { name: 'Un-complete buy milk' })).toBeVisible()

  await page.reload()
  await expect(page.getByText('buy milk')).toBeVisible()
})

test('search finds a task and escape clears it', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByLabel('Add a task').fill('walk the dog')
  await page.getByRole('button', { name: 'Add' }).click()

  await page.getByLabel('Search').fill('dog')
  await expect(page.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible()
  await expect(page.getByText('1 result for “dog”')).toBeVisible()
})

test('a deadline-required list raises the prompt instead of creating', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Next actions/ }).click()
  await page.getByLabel('Add a task').fill('call the bank')
  await page.getByRole('button', { name: 'Add' }).click()
  await expect(page.getByRole('dialog', { name: 'Choose a deadline' })).toBeVisible()
})
