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
  await page.keyboard.press('1')
  await page.keyboard.press('2')
  await expect(sheet.getByText('2 of 3')).toBeVisible()

  // two → Next Actions → Do It → commit
  await page.keyboard.press('2')
  await page.keyboard.press('1')
  await page.keyboard.press('1')
  await expect(sheet.getByText('3 of 3')).toBeVisible()

  // three → Defer → Notes, which empties the queue
  await page.keyboard.press('1')
  await page.keyboard.press('3')
  await expect(sheet.getByText('Inbox Zero')).toBeVisible()

  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('button', { name: 'Review' })).toBeDisabled()
})

test('back returns from a deadline step to Next Actions', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByLabel('Add a task').fill('first')
  await page.getByRole('button', { name: 'Add' }).click()

  await page.getByRole('button', { name: 'Review (1)' }).click()
  const sheet = page.getByRole('dialog', { name: 'Inbox Review' })
  await page.keyboard.press('2') // Next Actions
  await page.keyboard.press('1') // Do It
  await expect(sheet.getByRole('button', { name: /Set deadline/ })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(sheet.getByRole('button', { name: /Delegate It/ })).toBeVisible()
})

test('a review action is undoable', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: /^Inbox/ }).click()
  await page.getByLabel('Add a task').fill('reversible')
  await page.getByRole('button', { name: 'Add' }).click()

  await page.getByRole('button', { name: 'Review (1)' }).click()
  await page.keyboard.press('1') // Defer
  await page.keyboard.press('2') // Someday

  const bar = page.getByRole('status', { name: 'Undo available' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('reversible')).toBeVisible()
})
