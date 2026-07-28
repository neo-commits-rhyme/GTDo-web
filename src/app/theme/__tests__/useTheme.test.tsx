import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TOKENS } from '../tokens'
import { useTheme, THEME_KEY } from '../useTheme'

function Harness() {
  const [choice, setChoice] = useTheme()
  return (
    <>
      <span data-testid="choice">{choice}</span>
      <button onClick={() => setChoice('dark')}>dark</button>
      <button onClick={() => setChoice('light')}>light</button>
      <button onClick={() => setChoice('system')}>system</button>
    </>
  )
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.remove() })
})

/** The two media-keyed metas index.html ships, in document order. */
function seedSchemeMetas(): void {
  for (const [scheme, query] of [['light', 'light'], ['dark', 'dark']] as const) {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', TOKENS.paper[scheme])
    meta.setAttribute('media', `(prefers-color-scheme: ${query})`)
    document.head.appendChild(meta)
  }
}

const themeColors = () =>
  [...document.head.querySelectorAll('meta[name="theme-color"]')].map((m) => ({
    content: m.getAttribute('content'),
    media: m.getAttribute('media'),
  }))

describe('useTheme', () => {
  it('defaultsToSystemAndSetsNoAttribute', () => {
    render(<Harness />)
    expect(screen.getByTestId('choice').textContent).toBe('system')
    // System means "let prefers-color-scheme decide" — no override present.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('choosingDarkStampsTheRootAndPersists', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
  })

  it('choosingLightWinsEvenWhenTheSystemPrefersDark', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('light'))
    // The override must beat the media query in BOTH directions, which is why
    // tokens.css states each scheme outright.
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('returningToSystemRemovesTheOverride', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    await user.click(screen.getByText('system'))
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(THEME_KEY)).toBe('system')
  })

  it('restoresAStoredChoiceOnMount', () => {
    localStorage.setItem(THEME_KEY, 'light')
    render(<Harness />)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('ignoresAJunkStoredValue', () => {
    localStorage.setItem(THEME_KEY, 'chartreuse')
    render(<Harness />)
    expect(screen.getByTestId('choice').textContent).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('The browser chrome', () => {
  it('followsAnExplicitChoiceInsteadOfTheOSPreference', async () => {
    // The media-keyed metas answer for the OS only, and nothing updated them:
    // an installed PWA forced to dark kept light chrome around a dark app —
    // permanently, not just until the first paint.
    const user = userEvent.setup()
    seedSchemeMetas()
    render(<Harness />)
    await user.click(screen.getByText('dark'))

    // The browser takes the FIRST theme-color meta whose media matches, so an
    // override that lands after the media-keyed pair never gets read.
    const first = themeColors()[0]
    expect(first?.content).toBe(TOKENS.paper.dark)
    expect(first?.media, 'the override must match unconditionally').toBeNull()
  })

  it('switchesTheChromeWithTheChoice', async () => {
    const user = userEvent.setup()
    seedSchemeMetas()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    await user.click(screen.getByText('light'))
    expect(themeColors()[0]?.content).toBe(TOKENS.paper.light)
    // One override, not one per switch.
    expect(themeColors().filter((m) => m.media === null)).toHaveLength(1)
  })

  it('handsTheChromeBackToTheMediaQueryOnSystem', async () => {
    const user = userEvent.setup()
    seedSchemeMetas()
    render(<Harness />)
    await user.click(screen.getByText('dark'))
    await user.click(screen.getByText('system'))
    expect(themeColors()).toEqual([
      { content: TOKENS.paper.light, media: '(prefers-color-scheme: light)' },
      { content: TOKENS.paper.dark, media: '(prefers-color-scheme: dark)' },
    ])
  })
})
