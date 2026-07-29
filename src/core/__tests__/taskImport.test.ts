/**
 * Port of Tests/GTDoTests/TaskImportTests.swift and
 * TaskImportRobustnessTests.swift — same cases, so the two apps import the same
 * file the same way.
 */

import { describe, expect, it } from 'vitest'
import { decodeText, fields, stripMarker, taskTitles } from '../taskImport'

const utf8 = (s: string) => new TextEncoder().encode(s)

/** UTF-16 without a BOM, either endianness. */
function utf16(s: string, littleEndian: boolean): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  const view = new DataView(out.buffer)
  for (let i = 0; i < s.length; i++) view.setUint16(i * 2, s.charCodeAt(i), littleEndian)
  return out
}

describe('line splitting', () => {
  it('turns plain lines into titles', () => {
    expect(taskTitles('смотреть подкаст с Дуровым\nпрочесть все книги на полке\nпочистить мак'))
      .toEqual(['смотреть подкаст с Дуровым', 'прочесть все книги на полке', 'почистить мак'])
  })

  it('imports a numbered file exactly like the same file without numbers', () => {
    const numbered = '1. смотреть подкаст\n2. прочесть книги\n3. почистить мак'
    const plain = 'смотреть подкаст\nпрочесть книги\nпочистить мак'
    expect(taskTitles(numbered)).toEqual(taskTitles(plain))
  })

  it('handles every line ending', () => {
    expect(taskTitles('one\r\ntwo\r\nthree')).toEqual(['one', 'two', 'three'])
    expect(taskTitles('one\rtwo\rthree')).toEqual(['one', 'two', 'three'])
  })

  it('drops blank and whitespace-only lines', () => {
    expect(taskTitles('\n  one  \n\n\t\n two\n   \n')).toEqual(['one', 'two'])
  })

  it('does not make a task out of a bare marker', () => {
    expect(taskTitles('1.\n2.\n-\n*\n[ ]')).toEqual([])
  })
})

describe('markers', () => {
  it('strips the common list markers', () => {
    const text = [
      '1. numbered dot', '12) numbered paren', '3: numbered colon',
      '- dash', '* star', '• bullet', '+ plus', '— em dash',
    ].join('\n')
    expect(taskTitles(text)).toEqual([
      'numbered dot', 'numbered paren', 'numbered colon',
      'dash', 'star', 'bullet', 'plus', 'em dash',
    ])
  })

  it('strips markdown checkboxes', () => {
    expect(taskTitles('- [ ] unchecked\n- [x] checked\n1. [X] numbered box'))
      .toEqual(['unchecked', 'checked', 'numbered box'])
  })

  /** A marker is only a marker when whitespace follows it. */
  it('keeps numbers that are part of the task', () => {
    expect(taskTitles('1.5 литра воды\n12.07 сходить к врачу\n2 eggs\n-verbatim flag'))
      .toEqual(['1.5 литра воды', '12.07 сходить к врачу', '2 eggs', '-verbatim flag'])
  })

  it('treats typographic bullets as markers even with no space', () => {
    expect(taskTitles('•почистить мак\n▪прочесть книги')).toEqual(['почистить мак', 'прочесть книги'])
  })

  it('does not treat an ASCII hyphen without a space as a marker', () => {
    expect(taskTitles('-verbatim\n*starred*')).toEqual(['-verbatim', '*starred*'])
  })

  it('exposes stripMarker on its own', () => {
    expect(stripMarker('  3)   проверить почту')).toBe('проверить почту')
  })
})

describe('CSV', () => {
  it('keeps unquoted commas in the title', () => {
    expect(taskTitles('купить хлеб, молоко и сыр\nпочистить мак'))
      .toEqual(['купить хлеб, молоко и сыр', 'почистить мак'])
  })

  it('unwraps quoted single-column fields', () => {
    expect(taskTitles('"купить хлеб, молоко"\n"сказать ""привет"""'))
      .toEqual(['купить хлеб, молоко', 'сказать "привет"'])
  })

  it('takes the first column of a table with a header', () => {
    const text = 'Task,Due,Notes\nпочистить мак,2026-08-01,generic\nпрочесть книги,2026-09-01,shelf'
    expect(taskTitles(text)).toEqual(['почистить мак', 'прочесть книги'])
  })

  /** Without a header there is no way to tell a two-column table from two
   *  sentences containing commas. Splitting would silently delete half a task. */
  it('keeps the whole line when columns have no header', () => {
    expect(taskTitles('почистить мак,2026-08-01\nпрочесть книги,2026-09-01'))
      .toEqual(['почистить мак,2026-08-01', 'прочесть книги,2026-09-01'])
  })

  it('does not read ragged commas as a table', () => {
    expect(taskTitles('купить хлеб, молоко\nпочистить мак\nпрочесть книги'))
      .toEqual(['купить хлеб, молоко', 'почистить мак', 'прочесть книги'])
  })

  it('parses fields with quoting', () => {
    expect(fields('a,"b, c",d')).toEqual(['a', 'b, c', 'd'])
  })
})

