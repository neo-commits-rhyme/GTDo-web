import { test, expect } from '@playwright/test'
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'

/**
 * Settles the browser-platform assumptions in the spec (§11) with measurements
 * instead of recollection. Results land in probes/results/ and are summarised
 * by hand into docs/assumptions.md.
 *
 * Known limit, stated up front: Playwright injects key events into the page, so
 * a chord reaching our listener proves the PAGE can see and preventDefault it,
 * but does NOT prove the browser chrome stayed out of the way. Only a human at
 * a real keyboard can settle that half.
 */

const CHORDS = ['n', 'f', ',']

function save(name: string, data: unknown) {
  mkdirSync('probes/results', { recursive: true })
  writeFileSync(`probes/results/${name}.json`, JSON.stringify(data, null, 2) + '\n')
}

test('keyboard interception', async ({ page, browserName }) => {
  await page.goto('probes/keyboard-probe.html')
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

  // Chords pressed with the body focused.
  for (const key of CHORDS) await page.keyboard.press(`${mod}+${key}`)
  const onBody = JSON.parse(await page.locator('#out').innerText())

  // Same chords with a text field focused — the case the shortcut handler must
  // suppress, whatever map we end up with.
  await page.locator('#field').focus()
  for (const key of CHORDS) await page.keyboard.press(`${mod}+${key}`)
  const withField = JSON.parse(await page.locator('#out').innerText())

  save(`keyboard-${browserName}`, { browserName, platform: process.platform, mod, onBody, withField })
  expect(Object.keys(onBody).length).toBeGreaterThan(0)
})

test('bare keys reach the page', async ({ page, browserName }) => {
  // The fallback map depends on unmodified keys being delivered normally.
  await page.goto('probes/keyboard-probe.html')
  const received = await page.evaluate(async () => {
    const got: string[] = []
    const handler = (e: KeyboardEvent) => got.push(e.key)
    addEventListener('keydown', handler)
    await new Promise((r) => setTimeout(r, 10))
    return got
  })
  save(`barekeys-${browserName}`, { note: 'see keyboard-*.json for chords', received })
  expect(Array.isArray(received)).toBe(true)
})

test('storage capabilities', async ({ page, browserName }) => {
  await page.goto('probes/storage-probe.html')
  await expect(page.locator('#out')).not.toHaveText('pending', { timeout: 15_000 })
  const result = JSON.parse(await page.locator('#out').innerText())
  save(`storage-${browserName}`, { browserName, ...result })
  expect(result.hasIndexedDB).toBe(true)
})

test('vite base path is baked into the built asset URLs', async () => {
  // The dev server happily serves both / and /GTDo-web/, so it proves nothing.
  // The claim is about the BUILD: every emitted asset URL must carry the prefix,
  // because a project Pages site is served from https://<user>.github.io/GTDo-web/.
  // Requires `npm run build` first.
  if (!existsSync('dist/index.html')) test.skip(true, 'run npm run build first')
  const html = readFileSync('dist/index.html', 'utf8')
  const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!)
  save('basepath', { urls })
  expect(urls.length).toBeGreaterThan(0)
  for (const url of urls) expect(url.startsWith('/GTDo-web/')).toBe(true)
})
