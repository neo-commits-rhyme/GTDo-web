/**
 * data.json ⇄ AppData, byte-compatible with Foundation.
 *
 * Hand-rolled rather than JSON.stringify, because Foundation's pretty-printer
 * writes `"key" : value` (a space BEFORE the colon) and escapes forward slashes.
 * The measurements behind every rule below are in spec §3.
 *
 * The decode half carries the sharpest constraint in the project: Swift's
 * synthesized init(from:) does NOT honour property defaults, so every
 * non-optional field is a hard requirement of the wire format. Emitting a
 * document that omits one makes the macOS app move the user's data file aside
 * as undecodable — so we throw on exactly the inputs Swift throws on, rather
 * than silently healing them.
 */

import type { AppData, ListGroup, RepeatRule, RepeatUnit, TaskItem, TaskList } from './models'

export class DecodeError extends Error {
  constructor(
    readonly key: string,
    readonly path: string,
    message?: string,
  ) {
    super(message ?? `keyNotFound: '${key}'${path ? ` at ${path}` : ''}`)
    this.name = 'DecodeError'
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** Foundation's .iso8601 accepts a fractional part and ±HH:MM / ±HHMM offsets,
 *  but rejects a missing timezone, lowercase t/z, and bare timestamps. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/
const REPEAT_UNITS: RepeatUnit[] = ['day', 'weekday', 'week', 'month', 'year']

// ---------------------------------------------------------------- encode

/** Foundation escapes forward slashes (.withoutEscapingSlashes is not set). */
function str(s: string): string {
  return JSON.stringify(s).replace(/\//g, '\\/')
}

/** The instants the 20-character form can carry — exactly the span DATE_RE
 *  accepts, so anything the decoder reads the encoder can write back. Outside
 *  them toISOString() switches to the expanded '+020266-…' year. */
const ISO_FLOOR = new Date('0000-01-01T00:00:00Z').getTime()
const ISO_CEIL = new Date('9999-12-31T23:59:59Z').getTime()

/** yyyy-MM-dd'T'HH:mm:ss'Z' — 20 characters, no fractional seconds, always Z.
 *  Sub-second precision is dropped, exactly as Foundation drops it.
 *
 *  Out-of-range instants are clamped rather than rejected: this runs inside
 *  persist(), which has no path for a synchronous throw — one bad date would
 *  fail every later save with saveError left null, and the alternative
 *  (emitting the expanded form) writes a document the decoder quarantines on
 *  the next launch, taking the whole file with it. An Invalid Date carries no
 *  direction, but every way to make one here overshoots the top of the Date
 *  range, so it clamps up with the rest. */
function isoDate(d: Date): string {
  const t = d.getTime()
  const clamped = Number.isNaN(t) ? ISO_CEIL : Math.min(Math.max(t, ISO_FLOOR), ISO_CEIL)
  return `${new Date(clamped).toISOString().slice(0, 19)}Z`
}

function uuid(id: string): string {
  return str(id.toUpperCase())
}

type Entry = [key: string, value: string]

const pad = (n: number) => ' '.repeat(n)

/** `indent` is the column of the CLOSING brace. Keys sort byte-wise, matching
 *  .sortedKeys — uppercase-initial keys therefore precede lowercase-initial. */
function obj(entries: Entry[], indent: number): string {
  if (entries.length === 0) return `{\n\n${pad(indent)}}`
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const body = sorted.map(([k, v]) => `${pad(indent + 2)}${str(k)} : ${v}`).join(',\n')
  return `{\n${body}\n${pad(indent)}}`
}

/** Foundation writes an empty array as "[\n\n<indent>]" — verified, not guessed. */
function arr(items: string[], indent: number): string {
  if (items.length === 0) return `[\n\n${pad(indent)}]`
  return `[\n${items.map((i) => pad(indent + 2) + i).join(',\n')}\n${pad(indent)}]`
}

function repeatRuleJSON(r: RepeatRule, indent: number): string {
  return obj([['interval', String(r.interval)], ['unit', str(r.unit)]], indent)
}

function taskJSON(t: TaskItem, indent: number): string {
  // Non-optional fields are ALWAYS emitted — omitting one corrupts the macOS app.
  const e: Entry[] = [
    ['id', uuid(t.id)],
    ['title', str(t.title)],
    ['note', str(t.note)],
    ['listID', uuid(t.listID)],
    ['isCompleted', String(t.isCompleted)],
    ['isTrashed', String(t.isTrashed)],
    ['createdAt', str(isoDate(t.createdAt))],
    ['order', String(t.order)],
  ]
  // Optionals are omitted when null, never written as null.
  if (t.dueDate) e.push(['dueDate', str(isoDate(t.dueDate))])
  if (t.reminderDate) e.push(['reminderDate', str(isoDate(t.reminderDate))])
  if (t.completedAt) e.push(['completedAt', str(isoDate(t.completedAt))])
  if (t.trashedAt) e.push(['trashedAt', str(isoDate(t.trashedAt))])
  if (t.repeatRule) e.push(['repeatRule', repeatRuleJSON(t.repeatRule, indent + 2)])
  return obj(e, indent)
}

function listJSON(l: TaskList, indent: number): string {
  const e: Entry[] = [
    ['id', uuid(l.id)],
    ['name', str(l.name)],
    ['isBuiltIn', String(l.isBuiltIn)],
    ['order', String(l.order)],
  ]
  if (l.groupID) e.push(['groupID', uuid(l.groupID)])
  if (l.colorHex) e.push(['colorHex', str(l.colorHex)])
  if (l.symbol) e.push(['symbol', str(l.symbol)])
  // A finished project. Omitted when null so a document this app writes still
  // decodes on a build that predates the field — and so the bytes match Swift,
  // whose synthesized encoder uses encodeIfPresent.
  if (l.completedAt) e.push(['completedAt', str(isoDate(l.completedAt))])
  return obj(e, indent)
}

function groupJSON(g: ListGroup, indent: number): string {
  return obj(
    [['id', uuid(g.id)], ['name', str(g.name)], ['isBuiltIn', String(g.isBuiltIn)], ['order', String(g.order)]],
    indent,
  )
}

export function encodeAppData(d: AppData): string {
  const top: Entry[] = [
    ['tasks', arr(d.tasks.map((t) => taskJSON(t, 4)), 2)],
    ['lists', arr(d.lists.map((l) => listJSON(l, 4)), 2)],
    ['groups', arr(d.groups.map((g) => groupJSON(g, 4)), 2)],
  ]
  if (d.gtdOrder) top.push(['gtdOrder', arr(d.gtdOrder.map(uuid), 2)])
  if (d.userOrder) top.push(['userOrder', arr(d.userOrder.map(uuid), 2)])
  return obj(top, 0)
}

// ---------------------------------------------------------------- decode

type Raw = Record<string, unknown>

const asString = (v: unknown) => (typeof v === 'string' ? v : null)
const asBool = (v: unknown) => (typeof v === 'boolean' ? v : null)
/** Every numeric field on the wire is a Swift Int — `order` on all three
 *  entities and repeatRule.interval — and Int decoding throws on 1.5 as surely
 *  as it throws on "1". Safe-integer, not merely integer: past 2^53 the double
 *  no longer identifies a single Int, so accepting one would round the user's
 *  value on the way back out. */
const asInt = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null)
/** Any case accepted, hyphenated form required, normalised to uppercase. */
const asUUID = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v.toUpperCase() : null)
const asDate = (v: unknown) => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}
const asObject = (v: unknown): Raw | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : null

