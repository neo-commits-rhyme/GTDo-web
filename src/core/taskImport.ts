/**
 * Turns a plain-text or CSV file into task titles: one line, one task.
 * Port of Sources/GTDo/Store/TaskImport.swift.
 *
 * These files are hand-written lists — numbered or not, sometimes saved out of
 * a spreadsheet, often written on another machine — so the rules are
 * deliberately forgiving and, where they have to guess, they guess in the
 * direction that keeps text rather than the direction that drops it.
 *
 * The one place it is strict is deciding whether a file is text at all: the
 * picker accepts any file, and the single-byte encodings decode *any* bytes
 * whatsoever, so without a check a mis-picked image becomes a few hundred
 * mojibake tasks.
 */

import { decodeAppData } from './codec'

/** Refuse to read anything larger. A task list is kilobytes; a file this big
 *  is a mis-pick. */
export const MAXIMUM_FILE_SIZE = 10 * 1024 * 1024

/**
 * A GTDo backup is valid text, so it imports happily — as a few hundred tasks
 * named `"id": "3A7F…"`. It has its own restore path in Settings, and the
 * caller should send the user there instead.
 */
export function isBackupDocument(text: string): boolean {
  try {
    decodeAppData(text)
    return true
  } catch {
    return false
  }
}

/** Column headers that mark a file as a real table rather than a list that
 *  happens to contain commas. */
const HEADER_WORDS = new Set([
  'task', 'tasks', 'title', 'name', 'item', 'items', 'todo', 'to do', 'subject',
  'задача', 'задачи', 'дело', 'дела', 'название',
])

/** Bullets that also start ordinary sentences, so they only count as markers
 *  when whitespace follows. */
const AMBIGUOUS_BULLETS = new Set(['-', '*', '+'])

/** Bullets that never start a sentence — a marker with or without a space. */
const TYPOGRAPHIC_BULLETS = new Set(['–', '—', '•', '·', '‣', '▪', '◦'])

const MARKER_PUNCTUATION = new Set(['.', ')', ':'])

const CHECKBOXES = ['[ ]', '[x]', '[X]', '[]']

const isWhitespace = (c: string) => /\s/.test(c)
const isDigit = (c: string) => c >= '0' && c <= '9'

// MARK: - Decoding

/**
 * Best-effort text from a chosen file, or null when the bytes aren't a text
 * list at all.
 */
export function decodeText(raw: Uint8Array): string | null {
  if (raw.length === 0) return ''

  const bom = decodeUsingBOM(raw)
  if (bom !== null) return isProbablyText(bom) ? bom : null

  // Before UTF-8, because a UTF-16 file without a BOM is full of NULs and NUL
  // is *valid* UTF-8 — the naive order "succeeds" with a string full of
  // control characters.
  const wide = decodeUTF16WithoutBOM(raw)
  if (wide !== null && isProbablyText(wide)) return wide

  // NULs, and not UTF-16 after all: binary.
  if (raw.includes(0)) return null

  const utf8 = tryDecode(raw, 'utf-8', true)
  if (utf8 !== null && isProbablyText(utf8)) return utf8
  // windows-1252 accepts every byte sequence in existence, so it goes last —
  // and nothing is believed until isProbablyText has seen it.
  for (const label of ['windows-1251', 'windows-1252']) {
    const text = tryDecode(raw, label, false)
    if (text !== null && isProbablyText(text)) return text
  }
  return null
}

function tryDecode(raw: Uint8Array, label: string, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(raw)
  } catch {
    return null
  }
}

function decodeUsingBOM(raw: Uint8Array): string | null {
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return tryDecode(raw.subarray(3), 'utf-8', true)
  }
  // TextDecoder strips the BOM itself.
  if (raw[0] === 0xff && raw[1] === 0xfe) return tryDecode(raw, 'utf-16le', false)
  if (raw[0] === 0xfe && raw[1] === 0xff) return tryDecode(raw, 'utf-16be', false)
  return null
}

/**
 * UTF-16 with no BOM, identified by where the NUL bytes fall.
 *
 * Every ASCII character in a UTF-16 stream contributes one NUL byte, and
 * always at the same parity: trailing for little-endian, leading for
 * big-endian. Any real list has a space or a line break in it, so the signal is
 * there even for text that is entirely Cyrillic. Plain UTF-8 has no NULs at all
 * and so never matches.
 */
