import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { LIST_COLORS, LIST_SYMBOLS, isKnownColor, isKnownSymbol } from '../theme/listPalette'
import { ListIcon } from '../ListIcon'

/**
 * Copied from Sources/GTDo/Theme/ListPalette.swift. These two arrays ARE the
 * interop contract for customisation — the web may write nothing outside them.
 */
const SWIFT_HEXES = [
  '#FF3B30', '#FF9500', '#FFCC00', '#34C759', '#00C7BE', '#30B0C7',
  '#007AFF', '#5856D6', '#AF52DE', '#FF2D55', '#A2845E', '#8E8E93',
]
const SWIFT_SYMBOLS = [
  'list.bullet', 'star', 'flag', 'tag', 'bookmark', 'bolt', 'flame', 'leaf',
  'heart', 'cart', 'briefcase', 'book', 'house', 'airplane',
  'graduationcap', 'dollarsign.circle',
]

describe('List palette', () => {
  it('theColourVocabularyIsExactlyTheSwiftOne', () => {
    expect(LIST_COLORS.map((c) => c.hex)).toEqual(SWIFT_HEXES)
  })

  it('theSymbolVocabularyIsExactlyTheSwiftOne', () => {
    expect(LIST_SYMBOLS.map((s) => s.name)).toEqual(SWIFT_SYMBOLS)
  })

  it('rejectsValuesOutsideTheVocabulary', () => {
    expect(isKnownColor('#123456')).toBe(false)
    expect(isKnownColor('#FF3B30')).toBe(true)
    expect(isKnownSymbol('sparkles')).toBe(false)
    expect(isKnownSymbol('briefcase')).toBe(true)
  })

  it('everySymbolRendersARealGlyph', () => {
    for (const name of SWIFT_SYMBOLS) {
      const { container } = render(<ListIcon symbol={name} />)
      const svg = container.querySelector('svg')
      expect(svg, `${name} has no svg`).not.toBeNull()
      expect(
        svg!.querySelector('path, circle, rect, line, polyline'),
        `${name} renders an empty box`,
      ).not.toBeNull()
    }
  })

  it('everySymbolIsVisuallyDistinct', () => {
    // A copy-paste slip would give two names the same drawing, and the picker
    // would silently offer duplicates.
    const drawings = SWIFT_SYMBOLS.map((name) => {
      const { container } = render(<ListIcon symbol={name} />)
      return container.querySelector('svg')!.innerHTML
    })
    expect(new Set(drawings).size).toBe(SWIFT_SYMBOLS.length)
  })

  it('anUnknownSymbolFallsBackRatherThanRenderingNothing', () => {
    // A file from a future macOS version may carry a symbol we do not draw.
    const { container } = render(<ListIcon symbol="sparkles" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.querySelector('path, circle, line')).not.toBeNull()
  })

  it('handlesANullSymbol', () => {
    const { container } = render(<ListIcon symbol={null} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('iconsAreDecorativeSoListsAreNotAnnouncedTwice', () => {
    const { container } = render(<ListIcon symbol="star" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
  })
})
