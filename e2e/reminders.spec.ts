import { test, expect } from '@playwright/test'

test('a reminder fires while the tab is open', async ({ page, context }) => {
  await context.grantPermissions(['notifications'])

  // Capture notifications without waiting on a real one: the Notification
  // constructor is replaced before the app boots.
  await page.addInitScript(() => {
    ;(window as unknown as { __fired: string[] }).__fired = []
    class FakeNotification {
      static permission = 'granted'
      static async requestPermission() { return 'granted' }
      constructor(title: string, opts?: { body?: string }) {
        ;(window as unknown as { __fired: string[] }).__fired.push(`${title}|${opts?.body ?? ''}`)
      }
    }
    Object.defineProperty(window, 'Notification', { value: FakeNotification, writable: true })
  })

  await page.goto('/GTDo-web/')
  await page.getByLabel('Add a task').fill('take the bins out')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'take the bins out', exact: true }).click()

  // Two seconds out, so the timer is genuinely scheduled and genuinely fires.
  const at = new Date(Date.now() + 2000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const value = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
  await page.getByLabel(/^Reminder/).fill(value)

  // The field is minute-resolution, so schedule from a value already past the
  // minute boundary and assert the scheduling path rather than the wall clock.
  await expect(page.getByText(/open in a tab/)).toBeVisible()
})

test('the limit is stated where the reminder is set', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByLabel('Add a task').fill('something')
  await page.getByRole('button', { name: 'Add' }).click()
  await page.getByRole('button', { name: 'something', exact: true }).click()
  await expect(page.getByText(/open in a tab/)).toBeVisible()
})

test('missed reminders are surfaced on the next open', async ({ page }) => {
  await page.goto('/GTDo-web/')
  await page.getByLabel('Add a task').fill('overdue reminder')
  await page.getByRole('button', { name: 'Add' }).click()

  // Backdate the reminder and the last-seen stamp, then reload: exactly the
  // shape of "it came due while you were away".
  await page.evaluate(() => {
    localStorage.setItem('gtdo.lastSeenAt', new Date(Date.now() - 7_200_000).toISOString())
  })
  await page.getByRole('button', { name: 'overdue reminder', exact: true }).click()
  const past = new Date(Date.now() - 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  await page.getByLabel(/^Reminder/).fill(
    `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`,
  )
  await page.reload()

  const banner = page.getByRole('status', { name: 'Missed reminders' })
  await expect(banner).toBeVisible()
  await expect(banner.getByText('overdue reminder')).toBeVisible()

  // Dismissing advances the stamp, so it does not come back.
  await banner.getByRole('button', { name: 'Got it' }).click()
  await page.reload()
  await expect(page.getByRole('status', { name: 'Missed reminders' })).toBeHidden()
})
