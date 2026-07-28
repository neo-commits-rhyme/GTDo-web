import { test, expect } from '@playwright/test'

test('a reminder actually fires while the tab is open', async ({ page }) => {
  // This test exists because the first version asserted the hint text and not
  // the notification, and the app shipped without a reminder port wired in at
  // all — every unit test passed by injecting one directly.
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

  // Seconds out, set through the DOM because the field is minute-resolution.
  await page.evaluate(() => {
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    const at = new Date(Date.now() + 2000)
    const p = (n: number) => String(n).padStart(2, '0')
    const value =
      `${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}` +
      `T${p(at.getHours())}:${p(at.getMinutes())}:${p(at.getSeconds())}`
    const setter = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __fired: string[] }).__fired), {
      timeout: 10_000,
    })
    .toEqual(['GTDo|take the bins out'])
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

  await page.getByRole('button', { name: 'overdue reminder', exact: true }).click()
  const past = new Date(Date.now() - 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  await page.getByLabel(/^Reminder/).fill(
    `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())}T${pad(past.getHours())}:${pad(past.getMinutes())}`,
  )
  // Backdate the last-seen stamp so the reminder falls after it: the shape of
  // "it came due while you were away".
  //
  // This has to be an init script rather than a plain evaluate(). The stamp is
  // now written on pagehide too, so a value planted before reload() is
  // overwritten on the way out and the app boots thinking it saw everything —
  // which is correct for a reload and wrong for the scenario under test. An
  // init script lands on the NEW document, after that final write.
  //
  // The sessionStorage latch makes it one-shot: the dismissal check below
  // reloads again, and re-backdating there would resurrect the banner and
  // assert the opposite of what that step means.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('__gtdo_backdated') !== null) return
    sessionStorage.setItem('__gtdo_backdated', 'used')
    localStorage.setItem('gtdo.lastSeenAt', new Date(Date.now() - 7_200_000).toISOString())
  })
  await page.reload()

  const banner = page.getByRole('status', { name: 'Missed reminders' })
  await expect(banner).toBeVisible()
  await expect(banner.getByText('overdue reminder')).toBeVisible()

  // Dismissing advances the stamp, so it does not come back.
  await banner.getByRole('button', { name: 'Got it' }).click()
  await page.reload()
  await expect(page.getByRole('status', { name: 'Missed reminders' })).toBeHidden()
})