function decodeUTF16WithoutBOM(raw: Uint8Array): string | null {
  if (raw.length < 4 || raw.length % 2 !== 0) return null
  let leading = 0
  let trailing = 0
  const window = Math.min(raw.length, 4096)
  for (let i = 0; i < window; i++) {
    if (raw[i] !== 0) continue
    if (i % 2 === 0) leading++
    else trailing++
  }
  if (trailing > 0 && leading === 0) return tryDecode(raw, 'utf-16le', false)
  if (leading > 0 && trailing === 0) return tryDecode(raw, 'utf-16be', false)
  return null // NULs on both sides (or none): not UTF-16 text
}

/**
 * Whether a decoded candidate reads as text rather than as bytes that happened
 * to decode. Tabs and line breaks are text; other control characters (including
 * the C1 block that mojibake is full of) are not. A little slack, because the
 * odd form feed does turn up in real exports.
 */
function isProbablyText(text: string): boolean {
  let control = 0
  let total = 0
  for (const ch of text.slice(0, 4096)) {
    total++
    if (ch === '\n' || ch === '\r' || ch === '\t') continue
    const code = ch.codePointAt(0)!
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || ch === '�') control++
  }
  if (total === 0) return true
  return control * 100 <= total
}

// MARK: - Parsing

export function taskTitles(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/﻿/g, '') // stray BOM mid-file
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

  const rows = lines.map(fields)
  const raw = isTable(rows)
    ? rows.slice(1).map((r) => r[0]!) // header row dropped
    // One field means the line was a single (possibly quoted) value, so take
    // the unwrapped field; anything else is prose with commas in it and must
    // survive whole.
    : lines.map((line, i) => (rows[i]!.length === 1 ? rows[i]![0]! : line))

  return raw.map((t) => collapseWhitespace(stripMarker(t))).filter((t) => t !== '')
}

/**
 * A table is a header row plus rows that all agree on their column count.
 * Without the header there is no way to tell two columns from one sentence
 * containing a comma, and guessing "columns" would silently delete the tail of
 * every task.
 */
function isTable(rows: string[][]): boolean {
  const header = rows[0]
  if (header === undefined || header.length < 2 || rows.length < 2) return false
  if (!HEADER_WORDS.has(header[0]!.toLowerCase())) return false
  return rows.every((r) => r.length === header.length)
}

/**
 * Splits one line on top-level commas, honouring RFC 4180 quoting (`"a, b"` is
 * one field, `""` inside quotes is a literal quote). A line with no commas and
 * no quotes comes back as itself.
 */
export function fields(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0
  while (i < line.length) {
    const c = line[i]!
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        }
        inQuotes = false
      } else {
        current += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      out.push(current)
      current = ''
    } else {
      current += c
    }
    i++
  }
  out.push(current)
  return out.map((f) => f.trim())
}

/**
 * Drops a leading list marker — `1.`, `12)`, `3:`, `-`, `*`, `•`, and a
 * markdown checkbox — so a numbered file and the same file without numbers
 * import identically.
 *
 * A number or an ASCII bullet must be followed by whitespace to count:
 * `1.5 литра`, `12.07 к врачу` and `-verbatim` are task text, not markers.
 */
export function stripMarker(line: string): string {
  let rest = line.trim()

  const first = rest[0]
  if (first !== undefined && TYPOGRAPHIC_BULLETS.has(first)) {
    rest = rest.slice(1).replace(/^\s+/, '')
  } else if (first !== undefined && AMBIGUOUS_BULLETS.has(first)) {
    rest = dropLeadingSpace(rest.slice(1)) ?? rest
  } else {
    let digits = 0
    while (digits < rest.length && isDigit(rest[digits]!)) digits++
    if (digits > 0 && MARKER_PUNCTUATION.has(rest[digits] ?? '')) {
      const stripped = dropLeadingSpace(rest.slice(digits + 1))
      if (stripped !== null) rest = stripped
    }
  }

  for (const box of CHECKBOXES) {
    if (rest.startsWith(box)) {
      rest = rest.slice(box.length).replace(/^\s+/, '')
      break
    }
  }

  return rest.trim()
}

/**
 * The remainder with its leading spaces removed, or null when the marker wasn't
 * followed by whitespace (and so wasn't a marker). An empty remainder counts: a
 * bare `1.` is a marker with nothing behind it.
 */
function dropLeadingSpace(rest: string): string | null {
  if (rest === '') return rest
  if (!isWhitespace(rest[0]!)) return null
  return rest.replace(/^\s+/, '')
}

/** Tabs and runs of spaces are layout from wherever the list was copied — a
 *  title carries one space between words. */
function collapseWhitespace(title: string): string {
  return title.split(/\s+/).filter((w) => w !== '').join(' ')
}
