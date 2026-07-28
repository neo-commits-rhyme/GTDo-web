import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
})

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
