import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { encodeAppData, decodeAppData, DecodeError } from '../codec'
import { seededAppData, BuiltIn, type TaskItem } from '../models'

const FIXTURE = readFileSync('fixtures/macos-data.json', 'utf8')

const bareTask = (): TaskItem => ({
  id: '00000000-0000-0000-0000-00000000000B',
  title: 'bare/slashed title',
  note: '',
  dueDate: null,
  reminderDate: null,
  listID: BuiltIn.inbox,
  isCompleted: false,
  completedAt: null,
  isTrashed: false,
  createdAt: new Date(Date.UTC(2023, 10, 14, 22, 13, 20)),
  order: 0,
  repeatRule: null,
  trashedAt: null,
})

describe('Persistence', () => {
  it('testRoundTripIsByteIdentical', () => {
    expect(encodeAppData(decodeAppData(FIXTURE))).toBe(FIXTURE)
  })

  it('testEncoderShape', () => {
    const d = seededAppData()
    d.tasks = [bareTask()]
    const out = encodeAppData(d)
    expect(out).toContain('"createdAt" : "2023-11-14T22:13:20Z"') // no fraction, literal Z
    expect(out).toContain('"title" : "bare\\/slashed title"')      // slashes escaped
    expect(out).not.toContain('"dueDate"')                         // nil optionals omitted
    expect(out).not.toContain('null')
    expect(out).toContain('\n  "groups" : [')                      // 2-space indent, " : "
    expect(out.endsWith('}')).toBe(true)                           // no trailing newline
    expect(out.indexOf('"groups"')).toBeLessThan(out.indexOf('"lists"'))
    expect(out.indexOf('"lists"')).toBeLessThan(out.indexOf('"tasks"'))
  })

  it('testEmptyArrayMatchesFoundation', () => {
    // Foundation emits "[\n\n  ]" for an empty array under .prettyPrinted.
    const out = encodeAppData({ ...seededAppData(), tasks: [] })
    expect(out).toContain('"tasks" : [\n\n  ]')
  })

  it('testUUIDsEncodeUppercase', () => {
    const d = seededAppData()
    d.gtdOrder = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']
    expect(encodeAppData(d)).toContain('"AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"')
  })

  it('testSortedKeysIsByteWiseNotCaseInsensitive', () => {
    // Foundation sorts raw key strings, so "userOrder" follows "tasks".
    const out = encodeAppData(seededAppData())
    const keys = [...out.matchAll(/^  "(\w+)" :/gm)].map((m) => m[1]!)
    expect(keys).toEqual([...keys].sort())
  })

  it('testAllFiveRepeatUnitsRoundTrip', () => {
    const units = decodeAppData(FIXTURE).tasks.map((t) => t.repeatRule?.unit).filter(Boolean)
    expect(new Set(units)).toEqual(new Set(['day', 'weekday', 'week', 'month', 'year']))
  })

  it.each(['note', 'isCompleted', 'isTrashed', 'createdAt', 'order', 'title', 'listID', 'id'])(
    'testMissingNonOptionalTaskKeyThrows(%s)',
    (key) => {
      const parsed = JSON.parse(FIXTURE)
      delete parsed.tasks[0][key]
      expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
    },
  )

  it.each(['isBuiltIn', 'order', 'name', 'id'])('testMissingNonOptionalListKeyThrows(%s)', (key) => {
    const parsed = JSON.parse(FIXTURE)
    delete parsed.lists[0][key]
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it.each(['tasks', 'lists', 'groups'])('testMissingTopLevelKeyThrows(%s)', (key) => {
    const parsed = JSON.parse(FIXTURE)
    delete parsed[key]
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it('testAbsentSidebarOrdersAreTolerated', () => {
    // The real macOS data.json omits both — spec §3.4.
    const parsed = JSON.parse(FIXTURE)
    delete parsed.gtdOrder
    delete parsed.userOrder
    const decoded = decodeAppData(JSON.stringify(parsed))
    expect(decoded.gtdOrder).toBeNull()
    expect(decoded.userOrder).toBeNull()
  })

  it('testExplicitNullAcceptedForOptionalsRejectedForRequired', () => {
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].dueDate = null
    expect(() => decodeAppData(JSON.stringify(parsed))).not.toThrow()
    parsed.tasks[0].title = null
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it('testLowercaseUUIDAcceptedUnhyphenatedRejected', () => {
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].id = String(parsed.tasks[0].id).toLowerCase()
    expect(() => decodeAppData(JSON.stringify(parsed))).not.toThrow()
    expect(decodeAppData(JSON.stringify(parsed)).tasks[0]!.id).toBe(
      '00000000-0000-0000-0000-00000000000B',
    )
    parsed.tasks[0].id = String(parsed.tasks[0].id).replaceAll('-', '')
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it('testDateToleranceMatchesFoundation', () => {
    const withDate = (s: string) => {
      const parsed = JSON.parse(FIXTURE)
      parsed.tasks[0].createdAt = s
      return () => decodeAppData(JSON.stringify(parsed))
    }
    expect(withDate('2026-07-28T10:00:00Z')).not.toThrow()
    expect(withDate('2026-07-28T10:00:00.123Z')).not.toThrow() // accepted on input only
    expect(withDate('2026-07-28T10:00:00+00:00')).not.toThrow()
    expect(withDate('2026-07-28T10:00:00+0000')).not.toThrow()
    expect(withDate('2026-07-28T10:00:00')).toThrow(DecodeError) // no timezone
    expect(withDate('2026-07-28t10:00:00z')).toThrow(DecodeError) // lowercase
    expect(withDate('1785000000')).toThrow(DecodeError) // numeric timestamp
  })

  it('testEncodingIsLossyForSubSecondPrecision', () => {
    // Documented asymmetry: the decoder accepts fractions, the encoder drops them.
    const d = seededAppData()
    d.tasks = [{ ...bareTask(), createdAt: new Date(Date.UTC(2023, 10, 14, 22, 13, 20, 456)) }]
    expect(encodeAppData(d)).toContain('"createdAt" : "2023-11-14T22:13:20Z"')
  })

  // A completed project's timestamp lives on the list, and it is the receipt
  // un-complete matches tasks against. Before this field was carried, a web
  // round-trip dropped it silently: the project resurrected with all its tasks
  // still ticked, and the bulk completion became impossible to undo.
  it('testCompletedProjectSurvivesARoundTrip', () => {
    const parsed = JSON.parse(FIXTURE)
    const done = parsed.lists.find((l: { completedAt?: string }) => l.completedAt)
    expect(done).toBeDefined()
    const decoded = decodeAppData(FIXTURE)
    const list = decoded.lists.find((l) => l.id === done.id)
    expect(list?.completedAt).toEqual(new Date(done.completedAt))
    expect(encodeAppData(decoded)).toBe(FIXTURE)
  })

  it('testLiveProjectEmitsNoCompletedAtKey', () => {
    const d = seededAppData()
    d.lists = [{ ...d.lists[0]!, completedAt: null }]
    expect(encodeAppData(d)).not.toContain('"completedAt"')
  })

  it('testMissingCompletedAtDecodesAsNull', () => {
    const parsed = JSON.parse(FIXTURE)
    for (const l of parsed.lists) delete l.completedAt
    const decoded = decodeAppData(JSON.stringify(parsed))
    expect(decoded.lists.every((l) => l.completedAt === null)).toBe(true)
  })

  it('testMalformedListCompletedAtIsRejected', () => {
    const parsed = JSON.parse(FIXTURE)
    parsed.lists[0].completedAt = 'not a date'
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it('testUnknownKeysIgnored', () => {
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].futureField = 'whatever'
    parsed.somethingNew = 42
    expect(() => decodeAppData(JSON.stringify(parsed))).not.toThrow()
  })

  it('testDecodeErrorNamesTheMissingKeyAndPath', () => {
    const parsed = JSON.parse(FIXTURE)
    delete parsed.tasks[1].note
    try {
      decodeAppData(JSON.stringify(parsed))
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DecodeError)
      expect((e as DecodeError).key).toBe('note')
      expect((e as DecodeError).path).toBe('tasks[1]')
    }
  })

  it('testCorruptJSONIsADecodeErrorNotASyntaxError', () => {
    expect(() => decodeAppData('{ not json')).toThrow(DecodeError)
  })

  const atYear = (y: number): Date => {
    const d = new Date(Date.UTC(2000, 0, 2, 3, 4, 5))
    d.setUTCFullYear(y)
    return d
  }

  it.each([1, 1969, 1970, 2026, 9998, 9999, 10_000, 10_001, 20_266, 275_000, 400_000])(
    'testEveryEncodableDateSurvivesARoundTrip(%i)',
    (year) => {
      // toISOString() switches to the expanded '+020266-…' year outside
      // 0000–9999, and the decoder rejects it — the document written on one
      // launch is then quarantined on the next, taking every task with it.
      const d = { ...seededAppData(), tasks: [{ ...bareTask(), dueDate: atYear(year) }] }
      expect(() => decodeAppData(encodeAppData(d))).not.toThrow()
    },
  )

  it('testClampingNeverRewritesADateTheDecoderAccepts', () => {
    // The clamp window is the span DATE_RE matches, so every date that survives
    // a decode also survives the re-encode byte for byte.
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].createdAt = '0000-01-01T00:00:00Z'
    const out = encodeAppData(decodeAppData(JSON.stringify(parsed)))
    expect(out).toContain('"createdAt" : "0000-01-01T00:00:00Z"')
  })

  it('testUnrepresentableDateClampsRatherThanThrowingOutOfEncode', () => {
    // encodeAppData runs inside persist(), which has no path for a synchronous
    // throw: saveError stays null and every later mutation fails identically.
    const d = { ...seededAppData(), tasks: [{ ...bareTask(), dueDate: new Date(NaN) }] }
    expect(() => encodeAppData(d)).not.toThrow()
    expect(encodeAppData(d)).toContain('"dueDate" : "9999-12-31T23:59:59Z"')
  })

  it.each([1.5, -2.5, 1e21, Number.MAX_VALUE])('testNonIntegerTaskOrderThrows(%s)', (v) => {
    // Swift's Int decode throws on all of these; accepting them here writes a
    // file the macOS app moves aside as corrupt.
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].order = v
    expect(() => decodeAppData(JSON.stringify(parsed))).toThrow(DecodeError)
  })

  it('testNonIntegerThrowsForEveryIntField', () => {
    const decodes = (parsed: unknown) => () => decodeAppData(JSON.stringify(parsed))

    const lists = JSON.parse(FIXTURE)
    lists.lists[0].order = 1.5
    expect(decodes(lists)).toThrow(DecodeError)

    const groups = JSON.parse(FIXTURE)
    groups.groups[0].order = 1.5
    expect(decodes(groups)).toThrow(DecodeError)

    const repeating = JSON.parse(FIXTURE)
    const i = decodeAppData(FIXTURE).tasks.findIndex((t) => t.repeatRule !== null)
    repeating.tasks[i].repeatRule.interval = 1.5
    expect(decodes(repeating)).toThrow(DecodeError)
  })

  it('testNegativeAndZeroOrdersStillDecode', () => {
    // Swift's Int is signed — tightening to "integer" must not become "counting
    // number".
    const parsed = JSON.parse(FIXTURE)
    parsed.tasks[0].order = -3
    parsed.lists[0].order = 0
    expect(decodeAppData(JSON.stringify(parsed)).tasks[0]!.order).toBe(-3)
  })
})