describe('messy but genuine text', () => {
  it('collapses tabs and runs of spaces', () => {
    expect(taskTitles('прочесть\tвсе    книги')).toEqual(['прочесть все книги'])
  })

  it('keeps a tab-separated line as one task', () => {
    expect(taskTitles('почистить мак\t2026-08-01')).toEqual(['почистить мак 2026-08-01'])
  })

  it('does not lose text from a quoted field that wraps onto a second line', () => {
    expect(taskTitles('"first half\nsecond half"\nпочистить мак'))
      .toEqual(['first half', 'second half', 'почистить мак'])
  })

  it('keeps very long lines whole', () => {
    const long = 'я'.repeat(5000)
    expect(taskTitles(long)).toEqual([long])
  })

  /** One file with every wrinkle at once. */
  it('imports a thoroughly messy file cleanly', () => {
    const source = [
      '- [ ] купить хлеб, молоко',
      '• позвонить маме',
      '[x] сделать бэкап',
      '',
      '  3)   проверить\tпочту',
      '"сказать ""привет"""',
    ].join('\n')
    expect(taskTitles(source)).toEqual([
      'купить хлеб, молоко', 'позвонить маме', 'сделать бэкап',
      'проверить почту', 'сказать "привет"',
    ])
  })
})

describe('decoding', () => {
  it('decodes UTF-8 with and without a BOM', () => {
    const text = 'почистить мак\n'
    expect(decodeText(utf8(text))).toBe(text)
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(text)]))).toBe(text)
  })

  it('decodes UTF-16 with a BOM', () => {
    const text = 'почистить мак\n'
    expect(decodeText(new Uint8Array([0xff, 0xfe, ...utf16(text, true)]))).toBe(text)
    expect(decodeText(new Uint8Array([0xfe, 0xff, ...utf16(text, false)]))).toBe(text)
  })

  /** A UTF-16 file with no BOM is full of NULs, and NUL is valid UTF-8 — the
   *  naive order "succeeds" with a string full of control characters. */
  it('decodes UTF-16 without a BOM, either endianness', () => {
    const text = 'почистить мак\nпрочесть книги'
    expect(decodeText(utf16(text, true))).toBe(text)
    expect(decodeText(utf16(text, false))).toBe(text)
    const ascii = 'buy milk\nclean the mac'
    expect(decodeText(utf16(ascii, true))).toBe(ascii)
    expect(decodeText(utf16(ascii, false))).toBe(ascii)
  })

  /** Cyrillic lists written on Windows are cp1251, which is not valid UTF-8 and
   *  would otherwise import as mojibake. */
  it('decodes Windows Cyrillic', () => {
    // "почистить мак" in cp1251.
    const cp1251 = new Uint8Array([
      0xef, 0xee, 0xf7, 0xe8, 0xf1, 0xf2, 0xe8, 0xf2, 0xfc, 0x20, 0xec, 0xe0, 0xea,
    ])
    expect(decodeText(cp1251)).toBe('почистить мак')
  })

  it('rejects binary data', () => {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    for (let i = 0; i < 512; i++) png.push((i * 37) % 256)
    expect(decodeText(new Uint8Array(png))).toBeNull()
  })

  it('rejects data with NUL bytes', () => {
    const raw = new Uint8Array([...utf8('task one'), 0, 0, 0, ...utf8('task two')])
    expect(decodeText(raw)).toBeNull()
  })

  /** Compressed bytes have no NULs to catch them out, but are still not a list. */
  it('rejects high control-character content', () => {
    const noise = new Uint8Array(512)
    for (let i = 0; i < noise.length; i++) noise[i] = 1 + ((i * 7) % 31)
    expect(decodeText(noise)).toBeNull()
  })

  it('treats an empty file as empty text', () => {
    expect(decodeText(new Uint8Array())).toBe('')
    expect(taskTitles('')).toEqual([])
  })
})
