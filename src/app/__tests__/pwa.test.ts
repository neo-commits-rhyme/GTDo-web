import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

const BASE = '/GTDo-web/'

describe('The manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'))

  it('isScopedToTheProjectPagesPath', () => {
    // Without the prefix an installed app opens at the wrong origin path.
    expect(manifest.scope).toBe(BASE)
    expect(manifest.start_url).toBe(BASE)
  })

  it('installsAsAStandaloneApp', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toBe('GTDo')
  })

  it('shipsTheIconSizesInstallPromptsRequire', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith(BASE), icon.src).toBe(true)
      expect(existsSync(`public${icon.src.slice(BASE.length - 1)}`), icon.src).toBe(true)
    }
  })

  it('carriesAMaskableIconSoAndroidDoesNotLetterboxIt', () => {
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true)
  })

  it('usesThePaperCanvasAsItsBackground', () => {
    expect(manifest.background_color).toBe('#FAF9F6')
  })
})

describe('index.html', () => {
  const html = readFileSync('index.html', 'utf8')

  it('linksTheManifestAndIcons', () => {
    expect(html).toContain('rel="manifest"')
    expect(html).toContain(`${BASE}manifest.webmanifest`)
    expect(html).toContain('apple-touch-icon')
  })

  it('setsAThemeColourForBothSchemes', () => {
    expect(html).toContain('prefers-color-scheme: light')
    expect(html).toContain('prefers-color-scheme: dark')
  })
})

describe('The service worker', () => {
  const exists = existsSync('dist/sw.js')
  const sw = exists ? readFileSync('dist/sw.js', 'utf8') : ''

  it('isGeneratedByTheBuild', () => {
    expect(exists, 'run npm run build first').toBe(true)
  })

  it('takesControlImmediatelySoADeployCannotStrandAnyone', () => {
    // The classic PWA failure: a waiting worker leaves users on old JS until
    // every tab closes.
    expect(sw).toContain('skipWaiting()')
    expect(sw).toContain('clients.claim()')
  })

  it('keysTheCacheToTheBuild', () => {
    const name = /const CACHE = 'gtdo-([0-9a-f]{12})'/.exec(sw)
    expect(name, 'cache name must be build-derived').not.toBeNull()
  })

  it('dropsEveryOtherCacheOnActivate', () => {
    expect(sw).toContain('caches.delete')
  })

  it('precachesTheShellAndTheBuiltAssets', () => {
    expect(sw).toContain(`${BASE}manifest.webmanifest`)
    expect(sw).toMatch(/assets\/index-[\w-]+\.js/)
  })

  it('servesNavigationsNetworkFirstSoADeployIsPickedUp', () => {
    expect(sw).toContain("request.mode === 'navigate'")
  })

  it('ignoresCrossOriginAndNonGetRequests', () => {
    expect(sw).toContain("request.method !== 'GET'")
    expect(sw).toContain('url.origin !== self.location.origin')
  })
})
