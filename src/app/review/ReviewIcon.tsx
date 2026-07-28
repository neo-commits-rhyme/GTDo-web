import type { ReactNode } from 'react'

/** The six glyphs the review rail uses, matching the Mac's SF Symbols. */
const GLYPHS: Record<string, ReactNode> = {
  tray: <><path d="M1.8 9.5h3l1 2h4.4l1-2h3" /><path d="M3.4 2.5h9.2l2.6 7v4H1.8v-4z" /></>,
  bolt: <path d="M9.4 1.5L3.6 8.9h3.4l-.9 5.6 6-7.7H8.6z" />,
  folder: <path d="M1.8 4a1 1 0 011-1h3.4l1.4 1.8h5.6a1 1 0 011 1v7.4a1 1 0 01-1 1H2.8a1 1 0 01-1-1z" />,
  trash: <><path d="M2.6 4h10.8" /><path d="M5.4 4V2.6h5.2V4" /><path d="M3.8 4l.7 9.4h7l.7-9.4" /></>,
  archive: <><rect x="1.8" y="2.6" width="12.4" height="3.2" rx=".8" /><path d="M3 5.8v6.6a1 1 0 001 1h8a1 1 0 001-1V5.8" /><path d="M6.4 8.6h3.2" /></>,
  note: <><path d="M3.4 1.8h9.2v12.4H3.4z" /><path d="M5.8 5h4.4M5.8 8h4.4M5.8 11h2.6" /></>,
  check: <><circle cx="8" cy="8" r="6.3" /><path d="M5.2 8.2l2 2 3.6-4" /></>,
  person: <><circle cx="8" cy="5.4" r="2.6" /><path d="M2.8 14c0-2.9 2.3-5 5.2-5s5.2 2.1 5.2 5" /></>,
  calendar: <><rect x="1.8" y="3" width="12.4" height="11.2" rx="1.2" /><path d="M1.8 6.4h12.4M5 1.8v2.6M11 1.8v2.6" /></>,
}

export function ReviewIcon({ name }: { name: string }) {
  return (
    <svg
      className="review__icon" width="15" height="15" viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
    >
      {GLYPHS[name] ?? GLYPHS['note']}
    </svg>
  )
}
