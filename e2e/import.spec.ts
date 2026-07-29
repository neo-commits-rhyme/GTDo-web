import { test, expect } from '@playwright/test'

/**
 * The file-reading path in a real browser. jsdom has no `Blob.arrayBuffer`, so
 * the unit tests only ever exercise the FileReader fallback — the branch that
 * actually runs for every user is proved here or nowhere.
 */

const LIST = [
  '1. смотреть подкаст с Дуровым',
  '2. прочесть все книги на полке',
  '',
  '- [ ] почистить мак',
  '• позвонить маме',
].join('\n')

async function openImportInput(page: import('@playwright/test').Page) {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: 'Settings' }).click()
  // The input is visually hidden behind its label, so address it directly.
  return page.locator('.import-tasks input[type=file]')
}

test('a numbered text list imports into the Inbox', async ({ page }) => {
  const input = await openImportInput(page)
  await input.setInputFiles({ name: 'list.txt', mimeType: 'text/plain', buffer: Buffer.from(LIST, 'utf8') })

  await expect(page.getByText('Added 4 tasks to the Inbox.')).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()

  // Markers stripped, blank line skipped, and the view followed the import.
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  for (const title of [
    'смотреть подкаст с Дуровым', 'прочесть все книги на полке', 'почистить мак', 'позвонить маме',
  ]) {
    await expect(page.getByText(title, { exact: true })).toBeVisible()
  }
})

test('a Windows-1251 list decodes rather than importing mojibake', async ({ page }) => {
  const input = await openImportInput(page)
  // "почистить мак" in cp1251 — not valid UTF-8, so it proves the fallback.
  const cp1251 = Buffer.from([
    0xef, 0xee, 0xf7, 0xe8, 0xf1, 0xf2, 0xe8, 0xf2, 0xfc, 0x20, 0xec, 0xe0, 0xea,
  ])
  await input.setInputFiles({ name: 'win.txt', mimeType: 'text/plain', buffer: cp1251 })

  await expect(page.getByText('Added 1 task to the Inbox.')).toBeVisible()
  await page.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.getByText('почистить мак', { exact: true })).toBeVisible()
})

test('an image is turned away instead of becoming tasks', async ({ page }) => {
  const input = await openImportInput(page)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 37) % 256)),
  ])
  await input.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: png })

  await expect(page.getByText('Skipped photo.png — not a list of text lines.')).toBeVisible()
})

test('a project task with a deadline appears in Next actions, tagged', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('button', { name: 'Load sample data' }).click()
  await page.getByRole('button', { name: 'Close settings' }).click()

  await page.getByRole('button', { name: /^Next actions/ }).click()
  const row = page.locator('.row', { hasText: 'Wireframe home page' })
  await expect(row).toBeVisible()
  await expect(row.locator('.row__project')).toHaveText(/Website redesign/)

  // Completing it there completes it in the project too.
  await page.getByRole('checkbox', { name: 'Complete Wireframe home page' }).click()
  await page.getByRole('button', { name: /^Website redesign/ }).click()
  await expect(page.getByRole('checkbox', { name: 'Un-complete Wireframe home page' })).toBeVisible()
})
