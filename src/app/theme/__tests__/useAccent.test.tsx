import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ACCENTS, ACCENT_KEY, DEFAULT_ACCENT, accentRatios } from '../accents'
import { useAccent } from '../useAccent'

function Harness() {
  const [id, setID] = useAccent()
  return (
    <>
      <span data-testid="id">{id}</span>
      <button onClick={() => setID('teal')}>teal</button>
    </>
  )
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('style')
})

describe('Accents', () => {
  it('offersSevenAndNotTheMacOSSystemOne', () => {
    expect(ACCENTS).toHaveLength(7)
    // macOS's eighth followed the OS accent colour; it has no web meaning.
    expect(ACCENTS.map((a) => a.id)).not.toContain('system')
  })

  it('everyAccentClearsAAOnPaperInBothSchemes', () => {
    for (const accent of ACCENTS) {
      const { light, dark } = accentRatios(accent)
      expect(light, `${accent.label} light ${accent.light} = ${light.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
      expect(dark, `${accent.label} dark ${accent.dark} = ${dark.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('everyAccentIDIsUnique', () => {
    expect(new Set(ACCENTS.map((a) => a.id)).size).toBe(ACCENTS.length)
  })

  it('defaultsToAmberWhenNothingIsStored', () => {
    render(<Harness />)
    expect(screen.getByTestId('id').textContent).toBe(DEFAULT_ACCENT)
  })

  it('choosingAnAccentSetsBothSchemeValuesAndPersists', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByText('teal'))
    const style = document.documentElement.style
    // Both are written: a media query cannot choose between inline values.
    expect(style.getPropertyValue('--accent-light')).toBe('#0C6B63')
    expect(style.getPropertyValue('--accent-dark')).toBe('#5FCFC2')
    expect(localStorage.getItem(ACCENT_KEY)).toBe('teal')
  })

  it('ignoresAJunkStoredValue', () => {
    localStorage.setItem(ACCENT_KEY, 'chartreuse')
    render(<Harness />)
    expect(screen.getByTestId('id').textContent).toBe(DEFAULT_ACCENT)
  })
})
