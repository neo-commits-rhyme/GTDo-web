/**
 * The 16 list glyphs, drawn against the SF Symbol vocabulary the Swift app
 * uses. The web renders its own shapes but stores the identical names, so a
 * list customised here opens on macOS with the right icon.
 *
 * All on a 16×16 box, stroked rather than filled, so one set works at any
 * size and inherits the surrounding colour.
 */

import type { ReactNode } from 'react'

const GLYPHS: Record<string, ReactNode> = {
  'list.bullet': (
    <>
      <circle cx="2.5" cy="4" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="2.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <line x1="6" y1="4" x2="14" y2="4" />
      <line x1="6" y1="8" x2="14" y2="8" />
      <line x1="6" y1="12" x2="14" y2="12" />
    </>
  ),
  star: <path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />,
  flag: (
    <>
      <path d="M3.5 2v12" />
      <path d="M3.5 2.6h8.8l-1.8 3 1.8 3H3.5z" />
    </>
  ),
  tag: (
    <>
      <path d="M2 2h5.2l6.6 6.6a1.2 1.2 0 010 1.7l-3.5 3.5a1.2 1.2 0 01-1.7 0L2 7.2z" />
      <circle cx="5" cy="5" r="1.1" />
    </>
  ),
  bookmark: <path d="M4 1.8h8v12.4L8 11l-4 3.2z" />,
  bolt: <path d="M9.4 1.5L3.6 8.9h3.4l-.9 5.6 6-7.7H8.6z" />,
  flame: (
    <>
      <path d="M8 1.5S4 5 4 9a4 4 0 008 0c0-1.6-1-3-1.7-3.8-.4 1.3-1.1 1.8-1.6 1.8.6-2.2-.7-4.6-.7-5.5z" />
    </>
  ),
  leaf: (
    <>
      <path d="M13.8 2.2C7 1.6 2.6 4.6 2.6 9a4.4 4.4 0 004.4 4.4c4.4 0 7.4-4.4 6.8-11.2z" />
      <path d="M11.4 4.6C8 6 5.4 8.6 4.2 12" />
    </>
  ),
  heart: <path d="M8 13.6S1.8 9.9 1.8 5.9A3.1 3.1 0 018 4.2a3.1 3.1 0 016.2 1.7c0 4-6.2 7.7-6.2 7.7z" />,
  cart: (
    <>
      <path d="M1.4 2h1.9l2 8.2h7.3" />
      <path d="M4.6 4.6h9.8l-1.3 4.4H5.6" />
      <circle cx="6.4" cy="13" r="1.1" />
      <circle cx="12" cy="13" r="1.1" />
    </>
  ),
  briefcase: (
    <>
      <rect x="1.6" y="4.6" width="12.8" height="9" rx="1.4" />
      <path d="M5.6 4.6V3.2a1 1 0 011-1h2.8a1 1 0 011 1v1.4" />
      <line x1="1.6" y1="8.6" x2="14.4" y2="8.6" />
    </>
  ),
  book: (
    <>
      <path d="M2.2 3a1.6 1.6 0 011.6-1.6H8v12H3.8A1.6 1.6 0 002.2 15z" />
      <path d="M13.8 3a1.6 1.6 0 00-1.6-1.6H8v12h4.2A1.6 1.6 0 0113.8 15z" />
    </>
  ),
  house: (
    <>
      <path d="M2 7l6-5 6 5v6.4a1 1 0 01-1 1H3a1 1 0 01-1-1z" />
      <path d="M6.2 14.4V9.4h3.6v5" />
    </>
  ),
  airplane: <path d="M8 1.4c.8 0 1.2 1.2 1.2 2.6v1.6l5 3v1.6l-5-1.4v3l1.8 1.4v1.2L8 13.8l-3 1.6v-1.2l1.8-1.4v-3l-5 1.4V9.6l5-3V5c0-1.4.4-2.6 1.2-2.6z" />,
  graduationcap: (
    <>
      <path d="M8 2.2L15 5.6 8 9 1 5.6z" />
      <path d="M4 7.2v3.6c0 1.2 1.8 2.2 4 2.2s4-1 4-2.2V7.2" />
    </>
  ),
  'dollarsign.circle': (
    <>
      <circle cx="8" cy="8" r="6.3" />
      <path d="M10 5.8c-.4-.7-1.1-1.1-2-1.1-1.2 0-2 .6-2 1.5 0 2.2 4.2 1.1 4.2 3.4 0 1-.9 1.7-2.2 1.7-1 0-1.8-.4-2.2-1.2" />
      <line x1="8" y1="3.4" x2="8" y2="12.6" />
    </>
  ),
}

/**
 * Unknown names fall back to the bullet-list glyph rather than rendering
 * nothing — a file written by a future macOS version may carry a symbol we do
 * not draw, and an empty box reads as a bug.
 */
export function ListIcon({ symbol, size = 15 }: { symbol: string | null; size?: number }) {
  const glyph = (symbol !== null && GLYPHS[symbol]) || GLYPHS['list.bullet']
  return (
    <svg
      className="list-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The list name is already the accessible label; announcing the glyph
      // too would read every list twice.
      aria-hidden="true"
      focusable="false"
    >
      {glyph}
    </svg>
  )
}
