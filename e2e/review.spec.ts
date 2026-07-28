import { test, expect } from '@playwright/test'

test('a full inbox can be triaged with the keyboard alone', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  for (const title of ['one', 'two', 'three']) {
    await page.getByLabel('Add a task').fill(title)
    await page.getByRole('button', { name: 'Add' }).click()
  }

  await page.getByRole('button', { name: 'Review (3)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Inbox Review' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('1 of 3')).toBeVisible()

  // one → Defer → Someday
  await page.keyboard.press('2')
  await page.keyboard.press('1')
  await expect(sheet.getByText('2 of 3')).toBeVisible()

  // two → Next actions → Do It → commit
  await page.keyboard.press('1')
  await page.keyboard.press('1')
  await page.keyboard.press('1')
  await expect(sheet.getByText('3 of 3')).toBeVisible()

  // three → Defer → Notes, which empties the queue and closes the sheet
  await page.keyboard.press('2')
  await page.keyboard.press('1')
  await expect(sheet).toBeHidden()

  // The Inbox is empty, so Review is no longer offered.
  await expect(page.getByRole('button', { name: 'Review' })).toBeDisabled()
})

test('skip rotates without advancing the counter', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  for (const title of ['first', 'second']) {
    await page.getByLabel('Add a task').fill(title)
    await page.getByRole('button', { name: 'Add' }).click()
  }

  await page.getByRole('button', { name: 'Review (2)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Inbox Review' })
  await expect(sheet.getByText('first')).toBeVisible()
  await expect(sheet.getByText('1 of 2')).toBeVisible()

  await sheet.getByRole('button', { name: /Skip/ }).click()
  await expect(sheet.getByText('second')).toBeVisible()
  await expect(sheet.getByText('1 of 2')).toBeVisible() // still 1 — a skip is not progress
})

test('a review action is undoable', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByLabel('Add a task').fill('reversible')
  await page.getByRole('button', { name: 'Add' }).click()

  await page.getByRole('button', { name: 'Review (1)' }).click()
  await page.keyboard.press('2') // Defer
  await page.keyboard.press('1') // Someday

  const bar = page.getByRole('status', { name: 'Undo available' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('reversible')).toBeVisible()
})
