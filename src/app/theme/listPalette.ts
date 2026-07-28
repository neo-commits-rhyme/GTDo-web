/**
 * The closed interop vocabulary. Mirrors Sources/GTDo/Theme/ListPalette.swift.
 *
 * The web may write ONLY these values into list.colorHex and list.symbol. A
 * thirteenth colour or seventeenth icon would round-trip to macOS as an
 * unknown value and render as nothing — silent one-way data damage from a
 * feature that looked like it worked. A test pins both lists.
 */

export const LIST_COLORS = [
  { name: 'Red', hex: '#FF3B30' },
  { name: 'Orange', hex: '#FF9500' },
  { name: 'Yellow', hex: '#FFCC00' },
  { name: 'Green', hex: '#34C759' },
  { name: 'Mint', hex: '#00C7BE' },
  { name: 'Teal', hex: '#30B0C7' },
  { name: 'Blue', hex: '#007AFF' },
  { name: 'Indigo', hex: '#5856D6' },
  { name: 'Purple', hex: '#AF52DE' },
  { name: 'Pink', hex: '#FF2D55' },
  { name: 'Brown', hex: '#A2845E' },
  { name: 'Gray', hex: '#8E8E93' },
] as const

export const LIST_SYMBOLS = [
  { name: 'list.bullet', label: 'List' },
  { name: 'star', label: 'Star' },
  { name: 'flag', label: 'Flag' },
  { name: 'tag', label: 'Tag' },
  { name: 'bookmark', label: 'Bookmark' },
  { name: 'bolt', label: 'Bolt' },
  { name: 'flame', label: 'Flame' },
  { name: 'leaf', label: 'Leaf' },
  { name: 'heart', label: 'Heart' },
  { name: 'cart', label: 'Cart' },
  { name: 'briefcase', label: 'Briefcase' },
  { name: 'book', label: 'Book' },
  { name: 'house', label: 'House' },
  { name: 'airplane', label: 'Airplane' },
  { name: 'graduationcap', label: 'Graduation Cap' },
  { name: 'dollarsign.circle', label: 'Money' },
] as const

export type ListSymbolName = (typeof LIST_SYMBOLS)[number]['name']
export type ListColorHex = (typeof LIST_COLORS)[number]['hex']

export function isKnownSymbol(name: string): name is ListSymbolName {
  return LIST_SYMBOLS.some((s) => s.name === name)
}

export function isKnownColor(hex: string): hex is ListColorHex {
  return LIST_COLORS.some((c) => c.hex === hex)
}