function asRepeatRule(v: unknown): RepeatRule | null {
  const o = asObject(v)
  if (!o) return null
  const unit = asString(o['unit'])
  const interval = asInt(o['interval'])
  if (unit === null || interval === null) return null
  if (!REPEAT_UNITS.includes(unit as RepeatUnit)) return null
  return { unit: unit as RepeatUnit, interval }
}

/** Missing key throws — Swift's decoder does, and property defaults do not save it. */
function req<T>(o: Raw, key: string, path: string, parse: (v: unknown) => T | null): T {
  if (!(key in o)) throw new DecodeError(key, path)
  const parsed = parse(o[key])
  if (parsed === null) throw new DecodeError(key, path, `typeMismatch: '${key}' at ${path}`)
  return parsed
}

/** Missing key or explicit null both decode to null, matching decodeIfPresent. */
function opt<T>(o: Raw, key: string, path: string, parse: (v: unknown) => T | null): T | null {
  if (!(key in o) || o[key] === null) return null
  const parsed = parse(o[key])
  if (parsed === null) throw new DecodeError(key, path, `typeMismatch: '${key}' at ${path}`)
  return parsed
}

export function decodeAppData(raw: string): AppData {
  let root: unknown
  try {
    root = JSON.parse(raw)
  } catch (e) {
    throw new DecodeError('<root>', '', `dataCorrupted: ${String(e)}`)
  }
  const o = asObject(root)
  if (!o) throw new DecodeError('<root>', '', 'typeMismatch: expected an object at the root')

  const arrayAt = (key: string): unknown[] => {
    if (!(key in o)) throw new DecodeError(key, '')
    const v = o[key]
    if (!Array.isArray(v)) throw new DecodeError(key, '', `typeMismatch: '${key}'`)
    return v
  }

  const tasks: TaskItem[] = arrayAt('tasks').map((entry, i) => {
    const path = `tasks[${i}]`
    const t = asObject(entry)
    if (!t) throw new DecodeError('<element>', path, `typeMismatch at ${path}`)
    return {
      id: req(t, 'id', path, asUUID),
      title: req(t, 'title', path, asString),
      note: req(t, 'note', path, asString),
      listID: req(t, 'listID', path, asUUID),
      isCompleted: req(t, 'isCompleted', path, asBool),
      isTrashed: req(t, 'isTrashed', path, asBool),
      createdAt: req(t, 'createdAt', path, asDate),
      order: req(t, 'order', path, asInt),
      dueDate: opt(t, 'dueDate', path, asDate),
      reminderDate: opt(t, 'reminderDate', path, asDate),
      completedAt: opt(t, 'completedAt', path, asDate),
      trashedAt: opt(t, 'trashedAt', path, asDate),
      repeatRule: opt(t, 'repeatRule', path, asRepeatRule),
    }
  })

  const lists: TaskList[] = arrayAt('lists').map((entry, i) => {
    const path = `lists[${i}]`
    const l = asObject(entry)
    if (!l) throw new DecodeError('<element>', path, `typeMismatch at ${path}`)
    return {
      id: req(l, 'id', path, asUUID),
      name: req(l, 'name', path, asString),
      isBuiltIn: req(l, 'isBuiltIn', path, asBool),
      order: req(l, 'order', path, asInt),
      groupID: opt(l, 'groupID', path, asUUID),
      colorHex: opt(l, 'colorHex', path, asString),
      symbol: opt(l, 'symbol', path, asString),
      completedAt: opt(l, 'completedAt', path, asDate),
    }
  })

  const groups: ListGroup[] = arrayAt('groups').map((entry, i) => {
    const path = `groups[${i}]`
    const g = asObject(entry)
    if (!g) throw new DecodeError('<element>', path, `typeMismatch at ${path}`)
    return {
      id: req(g, 'id', path, asUUID),
      name: req(g, 'name', path, asString),
      isBuiltIn: req(g, 'isBuiltIn', path, asBool),
      order: req(g, 'order', path, asInt),
    }
  })

  const uuidList = (key: string): string[] | null => {
    if (!(key in o) || o[key] === null) return null
    const v = o[key]
    if (!Array.isArray(v)) throw new DecodeError(key, '', `typeMismatch: '${key}'`)
    return v.map((x, i) => {
      const id = asUUID(x)
      if (id === null) throw new DecodeError(key, `${key}[${i}]`, `typeMismatch: '${key}'`)
      return id
    })
  }

  return { tasks, lists, groups, gtdOrder: uuidList('gtdOrder'), userOrder: uuidList('userOrder') }
}
